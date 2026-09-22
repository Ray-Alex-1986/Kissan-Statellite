// Advisory engine (spec Part G-33..G-35).
//
// Rules live in advisory_rules as declarative JSON predicates; this engine
// evaluates them against a farm's live context (stored indices, cached weather,
// crop stage, sowing-window compliance) and materialises farm-specific
// advisories. Wording follows the agronomic-safety rule: indicators and
// recommended checks, never a diagnosis or a prescription.
//
// Condition schema — every present group must hold (logical AND):
//   { index: 'NDVI'|'NDMI'|'NDRE', operator: '<'|'<='|'>'|'>='|'=='|'!=',
//     value: number, minObservations: number }
//   { weather: 'maxTemperature'|'minTemperature'|'temperature'|'precipitation'
//              |'precipitationProbability'|'windSpeed'|'humidity',
//     operator, value, withinDays: number }
//   { weather: { field, operator, value, withinDays } }   // composite-safe form
//   { windowStart: 'MM-DD', windowEnd: 'MM-DD' }          // sowing-window reminder/compliance
//   { sowingWindowStatus: 'early'|'on_time'|'late' }
//   { growthStage: 'Germination'|'Vegetative'|'Reproductive'|'Maturity' }
//   { daysSinceSowingMin|daysSinceSowingMax: number }
//   { daysToHarvestMax: number }
//   { cropStatus: 'planned'|'growing'|'harvested' }
//
// Lifecycle: one advisory row per (farm, rule). While the condition holds the
// row is refreshed in place (message/severity/sourceData) — never duplicated;
// when the condition clears, the row is auto-resolved.
import { Op } from 'sequelize';
import { Advisory, AdvisoryRule, Farm } from '../models/index.js';
import {
  loadFarmContext,
  cropStageInfo,
  sowingWindowStatus,
  mmddInWindow,
  todayIso,
} from './analyticsService.js';

const OPERATORS = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

const CONDITION_KEYS = new Set([
  'index', 'operator', 'value', 'minObservations',
  'weather', 'withinDays',
  'windowStart', 'windowEnd', 'sowingWindowStatus',
  'growthStage', 'daysSinceSowingMin', 'daysSinceSowingMax', 'daysToHarvestMax',
  'cropStatus',
]);
const WEATHER_FIELDS = new Set([
  'maxTemperature', 'minTemperature', 'temperature',
  'precipitation', 'precipitationProbability', 'windSpeed', 'humidity',
]);
const WEATHER_OBJECT_KEYS = new Set(['field', 'operator', 'value', 'withinDays']);
const STAGE_NAMES = new Set(['Germination', 'Vegetative', 'Reproductive', 'Maturity']);
const INDEX_KEYS = { NDVI: 'ndviMean', NDMI: 'ndmiMean', NDRE: 'ndreMean' };
const DEFAULT_WEATHER_WITHIN_DAYS = 7;

export const SUPPORTED_PLACEHOLDERS = new Set([
  'cropName', 'farmName', 'index', 'latestValue', 'indexValue', 'weatherValue',
  'threshold', 'observationCount', 'minValue', 'weatherField', 'withinDays',
  'windowStart', 'windowEnd', 'windowStatus', 'sowingDate', 'daysOffset',
  'earlyLate', 'daysSinceSowing', 'stage', 'expectedHarvestDate', 'daysToHarvest',
  'daysToHarvestLabel', 'date',
]);

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : [v]);

// ---------------------------------------------------------------------------
// Rule validation (used by the CRUD hooks so misconfigured rules are rejected
// at save time instead of silently never matching)
// ---------------------------------------------------------------------------
export function validateRuleDefinition({ conditions, messageTemplate } = {}) {
  const fail = (msg) => {
    const err = new Error(msg);
    err.status = 400;
    throw err;
  };

  if (!isPlainObject(conditions)) fail('conditions must be a JSON object');
  for (const key of Object.keys(conditions)) {
    if (!CONDITION_KEYS.has(key)) fail(`Unknown condition key "${key}" — supported keys: ${[...CONDITION_KEYS].join(', ')}`);
  }
  if (conditions.index != null) {
    if (!INDEX_KEYS[String(conditions.index).toUpperCase()]) fail('index must be NDVI, NDMI or NDRE');
    if (!OPERATORS[conditions.operator]) fail('index conditions require operator (<, <=, >, >=, ==, !=)');
    if (typeof conditions.value !== 'number') fail('index conditions require a numeric value');
  }
  if (conditions.weather != null) {
    if (isPlainObject(conditions.weather)) {
      for (const k of Object.keys(conditions.weather)) {
        if (!WEATHER_OBJECT_KEYS.has(k)) fail(`Unknown weather condition key "${k}"`);
      }
      if (!WEATHER_FIELDS.has(conditions.weather.field)) fail(`weather.field must be one of: ${[...WEATHER_FIELDS].join(', ')}`);
      if (!OPERATORS[conditions.weather.operator]) fail('weather.operator must be one of: <, <=, >, >=, ==, !=');
      if (typeof conditions.weather.value !== 'number') fail('weather conditions require a numeric value');
    } else {
      if (!WEATHER_FIELDS.has(conditions.weather)) fail(`weather must be one of: ${[...WEATHER_FIELDS].join(', ')}`);
      if (!OPERATORS[conditions.operator]) fail('weather conditions require operator (<, <=, >, >=, ==, !=)');
      if (typeof conditions.value !== 'number') fail('weather conditions require a numeric value');
    }
  }
  for (const key of ['windowStart', 'windowEnd']) {
    if (conditions[key] != null && !/^\d{2}-\d{2}$/.test(String(conditions[key]))) fail(`${key} must be an MM-DD string`);
  }
  if ((conditions.windowStart == null) !== (conditions.windowEnd == null)) {
    fail('windowStart and windowEnd must be provided together');
  }
  if (conditions.sowingWindowStatus != null) {
    for (const s of asArray(conditions.sowingWindowStatus)) {
      if (!['early', 'on_time', 'late'].includes(s)) fail('sowingWindowStatus must be one of: early, on_time, late');
    }
  }
  if (conditions.growthStage != null) {
    for (const s of asArray(conditions.growthStage)) {
      if (!STAGE_NAMES.has(s)) fail(`growthStage must be one of: ${[...STAGE_NAMES].join(', ')}`);
    }
  }
  if (conditions.cropStatus != null) {
    for (const s of asArray(conditions.cropStatus)) {
      if (!['planned', 'growing', 'harvested'].includes(s)) fail('cropStatus must be one of: planned, growing, harvested');
    }
  }
  for (const m of String(messageTemplate || '').matchAll(/\{(\w+)\}/g)) {
    if (!SUPPORTED_PLACEHOLDERS.has(m[1])) {
      fail(`Unknown message placeholder "{${m[1]}}" — supported: ${[...SUPPORTED_PLACEHOLDERS].join(', ')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

// The season a rule is about: crop-scoped rules need a season of that crop;
// crop-agnostic rules use the newest active season (falling back to the
// newest season of any status so late-stage rules still see a harvested crop
// only when they explicitly ask for it).
function pickSeasonForRule(rule, ctx) {
  const candidates = rule.cropName
    ? ctx.seasons.filter((s) => s.cropName === rule.cropName)
    : ctx.seasons;
  if (rule.cropName && !candidates.length) return null;
  const active = candidates.filter((s) => s.status === 'growing' || s.status === 'planned');
  const pool = active.length ? active : candidates;
  return pool.slice().sort((a, b) => String(b.sowingDate).localeCompare(String(a.sowingDate)))[0] || null;
}

// Aggregate the forecasted/current value a weather condition asks for.
// Returns null when the data is unavailable — and mock weather never counts.
function aggregateWeather(weather, spec, asOf) {
  if (!weather || weather.isMock) return null;
  const daily = (weather.forecast || []).filter((d) => d.date >= asOf).slice(0, spec.withinDays);
  const span = daily.length ? { startDate: daily[0].date, endDate: daily[daily.length - 1].date } : {};
  if (spec.field === 'temperature' || spec.field === 'humidity') {
    const value = spec.field === 'temperature' ? weather.current?.temperatureC : weather.current?.humidityPct;
    return value == null ? null : { value, startDate: asOf, endDate: asOf };
  }
  if (!daily.length) return null;
  if (spec.field === 'maxTemperature') {
    const values = daily.filter((d) => d.tempMaxC != null).map((d) => d.tempMaxC);
    return values.length ? { value: Math.max(...values), ...span } : null;
  }
  if (spec.field === 'minTemperature') {
    const values = daily.filter((d) => d.tempMinC != null).map((d) => d.tempMinC);
    return values.length ? { value: Math.min(...values), ...span } : null;
  }
  if (spec.field === 'precipitation') {
    const amounts = daily.filter((d) => d.precipitationMm != null);
    return amounts.length ? { value: amounts.reduce((s, d) => s + d.precipitationMm, 0), ...span } : null;
  }
  if (spec.field === 'precipitationProbability') {
    const values = daily.filter((d) => d.precipitationProbabilityPct != null).map((d) => d.precipitationProbabilityPct);
    return values.length ? { value: Math.max(...values), ...span } : null;
  }
  if (spec.field === 'windSpeed') {
    const values = daily.filter((d) => d.windSpeedMaxKmh != null).map((d) => d.windSpeedMaxKmh);
    return values.length ? { value: Math.max(...values), ...span } : null;
  }
  return null;
}

function normalizeWeatherSpec(conditions) {
  const w = conditions.weather;
  const spec = isPlainObject(w)
    ? { field: w.field, operator: w.operator, value: w.value, withinDays: w.withinDays }
    : { field: w, operator: conditions.operator, value: conditions.value, withinDays: conditions.withinDays };
  if (!spec.field || spec.value == null || !OPERATORS[spec.operator]) return null;
  return {
    field: String(spec.field),
    operator: spec.operator,
    value: Number(spec.value),
    withinDays: Math.min(Math.max(Number(spec.withinDays) || DEFAULT_WEATHER_WITHIN_DAYS, 1), 16),
  };
}

/**
 * Evaluate one rule against a farm context. Returns
 * `{ matched, facts, reason }` — `facts` carries the values quoted by the
 * message template.
 */
export function evaluateRule(rule, ctx) {
  const conditions = rule.conditions || {};
  const facts = { farmName: ctx.farm.name, date: ctx.asOf };
  if (!Object.keys(conditions).length) return { matched: false, facts, reason: 'no conditions' };

  const season = pickSeasonForRule(rule, ctx);
  const cropMaster = season ? ctx.cropMastersByName.get(season.cropName) || null : null;
  const stage = season ? cropStageInfo(season, cropMaster, ctx.asOf) : null;
  const window = season ? sowingWindowStatus(season.sowingDate, cropMaster) : null;

  if (season) {
    facts.seasonId = season.id;
    facts.cropName = season.cropName;
    facts.sowingDate = season.sowingDate;
  } else if (rule.cropName) {
    facts.cropName = rule.cropName;
  }
  if (stage) {
    facts.daysSinceSowing = stage.daysSinceSowing;
    facts.stage = stage.stage;
    facts.expectedHarvestDate = stage.expectedHarvestDate;
    facts.daysToHarvest = stage.daysToHarvest;
    facts.daysToHarvestLabel = stage.daysToHarvestLabel;
  }
  if (window) {
    facts.windowStart = window.windowStart;
    facts.windowEnd = window.windowEnd;
  }

  // A crop-scoped rule with no context for a window reminder still applies when
  // the window is open — every other crop-scoped condition needs the season.
  const windowOnly = conditions.windowStart != null && Object.keys(conditions).every((k) => ['windowStart', 'windowEnd'].includes(k));
  if (rule.cropName && !season && !windowOnly) {
    return { matched: false, facts, reason: `no ${rule.cropName} crop cycle on this farm` };
  }

  if (conditions.cropStatus != null) {
    if (!season || !asArray(conditions.cropStatus).includes(season.status)) {
      return { matched: false, facts, reason: 'cropStatus' };
    }
  }

  if (conditions.index != null) {
    const indexType = String(conditions.index).toUpperCase();
    const op = OPERATORS[conditions.operator];
    const valueKey = INDEX_KEYS[indexType];
    const minObs = Math.max(1, Number(conditions.minObservations) || 1);
    const points = ctx.recentSeries.filter((p) => p[valueKey] != null);
    if (points.length < minObs) return { matched: false, facts, reason: `needs ${minObs} observations` };
    const latest = points[points.length - 1];
    const latestValue = Number(latest[valueKey]);
    const minValue = Math.min(...points.map((p) => Number(p[valueKey])));
    facts.index = indexType;
    facts.indexValue = latestValue;
    if (facts.latestValue == null) facts.latestValue = latestValue;
    facts.threshold = Number(conditions.value);
    facts.observationCount = points.length;
    facts.minValue = minValue;
    facts.indexDate = latest.date;
    if (!op(latestValue, Number(conditions.value))) return { matched: false, facts, reason: 'index threshold' };
  }

  if (conditions.weather != null) {
    const spec = normalizeWeatherSpec(conditions);
    if (!spec) return { matched: false, facts, reason: 'weather config' };
    const agg = aggregateWeather(ctx.weather, spec, ctx.asOf);
    if (!agg) return { matched: false, facts, reason: 'weather unavailable' };
    facts.weatherField = spec.field;
    facts.weatherValue = agg.value;
    if (facts.latestValue == null) facts.latestValue = agg.value;
    facts.threshold = spec.value;
    facts.withinDays = spec.withinDays;
    facts.weatherStartDate = agg.startDate;
    facts.weatherEndDate = agg.endDate;
    if (!OPERATORS[spec.operator](agg.value, spec.value)) return { matched: false, facts, reason: 'weather threshold' };
  }

  if (conditions.windowStart != null) {
    const ws = conditions.windowStart;
    const we = conditions.windowEnd;
    facts.windowStart = ws;
    facts.windowEnd = we;
    const offSchedule = window && (window.status === 'early' || window.status === 'late');
    if (offSchedule) {
      facts.sowingDate = season.sowingDate;
      facts.windowStatus = window.status;
      facts.daysOffset = window.daysOffset;
      facts.earlyLate = window.status === 'early' ? 'before the window opened' : 'after the window closed';
    } else if (!season && mmddInWindow(ctx.asOf, ws, we)) {
      facts.windowStatus = 'reminder';
      facts.daysOffset = null;
    } else {
      return { matched: false, facts, reason: 'sowing window' };
    }
  }

  if (conditions.sowingWindowStatus != null) {
    const wanted = asArray(conditions.sowingWindowStatus);
    if (!window || !wanted.includes(window.status)) return { matched: false, facts, reason: 'sowingWindowStatus' };
    facts.windowStatus = window.status;
    facts.daysOffset = window.daysOffset;
    facts.earlyLate = window.status === 'early' ? 'before the window opened' : 'after the window closed';
  }

  if (conditions.growthStage != null) {
    if (!stage || !asArray(conditions.growthStage).includes(stage.stage)) return { matched: false, facts, reason: 'growthStage' };
  }
  if (conditions.daysSinceSowingMin != null && (!stage || stage.daysSinceSowing < Number(conditions.daysSinceSowingMin))) {
    return { matched: false, facts, reason: 'daysSinceSowingMin' };
  }
  if (conditions.daysSinceSowingMax != null && (!stage || stage.daysSinceSowing > Number(conditions.daysSinceSowingMax))) {
    return { matched: false, facts, reason: 'daysSinceSowingMax' };
  }
  if (conditions.daysToHarvestMax != null && (!stage || stage.daysToHarvest > Number(conditions.daysToHarvestMax))) {
    return { matched: false, facts, reason: 'daysToHarvestMax' };
  }

  return { matched: true, facts };
}

const formatValue = (v) => (typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v));

/**
 * Fill {placeholders} from facts. Numbers are trimmed to three decimals.
 * Unknown placeholders are left visible — validateRuleDefinition rejects them
 * at save time, so they can only appear on hand-edited legacy rows.
 */
export function renderTemplate(template, facts) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => {
    const value = facts[key];
    return value === undefined || value === null || value === '' ? whole : formatValue(value);
  });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Evaluate every active rule for one farm and materialise the advisories.
 * One row per (farm, rule): refreshed while the condition holds, auto-resolved
 * when it clears. `dryRun` returns the matches without writing.
 */
export async function generateAdvisoriesForFarm(farm, { asOf = todayIso(), dryRun = false } = {}) {
  const ctx = await loadFarmContext(farm, { asOf, includeWeather: true });
  const rules = await AdvisoryRule.findAll({ where: { active: true }, order: [['id', 'ASC']] });

  const drafts = [];
  const matchedRuleIds = new Set();
  for (const rule of rules) {
    let result;
    try {
      result = evaluateRule(rule, ctx);
    } catch {
      continue; // a malformed legacy rule must never break the run
    }
    if (!result.matched) continue;
    const { seasonId, ...factSnapshot } = result.facts;
    matchedRuleIds.add(rule.id);
    drafts.push({
      ruleId: rule.id,
      cropSeasonId: seasonId ?? null,
      category: rule.category,
      severity: rule.severity,
      title: rule.name,
      message: renderTemplate(rule.messageTemplate, result.facts),
      sourceData: { evaluatedAt: new Date().toISOString(), conditions: rule.conditions, facts: factSnapshot },
    });
  }

  if (dryRun) {
    return {
      farmId: farm.id,
      asOf,
      dryRun: true,
      evaluated: rules.length,
      matched: drafts.map(({ ruleId, title, message, severity, category }) => ({ ruleId, title, message, severity, category })),
      counts: { created: 0, updated: 0, resolved: 0, matched: drafts.length },
    };
  }

  // Current = open or acknowledged (an acknowledged advisory is still live —
  // refreshing it must not spawn a duplicate).
  const currentRows = await Advisory.findAll({
    where: { farmId: farm.id, ruleId: { [Op.ne]: null }, status: { [Op.in]: ['open', 'acknowledged'] } },
  });
  const currentByRule = new Map(currentRows.map((r) => [r.ruleId, r]));

  let created = 0;
  let updated = 0;
  let resolved = 0;
  for (const draft of drafts) {
    const existing = currentByRule.get(draft.ruleId);
    if (!existing) {
      await Advisory.create({
        farmId: farm.id,
        cropSeasonId: draft.cropSeasonId,
        ruleId: draft.ruleId,
        category: draft.category,
        severity: draft.severity,
        title: draft.title,
        message: draft.message,
        status: 'open',
        generatedAt: asOf,
        sourceData: draft.sourceData,
      });
      created++;
    } else {
      await existing.update({
        message: draft.message,
        severity: draft.severity,
        cropSeasonId: draft.cropSeasonId,
        sourceData: draft.sourceData,
      });
      updated++;
    }
  }

  // Conditions that no longer hold: resolve their live advisories.
  for (const [ruleId, row] of currentByRule) {
    if (!matchedRuleIds.has(ruleId)) {
      await row.update({ status: 'resolved' });
      resolved++;
    }
  }

  return {
    farmId: farm.id,
    asOf,
    evaluated: rules.length,
    counts: { created, updated, resolved, matched: drafts.length },
  };
}

/** Run the engine across all farms (district/national officer refresh). */
export async function generateAdvisoriesForAllFarms({ asOf = todayIso(), limit = 200 } = {}) {
  const farms = await Farm.findAll({
    attributes: ['id', 'name', 'ownerId', 'centroidLat', 'centroidLon'],
    order: [['id', 'ASC']],
    limit,
  });
  const results = [];
  const totals = { created: 0, updated: 0, resolved: 0, matched: 0 };
  for (const farm of farms) {
    try {
      const r = await generateAdvisoriesForFarm(farm, { asOf });
      results.push(r);
      for (const k of Object.keys(totals)) totals[k] += r.counts[k];
    } catch (e) {
      results.push({ farmId: farm.id, error: e.message });
    }
  }
  return { asOf, farms: farms.length, totals, results };
}

// Convenience for tests/tools: the newest advisory per rule for a farm.
export async function listFarmAdvisories(farmId, { status = null, limit = 50 } = {}) {
  const where = { farmId };
  if (status) where.status = status;
  return Advisory.findAll({ where, order: [['generatedAt', 'DESC'], ['id', 'DESC']], limit });
}

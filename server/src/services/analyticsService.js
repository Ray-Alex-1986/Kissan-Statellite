// Farm analytics service (spec Parts E/F): crop-stage tracking against the
// registered sowing date, sowing-window compliance per crop, and multi-index
// stress detection over the stored Sentinel-2 history (NDVI/NDMI/NDRE) plus
// the weather forecast.
//
// Pure computation over stored rows — the only external touch is the cached
// weather summary, and only when the caller asks for it. The advisory engine
// (Phase 6) reuses these primitives so analytics, alerts and advisories always
// agree on thresholds and on the values quoted in their wording.
import { Op } from 'sequelize';
import { Observation, CropSeason, CropMaster } from '../models/index.js';
import { getWeatherSummary } from './weatherService.js';

// ---------------------------------------------------------------------------
// Thresholds — single source of truth for stress classification. The NDVI drop
// levels mirror sentinelService.detectNdviAlerts and the sustained-NDMI rule
// mirrors detectIndexAlerts, so an episode here and an alert there never
// contradict each other.
// ---------------------------------------------------------------------------
export const STRESS_THRESHOLDS = {
  NDVI: { healthy: 0.5, moderate: 0.3, severe: 0.2, sharpDrop: 0.2, sharpDropCeiling: 0.45, dropWarning: 0.12 },
  NDMI: { adequate: 0.3, moderate: 0.1, low: 0.05, sustainedLowReadings: 3 },
  NDRE: { strong: 0.3, moderate: 0.15, sustainedLowReadings: 3 },
  WEATHER: { heatWarningC: 40, heatCriticalC: 45, drySpellMm: 2, drySpellDays: 7, heavyRainDayMm: 25 },
};

// Crop phenology bands as fractions of the crop's registered duration. They are
// deliberately coarse (four phases) — the platform reports a *phase*, not a
// precise phenological stage, so the wording stays defensible agronomically.
export const GROWTH_STAGE_BANDS = [
  { stage: 'Germination', label: 'Germination & emergence', from: 0, to: 0.08 },
  { stage: 'Vegetative', label: 'Vegetative growth', from: 0.08, to: 0.55 },
  { stage: 'Reproductive', label: 'Reproductive (flowering / grain formation)', from: 0.55, to: 0.85 },
  { stage: 'Maturity', label: 'Maturity & ripening', from: 0.85, to: 1 },
];

const SEVERITY_ORDER = { critical: 4, warning: 3, attention: 2, information: 1, normal: 0 };
const INDEX_OF = { NDVI: 'ndviMean', NDMI: 'ndmiMean', NDRE: 'ndreMean' };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 864e5);
}

// 'MM-DD' (or the MM-DD part of an ISO date) -> day index in a fixed non-leap
// reference year, so windows compare correctly across years.
export function mmddToDayIndex(mmdd) {
  const s = String(mmdd || '');
  const part = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s;
  if (!/^\d{2}-\d{2}$/.test(part)) return null;
  const [m, d] = part.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 864e5);
}

export function mmddInWindow(mmdd, windowStart, windowEnd) {
  const sd = mmddToDayIndex(mmdd);
  const ws = mmddToDayIndex(windowStart);
  const we = mmddToDayIndex(windowEnd);
  if (sd == null || ws == null || we == null) return false;
  return ws <= we ? sd >= ws && sd <= we : sd >= ws || sd <= we;
}

const round = (n, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const asArray = (v) => (Array.isArray(v) ? v : [v]);

// ---------------------------------------------------------------------------
// Crop stage + sowing window
// ---------------------------------------------------------------------------

// Sowing-window compliance: windowStart/windowEnd are MM-DD strings from the
// crop master; windows that wrap the year end (e.g. 11-01 .. 03-15) are
// handled. A sowing outside the window is reported against the *nearest* edge
// in the circular year, so an April sowing of a November-window crop reads as
// "N days late", never as a nonsensical "213 days early".
// Returns status 'on_time' | 'early' | 'late' | 'unknown'.
export function sowingWindowStatus(sowingDate, cropMaster) {
  const windowStart = cropMaster?.sowingWindowStart || null;
  const windowEnd = cropMaster?.sowingWindowEnd || null;
  if (!windowStart || !windowEnd) return { windowStart, windowEnd, status: 'unknown', daysOffset: null };
  const sd = mmddToDayIndex(sowingDate);
  const ws = mmddToDayIndex(windowStart);
  const we = mmddToDayIndex(windowEnd);
  if (sd == null || ws == null || we == null) return { windowStart, windowEnd, status: 'unknown', daysOffset: null };
  const inWindow = ws <= we ? sd >= ws && sd <= we : sd >= ws || sd <= we;
  if (inWindow) return { windowStart, windowEnd, status: 'on_time', daysOffset: 0 };
  const daysEarly = (ws - sd + 365) % 365;
  const daysLate = (sd - we + 365) % 365;
  return daysEarly <= daysLate
    ? { windowStart, windowEnd, status: 'early', daysOffset: daysEarly }
    : { windowStart, windowEnd, status: 'late', daysOffset: daysLate };
}

// Phase of the crop relative to its registered sowing date and duration.
export function cropStageInfo(season, cropMaster, asOf = todayIso()) {
  const sowingDate = season?.sowingDate || null;
  if (!sowingDate) return null;
  const durationDays = Number(cropMaster?.durationDays) || 120;
  const daysSinceSowing = Math.max(0, daysBetween(sowingDate, asOf));
  const progress = Math.min(Math.max(daysSinceSowing / durationDays, 0), 1);
  const band = GROWTH_STAGE_BANDS.find((b) => progress < b.to) || GROWTH_STAGE_BANDS[GROWTH_STAGE_BANDS.length - 1];
  const expectedHarvestDate = season.expectedHarvestDate || addDaysIso(sowingDate, durationDays);
  const daysToHarvest = daysBetween(asOf, expectedHarvestDate);
  const status = season.status || 'growing';
  return {
    stage: band.stage,
    stageLabel: band.label,
    daysSinceSowing,
    durationDays,
    progressPct: Math.round(progress * 100),
    expectedHarvestDate,
    daysToHarvest,
    daysToHarvestLabel:
      daysToHarvest > 0 ? `${daysToHarvest} days away` : daysToHarvest === 0 ? 'due today' : `${-daysToHarvest} days overdue`,
    harvestDue: status === 'growing' && daysToHarvest <= 0,
    harvested: status === 'harvested',
  };
}

// ---------------------------------------------------------------------------
// Index summaries
// ---------------------------------------------------------------------------

// Latest / peak / low / mean / trend for one index over the given points.
// Trend needs a >0.03 step between the last two passes to count (same rule as
// the satellite report, so both screens show the same direction).
export function summarizeIndexSeries(points, valueKey) {
  const values = points
    .filter((p) => p[valueKey] != null)
    .map((p) => ({ date: p.date, value: Number(p[valueKey]) }));
  if (!values.length) return null;
  const latest = values[values.length - 1];
  let peak = values[0];
  let low = values[0];
  for (const v of values) {
    if (v.value > peak.value) peak = v;
    if (v.value < low.value) low = v;
  }
  const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
  let trend = 'stable';
  if (values.length >= 2) {
    const delta = latest.value - values[values.length - 2].value;
    if (delta > 0.03) trend = 'rising';
    else if (delta < -0.03) trend = 'falling';
  }
  return {
    count: values.length,
    latest: { date: latest.date, value: round(latest.value) },
    peak: { date: peak.date, value: round(peak.value) },
    low: { date: low.date, value: round(low.value) },
    mean: round(mean),
    trend,
  };
}

// Classification labels match the satellite report's vocabulary exactly.
export function classifyIndex(indexType, value) {
  if (value == null) return null;
  const T = STRESS_THRESHOLDS[indexType];
  if (indexType === 'NDVI') {
    if (value >= T.healthy) return { status: 'healthy', label: 'Healthy, dense vegetation' };
    if (value >= T.moderate) return { status: 'moderate', label: 'Moderate vegetation cover' };
    return { status: 'stressed', label: 'Low vegetation — possible stress' };
  }
  if (indexType === 'NDMI') {
    if (value >= T.adequate) return { status: 'adequate', label: 'Adequate canopy water' };
    if (value >= T.moderate) return { status: 'moderate', label: 'Moderate canopy water' };
    return { status: 'low', label: 'Low canopy water — possible water stress' };
  }
  if (value >= T.strong) return { status: 'strong', label: 'Strong canopy vigour (red edge)' };
  if (value >= T.moderate) return { status: 'moderate', label: 'Moderate red-edge response' };
  return { status: 'low', label: 'Low red-edge response — check crop nutrition' };
}

// Merge per-index Observation rows into one point per pass date:
// { date, ndviMean, ndmiMean, ndreMean }. NDVI rows also store medianValue,
// so the fallback keeps old rows readable.
export function mergeObservationSeries(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const e = byDate.get(r.date) || { date: r.date };
    if (r.indexType === 'NDVI') e.ndviMean = r.ndviMean ?? r.medianValue;
    else if (r.indexType === 'NDMI') e.ndmiMean = r.medianValue;
    else if (r.indexType === 'NDRE') e.ndreMean = r.medianValue;
    byDate.set(r.date, e);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Stress episodes
// ---------------------------------------------------------------------------

function episodeStatus(endDate, referenceDate) {
  if (!endDate || !referenceDate) return 'historical';
  if (endDate >= addDaysIso(referenceDate, -3)) return 'ongoing';
  if (endDate >= addDaysIso(referenceDate, -21)) return 'recent';
  return 'historical';
}

function sustainedLowRuns(series, valueKey, threshold, minLen) {
  const runs = [];
  let run = [];
  for (const p of series) {
    const v = p[valueKey];
    if (v != null && v < threshold) run.push(p);
    else {
      if (run.length >= minLen) runs.push(run);
      run = [];
    }
  }
  if (run.length >= minLen) runs.push(run);
  return runs;
}

// Stress episodes from the stored index history. Every episode quotes the
// readings that triggered it and states an indicator, never a diagnosis.
export function detectIndexStressEpisodes(series) {
  const T = STRESS_THRESHOLDS;
  const referenceDate = series.length ? series[series.length - 1].date : null;
  const episodes = [];
  const push = (e) => episodes.push({ ...e, status: episodeStatus(e.endDate, referenceDate) });

  // Sharp NDVI decline between consecutive passes.
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev.ndviMean == null || curr.ndviMean == null) continue;
    const drop = prev.ndviMean - curr.ndviMean;
    if (drop >= T.NDVI.sharpDrop && curr.ndviMean < T.NDVI.sharpDropCeiling) {
      push({
        type: 'vegetation_decline',
        index: 'NDVI',
        severity: 'critical',
        startDate: prev.date,
        endDate: curr.date,
        days: daysBetween(prev.date, curr.date),
        latestValue: round(curr.ndviMean),
        minValue: round(curr.ndviMean),
        description: `Sharp NDVI drop from ${prev.ndviMean.toFixed(2)} to ${curr.ndviMean.toFixed(2)} — possible stress, pest or water issue. Field inspection recommended.`,
      });
    } else if (drop >= T.NDVI.dropWarning) {
      push({
        type: 'vegetation_decline',
        index: 'NDVI',
        severity: 'warning',
        startDate: prev.date,
        endDate: curr.date,
        days: daysBetween(prev.date, curr.date),
        latestValue: round(curr.ndviMean),
        minValue: round(curr.ndviMean),
        description: `NDVI declined from ${prev.ndviMean.toFixed(2)} to ${curr.ndviMean.toFixed(2)} — verify crop stage, weather and image quality before acting.`,
      });
    }
  }

  // Sustained low canopy water (NDMI). Three consecutive readings below 0.05 is
  // the agronomic rule of thumb for probable water stress outside bare soil; a
  // longer run is reported as critical, in line with the alert service.
  for (const run of sustainedLowRuns(series, 'ndmiMean', T.NDMI.low, T.NDMI.sustainedLowReadings)) {
    const values = run.map((p) => p.ndmiMean);
    const minValue = round(Math.min(...values));
    push({
      type: 'moisture_stress',
      index: 'NDMI',
      severity: run.length >= 4 ? 'critical' : 'warning',
      startDate: run[0].date,
      endDate: run[run.length - 1].date,
      days: daysBetween(run[0].date, run[run.length - 1].date),
      readings: run.length,
      latestValue: round(values[values.length - 1]),
      minValue,
      description: `Canopy water (NDMI) stayed below ${T.NDMI.low} across ${run.length} consecutive readings since ${run[0].date} (minimum ${minValue}). If a crop is actively growing, review irrigation scheduling and soil moisture — confirm on the field before acting.`,
    });
  }

  // Sustained low red-edge (NDRE) — chlorophyll / canopy-N indicator.
  for (const run of sustainedLowRuns(series, 'ndreMean', T.NDRE.moderate, T.NDRE.sustainedLowReadings)) {
    const values = run.map((p) => p.ndreMean);
    const minValue = round(Math.min(...values));
    push({
      type: 'nutrient_indicator',
      index: 'NDRE',
      severity: 'attention',
      startDate: run[0].date,
      endDate: run[run.length - 1].date,
      days: daysBetween(run[0].date, run[run.length - 1].date),
      readings: run.length,
      latestValue: round(values[values.length - 1]),
      minValue,
      description: `Red-edge response (NDRE) stayed below ${T.NDRE.moderate} across ${run.length} consecutive readings. This is a canopy-N indicator only — check crop nutrition plans and verify on the field.`,
    });
  }

  return episodes;
}

// Weather stress from the forecast. Only real provider data is used — advice is
// never generated from the labelled offline mock.
export function detectWeatherStressEpisodes(weather, { cropGrowing = false, asOf = todayIso() } = {}) {
  if (!weather || weather.isMock) return [];
  const T = STRESS_THRESHOLDS.WEATHER;
  const daily = (weather.forecast || []).filter((d) => d.date >= asOf);
  if (!daily.length) return [];
  const episodes = [];

  // Heat: consecutive forecast days at/above the warning threshold.
  let run = [];
  const flushHeat = () => {
    if (!run.length) return;
    const peak = Math.max(...run.map((d) => d.tempMaxC));
    episodes.push({
      type: 'heat_stress',
      index: null,
      severity: peak >= T.heatCriticalC ? 'critical' : 'warning',
      status: 'ongoing',
      startDate: run[0].date,
      endDate: run[run.length - 1].date,
      days: run.length,
      latestValue: round(peak, 1),
      unit: '°C',
      description: `Maximum temperature up to ${peak} °C forecast (${run[0].date} to ${run[run.length - 1].date}). Heat stress around flowering affects pollination and grain set — monitor the crop and plan irrigation accordingly.`,
    });
    run = [];
  };
  for (const d of daily) {
    if (d.tempMaxC != null && d.tempMaxC >= T.heatWarningC) run.push(d);
    else flushHeat();
  }
  flushHeat();

  // Dry spell: little or no rain expected while a crop is growing.
  const week = daily.slice(0, T.drySpellDays);
  const amounts = week.filter((d) => d.precipitationMm != null);
  if (cropGrowing && week.length >= 5 && amounts.length === week.length) {
    const sum = amounts.reduce((s, d) => s + d.precipitationMm, 0);
    if (sum <= T.drySpellMm) {
      episodes.push({
        type: 'dry_spell',
        index: null,
        severity: 'attention',
        status: 'ongoing',
        startDate: week[0].date,
        endDate: week[week.length - 1].date,
        days: week.length,
        latestValue: round(sum, 1),
        unit: 'mm',
        description: `Only about ${round(sum, 1)} mm of rain is forecast over the next ${week.length} days. Irrigated crops should have the next irrigation planned; rain-fed crops may come under moisture stress.`,
      });
    }
  }

  // Heavy rainfall: any single forecast day at/above the heavy-rain threshold.
  for (const d of daily) {
    if (d.precipitationMm != null && d.precipitationMm >= T.heavyRainDayMm) {
      episodes.push({
        type: 'heavy_rainfall',
        index: null,
        severity: 'warning',
        status: 'ongoing',
        startDate: d.date,
        endDate: d.date,
        days: 1,
        latestValue: round(d.precipitationMm, 1),
        unit: 'mm',
        description: `About ${round(d.precipitationMm, 1)} mm of rain is forecast on ${d.date}. Consider drainage in low-lying patches and avoid spraying around this day.`,
      });
    }
  }

  return episodes;
}

// ---------------------------------------------------------------------------
// Context + summary
// ---------------------------------------------------------------------------

// Everything downstream consumers need about a farm: seasons, the crop master
// rows they reference, the merged 2-year index series (plus a recent slice for
// rule conditions) and — optionally — the cached weather summary.
export async function loadFarmContext(farm, { asOf = todayIso(), includeWeather = false, historyDays = 730 } = {}) {
  const from = addDaysIso(asOf, -historyDays);
  const [seasons, cropMasters, rows] = await Promise.all([
    CropSeason.findAll({ where: { farmId: farm.id }, order: [['sowingDate', 'DESC']] }),
    CropMaster.findAll({ where: { active: true } }),
    Observation.findAll({
      where: { farmId: farm.id, date: { [Op.between]: [from, asOf] } },
      order: [['date', 'ASC']],
    }),
  ]);
  const cropMastersByName = new Map(cropMasters.map((cm) => [cm.name, cm]));
  const series = mergeObservationSeries(rows);

  // Rule conditions look at readings since the newest active sowing (the
  // current crop), falling back to the last 180 days.
  const activeSowing = seasons.find((s) => s.status === 'growing' || s.status === 'planned')?.sowingDate || null;
  const fallbackStart = addDaysIso(asOf, -180);
  const recentStart = activeSowing && activeSowing > fallbackStart ? activeSowing : fallbackStart;
  const recentSeries = series.filter((p) => p.date >= recentStart);

  let weather = null;
  if (includeWeather) {
    try {
      weather = await getWeatherSummary(farm);
    } catch {
      weather = null; // weather is supplementary — analytics still stands
    }
  }
  return { farm, asOf, from, seasons, cropMastersByName, series, recentSeries, weather, recentStart };
}

function verdictFor(indices, episodes) {
  const reasons = [];
  let level = 0; // 0 normal, 1 attention, 2 warning, 3 critical
  const bump = (l) => { level = Math.max(level, l); };
  const T = STRESS_THRESHOLDS;

  const ndvi = indices.NDVI?.latest?.value;
  if (ndvi != null) {
    if (ndvi < T.NDVI.severe) { bump(3); reasons.push(`NDVI ${ndvi} — very low vegetation cover`); }
    else if (ndvi < T.NDVI.moderate) { bump(2); reasons.push(`NDVI ${ndvi} — low vegetation (possible stress)`); }
    else if (ndvi < T.NDVI.healthy) { bump(1); reasons.push(`NDVI ${ndvi} — moderate vegetation cover`); }
  }
  const ndmi = indices.NDMI?.latest?.value;
  if (ndmi != null && ndmi < T.NDMI.low) { bump(2); reasons.push(`NDMI ${ndmi} — canopy water below ${T.NDMI.low}`); }
  const ndre = indices.NDRE?.latest?.value;
  if (ndre != null && ndre < T.NDRE.moderate) { bump(1); reasons.push(`NDRE ${ndre} — low red-edge response`); }

  for (const e of episodes) {
    if (e.status === 'historical') continue;
    const lvl = e.severity === 'critical' ? 3 : e.severity === 'warning' ? 2 : 1;
    if (lvl >= 2 || e.status === 'ongoing') {
      bump(lvl);
      reasons.push(e.description.split(' — ')[0]);
    }
  }

  return { verdict: ['normal', 'attention', 'warning', 'critical'][level], reasons: [...new Set(reasons)].slice(0, 5) };
}

// Full analytics summary for one farm: sowing windows + crop stages per cycle,
// per-index state, and detected stress episodes.
export function buildAnalyticsSummary(ctx, { windowDays = 365 } = {}) {
  const { farm, asOf, seasons, cropMastersByName, series, weather } = ctx;
  const cutoff = addDaysIso(asOf, -windowDays);
  const inWindow = series.filter((p) => p.date >= cutoff);

  const indices = {};
  for (const type of Object.keys(INDEX_OF)) {
    const summary = summarizeIndexSeries(inWindow, INDEX_OF[type]);
    indices[type] = summary ? { ...summary, ...classifyIndex(type, summary.latest.value) } : null;
  }

  const cropCycles = seasons.slice(0, 8).map((season) => {
    const cropMaster = cropMastersByName.get(season.cropName) || null;
    const stage = cropStageInfo(season, cropMaster, asOf);
    const sowingWindow = sowingWindowStatus(season.sowingDate, cropMaster);
    let seasonIndices = null;
    if (season.status !== 'planned' && season.sowingDate) {
      const slice = series.filter((p) => p.date >= season.sowingDate && p.date <= asOf);
      seasonIndices = {
        NDVI: summarizeIndexSeries(slice, 'ndviMean'),
        NDMI: summarizeIndexSeries(slice, 'ndmiMean'),
        NDRE: summarizeIndexSeries(slice, 'ndreMean'),
      };
    }
    return {
      seasonId: season.id,
      cropName: season.cropName,
      variety: season.variety,
      season: season.season,
      status: season.status,
      sowingDate: season.sowingDate,
      areaAcres: season.areaAcres,
      stage,
      sowingWindow,
      indices: seasonIndices,
    };
  });

  const cropGrowing = seasons.some((s) => s.status === 'growing');
  const episodes = [
    ...detectIndexStressEpisodes(series),
    ...detectWeatherStressEpisodes(weather, { cropGrowing, asOf }),
  ]
    .filter((e) => e.endDate >= cutoff)
    .sort(
      (a, b) =>
        (a.status === 'historical') - (b.status === 'historical') ||
        SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        (a.endDate < b.endDate ? 1 : -1)
    );

  const active = episodes.filter((e) => e.status !== 'historical');
  const { verdict, reasons } = verdictFor(indices, episodes);
  const bySeverity = episodes.reduce((acc, e) => {
    acc[e.severity] = (acc[e.severity] || 0) + 1;
    return acc;
  }, {});

  return {
    farmId: farm.id,
    generatedAt: new Date().toISOString(),
    asOf,
    window: { from: cutoff, to: asOf, days: windowDays },
    weatherAvailable: Boolean(weather && !weather.isMock),
    cropCycles,
    indices,
    stress: {
      verdict,
      verdictReasons: reasons,
      active,
      episodes,
      bySeverity,
    },
  };
}

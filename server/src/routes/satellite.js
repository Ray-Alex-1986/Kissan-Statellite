import { Router } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Farm, Observation, SoilProfile, Alert, CropSeason } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';
import { getIndexSeries, detectIndexAlerts, providerStatus } from '../services/sentinelService.js';
import { getSoilProfile } from '../services/soilgridsService.js';
import {
  commodityCatalog,
  commodityMatchNames,
  resolveCommodity,
  classifyStress,
  classifyChange,
  cultivatedCells,
} from '../services/cultivationService.js';

const router = Router();

// Satellite analysis is based on a 2-year history of Sentinel-2 passes
// (spec: 24-month analytics window).
const WINDOW_DAYS = 730;
const HISTORY_DAYS = 730;
const DEFAULT_COMPARE_DAYS = 30; // fallback gap between "before" and "after"

function lastWindow() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoOr(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : fallback;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// "minLon,minLat,maxLon,maxLat" viewport coming from the map (limits the
// satellite-derived parcels to what the officer is actually looking at).
function parseBbox(value) {
  const parts = String(value || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (!(minLon < maxLon && minLat < maxLat)) return null;
  return parts;
}

// Fetch fresh NDVI+NDMI+NDRE from the provider and persist one observation
// row per (date, indexType): NDVI rows keep ndviMean/Min/Max for the existing
// dashboards; NDMI/NDRE rows carry medianValue/stdDevValue (spec D20-D22).
async function refreshIndices(farm, from, to) {
  const series = await getIndexSeries(farm, from, to);
  for (const s of series) {
    const base = {
      farmId: farm.id,
      source: 'sentinel-2',
      date: s.date,
      cloudPct: s.cloudPct,
      dataCoveragePct: s.dataCoveragePct,
    };
    await Promise.all([
      Observation.upsert({
        ...base, indexType: 'NDVI',
        ndviMean: s.ndviMean, ndviMin: s.ndviMin, ndviMax: s.ndviMax,
        medianValue: s.ndviMean, stdDevValue: s.ndviStd,
      }),
      s.ndmiMean != null && Observation.upsert({
        ...base, indexType: 'NDMI', medianValue: s.ndmiMean, stdDevValue: s.ndmiStd,
      }),
      s.ndreMean != null && Observation.upsert({
        ...base, indexType: 'NDRE', medianValue: s.ndreMean, stdDevValue: s.ndreStd,
      }),
    ]);
  }
  for (const a of detectIndexAlerts(farm.id, series)) {
    await Alert.findOrCreate({
      where: { farmId: a.farmId, type: a.type, message: a.message },
      defaults: a,
    });
  }
  return series;
}

function classifyNdvi(v) {
  if (v >= 0.5) return { status: 'healthy', label: 'Healthy, dense vegetation' };
  if (v >= 0.3) return { status: 'moderate', label: 'Moderate vegetation cover' };
  return { status: 'stressed', label: 'Low vegetation — possible stress' };
}

function classifyNdmi(v) {
  if (v >= 0.3) return { status: 'adequate', label: 'Adequate canopy water' };
  if (v >= 0.1) return { status: 'moderate', label: 'Moderate canopy water' };
  return { status: 'low', label: 'Low canopy water — possible water stress' };
}

function classifyNdre(v) {
  if (v >= 0.3) return { status: 'strong', label: 'Strong canopy vigour (red edge)' };
  if (v >= 0.15) return { status: 'moderate', label: 'Moderate red-edge response' };
  return { status: 'low', label: 'Low red-edge response — check crop nutrition' };
}

// Generic latest/peak/low/trend summary for one value key of the series.
function summarizeIndex(series, key) {
  const points = series.filter((s) => s[key] != null);
  const latest = points[points.length - 1] || null;
  if (!latest) return null;
  let peak = null;
  let low = null;
  for (const p of points) {
    if (!peak || p[key] > peak[key]) peak = p;
    if (!low || p[key] < low[key]) low = p;
  }
  let trend = 'stable';
  if (points.length >= 2) {
    const delta = latest[key] - points[points.length - 2][key];
    if (delta > 0.03) trend = 'rising';
    else if (delta < -0.03) trend = 'falling';
  }
  return {
    latest: { date: latest.date, value: latest[key] },
    peak: peak ? { date: peak.date, value: peak[key] } : null,
    low: low ? { date: low.date, value: low[key] } : null,
    trend,
  };
}

// Plain-language feedback report from the analysed series. Based on the full
// 2-year window: NDMI (canopy water) and NDRE (red edge / canopy N) sit
// alongside NDVI so the analysis reflects water and nutritional status too.
function buildFeedback(farm, series, alerts, soilProfile, window) {
  const points = series.filter((s) => s.ndviMean != null);
  const latest = points[points.length - 1] || null;
  let peak = null;
  let low = null;
  for (const p of points) {
    if (!peak || p.ndviMean > peak.ndviMean) peak = p;
    if (!low || p.ndviMean < low.ndviMean) low = p;
  }
  let trend = 'stable';
  if (points.length >= 2 && latest) {
    const delta = latest.ndviMean - points[points.length - 2].ndviMean;
    if (delta > 0.03) trend = 'rising';
    else if (delta < -0.03) trend = 'falling';
  }
  const cls = latest ? classifyNdvi(latest.ndviMean) : null;
  const ndmi = summarizeIndex(series, 'ndmiMean');
  const ndre = summarizeIndex(series, 'ndreMean');
  const topsoil = soilProfile?.layers?.['0-5cm'] || null;
  return {
    farmId: farm.id,
    generatedAt: new Date().toISOString(),
    window: window
      ? { from: window.from, to: window.to, days: window.days, passes: points.length }
      : null,
    position: {
      lat: farm.centroidLat,
      lon: farm.centroidLon,
      district: farm.district,
      areaAcres: farm.totalAreaAcres,
    },
    ndvi: latest
      ? {
          latest: { date: latest.date, value: latest.ndviMean },
          peak: peak ? { date: peak.date, value: peak.ndviMean } : null,
          low: low ? { date: low.date, value: low.ndviMean } : null,
          trend,
          status: cls.status,
          label: cls.label,
        }
      : null,
    ndmi: ndmi ? { ...ndmi, ...classifyNdmi(ndmi.latest.value) } : null,
    ndre: ndre ? { ...ndre, ...classifyNdre(ndre.latest.value) } : null,
    alerts: alerts.map((a) => ({ type: a.type, severity: a.severity, message: a.message })),
    soil: topsoil
      ? {
          ph: topsoil.ph,
          organicCarbonDgPerKg: topsoil.organicCarbonDgPerKg,
          nitrogenCgPerKg: topsoil.nitrogenCgPerKg,
          clayPct: topsoil.clay,
          sandPct: topsoil.sand,
          siltPct: topsoil.silt,
        }
      : null,
  };
}

router.get('/status', (req, res) => {
  res.json({
    satellite: providerStatus(),
    soil: { provider: process.env.SOIL_PROVIDER || 'mock' },
  });
});

// Commodity selector data for the national commodity map. The full
// satellite-monitored catalog is always listed (so a commodity is pickable
// before any farm is registered for it) and the farm/season counts come from
// the registry. Registered crops outside the catalog keep their own row.
router.get(
  '/commodities',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const seasons = await CropSeason.findAll({
      attributes: ['cropName', 'farmId'],
      include: [{ model: Farm, attributes: ['id'] }],
    });
    const counts = new Map();
    for (const s of seasons) {
      const key = (resolveCommodity(s.cropName)?.crop || s.cropName).toLowerCase();
      if (!counts.has(key)) counts.set(key, { crop: s.cropName, farms: new Set(), seasons: 0 });
      const e = counts.get(key);
      e.farms.add(s.farmId);
      e.seasons += 1;
    }
    const entries = commodityCatalog().map((c) => {
      const reg = counts.get(c.crop.toLowerCase());
      return {
        crop: c.crop, color: c.color, season: c.season, kind: c.kind,
        satellite: true, farms: reg ? reg.farms.size : 0, seasons: reg ? reg.seasons : 0,
      };
    });
    const catalogKeys = new Set(entries.map((e) => e.crop.toLowerCase()));
    for (const [key, reg] of counts) {
      if (catalogKeys.has(key)) continue;
      entries.push({ crop: reg.crop, color: null, season: null, kind: 'field', satellite: false, farms: reg.farms.size, seasons: reg.seasons });
    }
    entries.sort((a, b) => b.farms - a.farms || a.crop.localeCompare(b.crop));
    res.json(entries);
  })
);

// Commodity map for a date pair. Returns registered farms AND satellite-derived
// cultivated parcels that have no registry record, each with NDVI at the
// "after" date, NDVI at the "compare" date and the signed change between them —
// so the whole agricultural region is visible and the before/after difference
// is measurable, not just visual. Query params:
//   crop        commodity name or alias, default "All"
//   date        after date (ISO), default today
//   compareDate before date (ISO), default 30 days before `date`
//   bbox        minLon,minLat,maxLon,maxLat viewport for the derived parcels
//   cellKm      derived parcel size in km (default 4)
//   maxCells    cap on derived parcels returned (default 350)
//   includeUnregistered  "false" disables the derived layer
router.get(
  '/commodity-map',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const cropParam = String(req.query.crop || 'All').trim() || 'All';
    const all = cropParam.toLowerCase() === 'all';
    const date = isoOr(req.query.date, todayIso());
    let compareDate = isoOr(req.query.compareDate, addDaysIso(date, -DEFAULT_COMPARE_DAYS));
    if (compareDate > date) compareDate = date;
    const bbox = parseBbox(req.query.bbox);
    const cellKm = clamp(Number(req.query.cellKm) || 4, 0.5, 12);
    const maxCells = Math.round(clamp(Number(req.query.maxCells) || 350, 0, 900));
    const includeUnregistered = req.query.includeUnregistered !== 'false';

    // ----- registered farms: in the ground on `date`, crop filter (with aliases)
    const seasonWhere = { sowingDate: { [Op.lte]: date } };
    if (!all) {
      seasonWhere.cropName = { [Op.or]: commodityMatchNames(cropParam).map((n) => ({ [Op.iLike]: n })) };
    }
    const seasons = await CropSeason.findAll({
      where: seasonWhere,
      attributes: ['id', 'farmId', 'cropName', 'variety', 'season', 'sowingDate', 'status', 'areaAcres'],
      include: [{
        model: Farm,
        attributes: ['id', 'name', 'district', 'tehsil', 'province', 'centroidLat', 'centroidLon', 'totalAreaAcres', 'boundary'],
      }],
    });
    const farmIds = [...new Set(seasons.map((s) => s.farmId))];

    const [observations, alerts, boundsRow] = await Promise.all([
      farmIds.length === 0 ? [] : Observation.findAll({
        where: { farmId: farmIds, date: { [Op.lte]: date } },
        attributes: ['farmId', 'date', 'ndviMean'],
        order: [['date', 'DESC']],
      }),
      farmIds.length === 0 ? [] : Alert.findAll({
        where: { farmId: farmIds, status: 'open' },
        attributes: ['farmId', 'type', 'severity', 'status', 'message'],
      }),
      Observation.findOne({
        attributes: [[sequelize.fn('MIN', sequelize.col('date')), 'min'], [sequelize.fn('MAX', sequelize.col('date')), 'max']],
      }),
    ]);

    // Latest reading at/before the after date, and the comparison baseline: the
    // latest reading at/before the compare date. When the requested baseline
    // predates the first stored observation, the earliest reading is used
    // instead so the change is still measurable (the popup/list show which date
    // each value actually came from).
    const obsByFarm = new Map();
    for (const o of observations) {
      if (!obsByFarm.has(o.farmId)) obsByFarm.set(o.farmId, []);
      obsByFarm.get(o.farmId).push(o); // ordered date DESC
    }
    const alertsByFarm = new Map();
    for (const a of alerts) {
      if (!alertsByFarm.has(a.farmId)) alertsByFarm.set(a.farmId, []);
      alertsByFarm.get(a.farmId).push(a);
    }
    const seasonByFarm = new Map();
    for (const s of seasons) if (!seasonByFarm.has(s.farmId)) seasonByFarm.set(s.farmId, s);

    const farms = [];
    for (const farmId of farmIds) {
      const season = seasonByFarm.get(farmId);
      const farm = season.Farm;
      // readings are ordered date DESC: [0] is the newest at/before the after
      // date, and the baseline is the newest reading at/before the compare date
      // (falling back to the earliest reading when the requested baseline
      // predates the stored history — the UI shows the date actually used).
      const list = obsByFarm.get(farmId) || [];
      const after = list[0] || null;
      let before = list.find((o) => o.date <= compareDate) || null;
      if (!before && list.length > 1 && list[list.length - 1] !== after) before = list[list.length - 1];
      if (before === after) before = null;
      const delta = after?.ndviMean != null && before?.ndviMean != null
        ? round(after.ndviMean - before.ndviMean, 3)
        : null;
      const open = alertsByFarm.get(farmId) || [];
      let stress = classifyStress(after?.ndviMean);
      if (open.some((a) => a.severity === 'critical')) stress = 'critical';
      else if (open.length) stress = 'warning';
      farms.push({
        ...farm.toJSON(),
        recordType: 'registered',
        season: {
          id: season.id, cropName: season.cropName, variety: season.variety,
          season: season.season, sowingDate: season.sowingDate, status: season.status,
        },
        ndviAtDate: after ? { date: after.date, ndviMean: after.ndviMean } : null,
        ndviBefore: before ? { date: before.date, ndviMean: before.ndviMean } : null,
        ndviDelta: delta,
        change: classifyChange(delta),
        openAlerts: open.map((a) => ({ type: a.type, severity: a.severity, message: a.message })),
        stress,
      });
    }
    farms.sort((a, b) => a.id - b.id);

    // ----- satellite-derived cultivated parcels (no registry record). Parcels
    // inside a registered boundary are dropped so the layer is purely "unknown".
    let unregistered = [];
    let unregisteredStats = null;
    if (includeUnregistered && maxCells > 0) {
      const allFarms = await Farm.findAll({ attributes: ['id', 'boundary'], limit: 800 });
      const derived = cultivatedCells({
        bbox, date, compareDate,
        crop: all ? null : cropParam,
        cellKm, exclusions: allFarms, maxCells,
      });
      unregistered = derived.cells;
      unregisteredStats = derived.stats;
    }

    const obsMin = boundsRow?.dataValues?.min || null;
    const obsMax = boundsRow?.dataValues?.max || null;
    const today = todayIso();
    const minDate = obsMin || addDaysIso(today, -180);
    const maxDate = obsMax && obsMax > today ? obsMax : today;

    const registeredAcres = farms.reduce((s, f) => s + (f.totalAreaAcres || 0), 0);
    const unregisteredAcres = unregistered.reduce((s, c) => s + c.areaAcres, 0);
    const totalAcres = registeredAcres + unregisteredAcres;
    const changed = [...farms, ...unregistered].filter((x) => x.ndviDelta != null);
    const avgDelta = changed.length
      ? round(changed.reduce((s, x) => s + x.ndviDelta, 0) / changed.length, 3)
      : null;

    res.json({
      crop: cropParam,
      date,
      compareDate,
      bbox: bbox || null,
      cellKm: unregisteredStats?.cellKm || cellKm,
      catalog: commodityCatalog(),
      minDate,
      maxDate,
      farms,
      unregistered,
      unregisteredStats,
      coverage: {
        registeredFarms: farms.length,
        registeredAcres: round(registeredAcres, 1),
        unregisteredParcels: unregistered.length,
        unregisteredAcres: Math.round(unregisteredAcres),
        totalDetectedAcres: Math.round(totalAcres),
        registrationCoveragePct: totalAcres > 0 ? round((registeredAcres / totalAcres) * 100, 2) : null,
        greening: changed.filter((x) => x.change === 'greening').length,
        browning: changed.filter((x) => x.change === 'browning').length,
        stable: changed.filter((x) => x.change === 'stable').length,
        avgDelta,
      },
      generatedAt: new Date().toISOString(),
    });
  })
);

// NDVI series for a farm. Pulls stored observations; optionally fetches fresh ones
// from the provider and persists them (?refresh=true).
router.get(
  '/farms/:id/ndvi',
  requireAuth,
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, {
      include: [{ model: CropSeason, as: 'cropSeasons', order: [['sowingDate', 'DESC']], limit: 1 }],
    });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const from = req.query.from || new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10);

    if (req.query.refresh === 'true') {
      await refreshIndices(farm, from, to);
    }

    const observations = await Observation.findAll({
      where: { farmId: farm.id, date: { [Op.between]: [from, to] }, indexType: 'NDVI' },
      order: [['date', 'ASC']],
    });
    res.json({ farmId: farm.id, from, to, count: observations.length, observations });
  })
);

// Full vegetation-index history for a farm: NDVI, NDMI and NDRE (red edge),
// each a 2-year (730-day) Sentinel-2 series by default. ?refresh=true pulls
// fresh data from the configured provider and persists it per index first.
router.get(
  '/farms/:id/indices',
  requireAuth,
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, {
      include: [{ model: CropSeason, as: 'cropSeasons', order: [['sowingDate', 'DESC']], limit: 1 }],
    });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const to = isoOr(req.query.to, todayIso());
    const from = isoOr(req.query.from, addDaysIso(to, -HISTORY_DAYS));

    if (req.query.refresh === 'true') {
      await refreshIndices(farm, from, to);
    }

    const rows = await Observation.findAll({
      where: { farmId: farm.id, date: { [Op.between]: [from, to] } },
      order: [['date', 'ASC']],
    });
    const indices = { NDVI: [], NDMI: [], NDRE: [] };
    for (const r of rows) {
      if (indices[r.indexType]) indices[r.indexType].push(r);
    }
    res.json({ farmId: farm.id, from, to, count: rows.length, indices });
  })
);

// Fetch (or return cached) estimated SoilGrids profile for the farm centroid.
router.post(
  '/farms/:id/soil-profile',
  requireAuth,
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id);
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const existing = await SoilProfile.findOne({ where: { farmId: farm.id }, order: [['fetchedAt', 'DESC']] });
    if (existing && req.query.refresh !== 'true') return res.json(existing);

    const layers = await getSoilProfile(farm.centroidLat, farm.centroidLon);
    const profile = existing
      ? await existing.update({ layers, fetchedAt: new Date() })
      : await SoilProfile.create({
          farmId: farm.id, source: process.env.SOIL_PROVIDER === 'soilgrids' ? 'soilgrids' : 'soilgrids(mock)',
          sourceVersion: '2.0', lat: farm.centroidLat, lon: farm.centroidLon, layers,
        });
    res.json(profile);
  })
);

export default router;

// Feedback report derived from the STORED 2-year observation history — no
// provider call, so the farmer dashboard can render it on every page load.
// POST /farms/:id/analyze remains the explicit "refresh from satellite".
router.get(
  '/farms/:id/analysis',
  requireAuth,
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, {
      include: [{ model: CropSeason, as: 'cropSeasons', order: [['sowingDate', 'DESC']], limit: 1 }],
    });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const to = isoOr(req.query.to, todayIso());
    const from = isoOr(req.query.from, addDaysIso(to, -HISTORY_DAYS));

    const rows = await Observation.findAll({
      where: { farmId: farm.id, date: { [Op.between]: [from, to] } },
      order: [['date', 'ASC']],
    });
    // Re-merge per-index rows into one series item per pass date.
    const byDate = new Map();
    for (const r of rows) {
      const e = byDate.get(r.date) || { date: r.date };
      if (r.indexType === 'NDVI') e.ndviMean = r.ndviMean;
      else if (r.indexType === 'NDMI') e.ndmiMean = r.medianValue;
      else if (r.indexType === 'NDRE') e.ndreMean = r.medianValue;
      byDate.set(r.date, e);
    }
    const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    const [openAlerts, soilProfile] = await Promise.all([
      Alert.findAll({ where: { farmId: farm.id, status: 'open' }, order: [['createdAt', 'DESC']] }),
      SoilProfile.findOne({ where: { farmId: farm.id }, order: [['fetchedAt', 'DESC']] }),
    ]);
    res.json(buildFeedback(farm, series, openAlerts, soilProfile, { from, to, days: HISTORY_DAYS }));
  })
);

// Full satellite analysis for a farm: fresh NDVI + alerts + soil profile,
// returned as a plain-language feedback report for the farmer.
router.post(
  '/farms/:id/analyze',
  requireAuth,
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, {
      include: [{ model: CropSeason, as: 'cropSeasons', order: [['sowingDate', 'DESC']], limit: 1 }],
    });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { from, to } = lastWindow();
    const series = await refreshIndices(farm, from, to);

    let soilProfile = null;
    try {
      const layers = await getSoilProfile(farm.centroidLat, farm.centroidLon);
      const existing = await SoilProfile.findOne({ where: { farmId: farm.id }, order: [['fetchedAt', 'DESC']] });
      soilProfile = existing
        ? await existing.update({ layers, fetchedAt: new Date() })
        : await SoilProfile.create({
            farmId: farm.id,
            source: process.env.SOIL_PROVIDER === 'soilgrids' ? 'soilgrids' : 'soilgrids(mock)',
            sourceVersion: '2.0',
            lat: farm.centroidLat,
            lon: farm.centroidLon,
            layers,
          });
    } catch {
      soilProfile = null; // soil is supplementary — NDVI feedback still stands
    }

    const openAlerts = await Alert.findAll({
      where: { farmId: farm.id, status: 'open' },
      order: [['createdAt', 'DESC']],
    });
    res.json(buildFeedback(farm, series, openAlerts, soilProfile, { from, to, days: WINDOW_DAYS }));
  })
);

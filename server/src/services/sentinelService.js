// Sentinel-2 vegetation-index service (spec D20-D22): NDVI, NDMI and NDRE
// (red edge) over a configurable window — the platform's satellite analysis
// is based on a 2-year (730-day) history per farm.
//
// Provider switch (env SATELLITE_PROVIDER):
//   mock          -> realistic synthetic index time series (no credentials, for demos)
//   sentinel-hub  -> real Copernicus Data Space / Sentinel Hub Statistics API
//                    (OAuth client credentials from https://dataspace.copernicus.eu)
//
// Sentinel-2 band math:
//   NDVI = (B08 - B04) / (B08 + B04)   greenness / canopy density
//   NDMI = (B08 - B11) / (B08 + B11)   canopy water content
//   NDRE = (B08 - B05) / (B08 + B05)   red edge — chlorophyll / canopy-N status

const PROVIDER = process.env.SATELLITE_PROVIDER || 'mock';
const SH_AUTH_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SH_STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

// One Statistics API call returns all three indices (5-day aggregation).
const INDEX_EVALSCRIPT = btoa(`//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B05", "B08", "B11", "SCL"] }],
    output: [
      { id: "ndvi", type: "float32" },
      { id: "ndmi", type: "float32" },
      { id: "ndre", type: "float32" }
    ]
  };
}
function evaluatePixel(sample) {
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  const ndmi = (sample.B08 - sample.B11) / (sample.B08 + sample.B11);
  const ndre = (sample.B08 - sample.B05) / (sample.B08 + sample.B05);
  return [ndvi, ndmi, ndre];
}`);

export const INDICES = ['NDVI', 'NDMI', 'NDRE'];

export function providerStatus() {
  return {
    provider: PROVIDER,
    indices: INDICES,
    configured:
      PROVIDER === 'mock' ||
      Boolean(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET),
  };
}

async function shToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SENTINEL_HUB_CLIENT_ID,
    client_secret: process.env.SENTINEL_HUB_CLIENT_SECRET,
  });
  const res = await fetch(SH_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Sentinel Hub auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchIndexStats(geometry, from, to) {
  const token = await shToken();
  const res = await fetch(SH_STATS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: {
        bounds: { geometry, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
        data: [{ type: 'sentinel-2-l2a', dataFilter: { maxCloudCoverage: 60 } }],
      },
      aggregation: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        aggregationInterval: { of: 'P5D' },
        evalscript: INDEX_EVALSCRIPT,
      },
    }),
  });
  if (!res.ok) throw new Error(`Sentinel Hub statistics failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const stats = (d, output) => d.outputs?.[output]?.bands?.B0?.stats ?? {};
  return (json.data || []).map((d) => {
    const ndvi = stats(d, 'ndvi');
    const ndmi = stats(d, 'ndmi');
    const ndre = stats(d, 'ndre');
    if (ndvi.mean == null) return null;
    return {
      date: d.interval.from.slice(0, 10),
      ndviMean: ndvi.mean,
      ndviMin: ndvi.min,
      ndviMax: ndvi.max,
      ndviStd: ndvi.stDev ?? null,
      ndmiMean: ndmi.mean ?? null,
      ndmiStd: ndmi.stDev ?? null,
      ndreMean: ndre.mean ?? null,
      ndreStd: ndre.stDev ?? null,
      dataCoveragePct: 100,
    };
  }).filter((d) => d !== null);
}

// Deterministic pseudo-random series for stable demos.
function seededNoise(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const clampNum = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const r3 = (n) => Number(n.toFixed(3));

// Synthetic crop curve: emergence -> vegetative growth -> plateau -> senescence/harvest.
// sowingDate (ISO) anchors the phenological curve. Returned as the NDVI base
// from which the two other indices are derived.
function phenologyNdvi(i, daysSinceSow, farmId) {
  if (daysSinceSow < 0) return 0.18;
  if (daysSinceSow < 15) return 0.18 + (daysSinceSow / 15) * 0.22;
  if (daysSinceSow < 45) return 0.4 + ((daysSinceSow - 15) / 30) * 0.3;
  if (daysSinceSow < 90) return 0.7 + seededNoise(i, farmId) * 0.06;
  if (daysSinceSow < 120) return 0.76 - ((daysSinceSow - 90) / 30) * 0.35;
  return 0.25;
}

/**
 * Synthetic NDVI+NDMI+NDRE series for a farm over [from, to] at 5-day steps.
 * Each row: { date, ndviMean/Min/Max/Std, ndmiMean/Std, ndreMean/Std,
 *             cloudPct, dataCoveragePct }.
 * Ranges follow published Sentinel-2 behaviour for irrigated cropland:
 *   NDVI 0.05 (fallow) .. 0.9 (dense canopy);  NDMI -0.1 .. 0.6;
 *   NDRE 0.02 (bare soil) .. 0.6 (vigorous canopy).
 */
export function mockIndexSeries(farmId, sowingDate, from, to) {
  const sow = sowingDate ? new Date(sowingDate) : new Date(Date.now() - 60 * 864e5);
  const start = new Date(from);
  const end = new Date(to);
  const out = [];
  let i = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 5)) {
    const daysSinceSow = (d - sow) / 864e5;
    const base = phenologyNdvi(i, daysSinceSow, farmId);
    const jitter = (seededNoise(i, farmId + 7) - 0.5) * 0.05;
    const ndvi = clampNum(base + jitter, 0.05, 0.9);

    // NDMI (canopy water) follows the same phenology lagged ~8 days and
    // compressed: fallow ~0.04, peak canopy ~0.45, senescing ~0.12.
    const lagBase = phenologyNdvi(Math.max(0, i - 2), daysSinceSow - 8, farmId);
    const waterNorm = clampNum((lagBase - 0.15) / 0.6, 0, 1);
    const ndmi = lagBase < 0.2
      ? 0.02 + seededNoise(i, farmId + 23) * 0.05
      : clampNum(0.05 + waterNorm * 0.42 + (seededNoise(i, farmId + 29) - 0.5) * 0.06, -0.1, 0.6);

    // NDRE (red edge) — chlorophyll/canopy-N proxy: bare ~0.1, healthy ~0.48,
    // tracks the unstressed canopy and declines a little earlier at senescence.
    const ndreNorm = clampNum((base - 0.12) / 0.6, 0, 1);
    const ndre = clampNum(0.08 + ndreNorm * 0.4 + (seededNoise(i, farmId + 37) - 0.5) * 0.04, 0.02, 0.6);

    out.push({
      date: d.toISOString().slice(0, 10),
      ndviMean: r3(ndvi),
      ndviMin: r3(Math.max(0.02, ndvi - 0.06 - seededNoise(i, farmId + 3) * 0.04)),
      ndviMax: r3(Math.min(0.95, ndvi + 0.06 + seededNoise(i, farmId + 5) * 0.04)),
      ndviStd: r3(0.03 + seededNoise(i, farmId + 11) * 0.03),
      ndmiMean: r3(ndmi),
      ndmiStd: r3(0.02 + seededNoise(i, farmId + 31) * 0.02),
      ndreMean: r3(ndre),
      ndreStd: r3(0.015 + seededNoise(i, farmId + 41) * 0.015),
      cloudPct: Math.round(seededNoise(i, farmId + 13) * 40),
      dataCoveragePct: Math.round(85 + seededNoise(i, farmId + 17) * 15),
    });
    i++;
  }
  return out;
}

// Back-compat shim for the seed script: NDVI-only projection of the full
// index series, in the legacy { date, ndviMean, ndviMin, ndviMax, ... } shape.
export function mockNdviSeries(farmId, sowingDate, from, to) {
  return mockIndexSeries(farmId, sowingDate, from, to).map((s) => ({
    date: s.date,
    ndviMean: s.ndviMean,
    ndviMin: s.ndviMin,
    ndviMax: s.ndviMax,
    cloudPct: s.cloudPct,
    dataCoveragePct: s.dataCoveragePct,
  }));
}

/**
 * Get NDVI+NDMI+NDRE observations for a farm boundary over a date range.
 * Rows: { date, ndviMean/Min/Max/Std, ndmiMean/Std, ndreMean/Std,
 *         cloudPct?, dataCoveragePct }.
 */
export async function getIndexSeries(farm, from, to) {
  const sowing = farm.cropSeasons?.[0]?.sowingDate || null;
  if (PROVIDER === 'sentinel-hub') {
    return fetchIndexStats(farm.boundary, from, to);
  }
  return mockIndexSeries(farm.id, sowing, from, to);
}

// Back-compat alias: NDVI-only consumers read .ndviMean from the same rows.
export const getNdviSeries = getIndexSeries;

// Flag significant NDVI drops between consecutive observations.
export function detectNdviAlerts(farmId, series) {
  const alerts = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].ndviMean;
    const curr = series[i].ndviMean;
    if (prev == null || curr == null) continue;
    const drop = prev - curr;
    if (drop >= 0.2 && curr < 0.45) {
      alerts.push({
        farmId,
        type: 'ndvi_decline',
        severity: 'critical',
        message: `Sharp NDVI decline from ${prev.toFixed(2)} to ${curr.toFixed(2)} on ${series[i].date}. Possible stress, pest, or water issue — recommend field inspection.`,
        status: 'open',
      });
    } else if (drop >= 0.12) {
      alerts.push({
        farmId,
        type: 'ndvi_decline',
        severity: 'warning',
        message: `NDVI declined from ${prev.toFixed(2)} to ${curr.toFixed(2)} on ${series[i].date}. Verify crop stage, weather and image quality before action.`,
        status: 'open',
      });
    }
  }
  return alerts;
}

// Alerts across all three indices. NDVI decline (above) plus sustained very
// low canopy water: NDMI below 0.05 for 3+ consecutive readings — the
// agronomic rule of thumb for probable water stress outside bare/fallow soil.
export function detectIndexAlerts(farmId, series) {
  const alerts = detectNdviAlerts(farmId, series);
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      alerts.push({
        farmId,
        type: 'ndmi_water_stress',
        severity: 'critical',
        message: `Canopy water (NDMI) stayed below 0.05 across ${run.length} consecutive readings since ${run[0].date}. If a crop is actively growing, check irrigation scheduling and soil moisture — confirm on the field before acting.`,
        status: 'open',
      });
    }
    run = [];
  };
  for (const s of series) {
    if (s.ndmiMean != null && s.ndmiMean < 0.05) run.push(s);
    else flush();
  }
  flush();
  return alerts;
}

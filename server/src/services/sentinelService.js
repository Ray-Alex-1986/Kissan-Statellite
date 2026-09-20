// Sentinel-2 NDVI service.
//
// Provider switch (env SATELLITE_PROVIDER):
//   mock          -> realistic synthetic NDVI time series (no credentials, for demos)
//   sentinel-hub  -> real Copernicus Data Space / Sentinel Hub Statistics API
//                    (OAuth client credentials from https://dataspace.copernicus.eu)
//
// NDVI = (B08 - B04) / (B08 + B04)

const PROVIDER = process.env.SATELLITE_PROVIDER || 'mock';
const SH_AUTH_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SH_STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

const NDVI_EVALSCRIPT = btoa(`//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL"] }], output: [{ id: "ndvi", type: "float32" }] };
}
function evaluatePixel(sample) {
  return [ (sample.B08 - sample.B04) / (sample.B08 + sample.B04) ];
}`);

export function providerStatus() {
  return {
    provider: PROVIDER,
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

async function fetchNdviStats(geometry, from, to) {
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
        evalscript: NDVI_EVALSCRIPT,
      },
    }),
  });
  if (!res.ok) throw new Error(`Sentinel Hub statistics failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.data || []).map((d) => ({
    date: d.interval.from.slice(0, 10),
    ndviMean: d.outputs?.ndvi?.bands?.B0?.stats?.mean ?? null,
    ndviMin: d.outputs?.ndvi?.bands?.B0?.stats?.min ?? null,
    ndviMax: d.outputs?.ndvi?.bands?.B0?.stats?.max ?? null,
    cloudPct: d.outputs?.ndvi?.bands?.B0?.stats?.sampleCount ? undefined : undefined,
    dataCoveragePct: 100,
  })).filter((d) => d.ndviMean != null);
}

// Deterministic pseudo-random series for stable demos.
function seededNoise(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Synthetic crop curve: emergence -> vegetative growth -> plateau -> senescence/harvest.
// sowingDate (ISO) anchors the phonological curve.
export function mockNdviSeries(farmId, sowingDate, from, to) {
  const sow = sowingDate ? new Date(sowingDate) : new Date(Date.now() - 60 * 864e5);
  const start = new Date(from);
  const end = new Date(to);
  const out = [];
  let i = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 5)) {
    const daysSinceSow = (d - sow) / 864e5;
    let ndvi;
    if (daysSinceSow < 0) ndvi = 0.18;
    else if (daysSinceSow < 15) ndvi = 0.18 + (daysSinceSow / 15) * 0.22;
    else if (daysSinceSow < 45) ndvi = 0.4 + ((daysSinceSow - 15) / 30) * 0.3;
    else if (daysSinceSow < 90) ndvi = 0.7 + seededNoise(i, farmId) * 0.06;
    else if (daysSinceSow < 120) ndvi = 0.76 - ((daysSinceSow - 90) / 30) * 0.35;
    else ndvi = 0.25;
    const jitter = (seededNoise(i, farmId + 7) - 0.5) * 0.05;
    const value = Math.max(0.05, Math.min(0.9, ndvi + jitter));
    out.push({
      date: d.toISOString().slice(0, 10),
      ndviMean: Number(value.toFixed(3)),
      ndviMin: Number(Math.max(0.02, value - 0.08).toFixed(3)),
      ndviMax: Number(Math.min(0.95, value + 0.08).toFixed(3)),
      cloudPct: Math.round(seededNoise(i, farmId + 13) * 40),
      dataCoveragePct: Math.round(85 + seededNoise(i, farmId + 17) * 15),
    });
    i++;
  }
  return out;
}

/**
 * Get NDVI observations for a farm boundary over a date range.
 * Returns array of { date, ndviMean, ndviMin, ndviMax, cloudPct, dataCoveragePct }.
 */
export async function getNdviSeries(farm, from, to) {
  const sowing = farm.cropSeasons?.[0]?.sowingDate || null;
  if (PROVIDER === 'sentinel-hub') {
    return fetchNdviStats(farm.boundary, from, to);
  }
  return mockNdviSeries(farm.id, sowing, from, to);
}

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

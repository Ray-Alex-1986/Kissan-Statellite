// Satellite-derived cultivated-land model for the national commodity map.
//
// The portal can only outline farms that are registered in the database. To show
// satellite agricultural activity for the *entire* region — registered or not —
// this service derives plausible cultivated parcels from Pakistan's standard
// remote-sensing crop calendar:
//
//   - a deterministic grid of candidate parcels over the agricultural extent
//     (the same cell always gets the same crop and NDVI, so two different dates
//     stay comparable),
//   - region-aware cultivation probability (Punjab/Sindh plains high,
//     Balochistan and the northern mountains sparse, deserts damped),
//   - a per-crop phenology curve (sowing window -> emergence -> growth -> peak ->
//     senescence) that yields an NDVI for any requested date,
//   - parcels inside a registered farm boundary are dropped, so the derived
//     layer only shows land the registry does not cover.
//
// Values are MODEL ESTIMATES for screening and demo use. Production would swap
// cultivationProbability()/cellNdvi() for a real Sentinel-2 classification
// (e.g. Sentinel Hub Process API NDVI thresholding over the requested bbox).

const AGRICULTURAL_EXTENT = { minLon: 60.5, minLat: 23.6, maxLon: 77.9, maxLat: 37.2 };
const ACRES_PER_KM2 = 247.105;
const KM_PER_DEGREE = 111.32;

// ---------------------------------------------------------------------------
// Commodity catalog — every commodity an agricultural satellite can track in
// Pakistan: field crops (crop calendar) and perennials (seasonal canopy curve).
// `aliases` make the ?crop= query forgiving ("rice", "paddy", "basmati" all map
// to "Rice (Paddy)"). `color` is the canonical outline colour used by the map
// legend, so legend and map always agree.
// ---------------------------------------------------------------------------
export const SATELLITE_COMMODITIES = [
  { crop: 'Wheat', aliases: ['wheat', 'gandum'], season: 'Rabi', kind: 'field', sowing: [309, 354], cycleDays: 150, peakNdvi: 0.82, fallowNdvi: 0.16, color: '#ca8a04' },
  { crop: 'Rice (Paddy)', aliases: ['rice', 'rice (paddy)', 'paddy', 'basmati'], season: 'Kharif', kind: 'field', sowing: [140, 190], cycleDays: 130, peakNdvi: 0.85, fallowNdvi: 0.18, color: '#0d9488' },
  { crop: 'Cotton', aliases: ['cotton', 'kapas'], season: 'Kharif', kind: 'field', sowing: [110, 160], cycleDays: 180, peakNdvi: 0.72, fallowNdvi: 0.17, color: '#7c3aed' },
  { crop: 'Sugarcane', aliases: ['sugarcane', 'sugar cane', 'ganna'], season: 'Kharif', kind: 'field', sowing: [60, 130], cycleDays: 330, peakNdvi: 0.84, fallowNdvi: 0.2, color: '#65a30d' },
  { crop: 'Maize', aliases: ['maize', 'corn'], season: 'Kharif', kind: 'field', sowing: [150, 210], cycleDays: 105, peakNdvi: 0.8, fallowNdvi: 0.16, color: '#ea580c' },
  { crop: 'Gram (Chickpea)', aliases: ['gram', 'gram (chickpea)', 'chickpea', 'chana'], season: 'Rabi', kind: 'field', sowing: [300, 350], cycleDays: 140, peakNdvi: 0.62, fallowNdvi: 0.14, color: '#b45309' },
  { crop: 'Mustard', aliases: ['mustard', 'sarsoon', 'canola'], season: 'Rabi', kind: 'field', sowing: [285, 330], cycleDays: 120, peakNdvi: 0.7, fallowNdvi: 0.15, color: '#eab308' },
  { crop: 'Potato', aliases: ['potato', 'aloo'], season: 'Rabi', kind: 'field', sowing: [290, 340], cycleDays: 110, peakNdvi: 0.74, fallowNdvi: 0.15, color: '#92400e' },
  { crop: 'Barley', aliases: ['barley', 'jau'], season: 'Rabi', kind: 'field', sowing: [300, 345], cycleDays: 135, peakNdvi: 0.72, fallowNdvi: 0.16, color: '#a16207' },
  { crop: 'Sorghum (Jowar)', aliases: ['sorghum', 'sorghum (jowar)', 'jowar'], season: 'Kharif', kind: 'field', sowing: [160, 200], cycleDays: 110, peakNdvi: 0.7, fallowNdvi: 0.15, color: '#84cc16' },
  { crop: 'Millet (Bajra)', aliases: ['millet', 'millet (bajra)', 'bajra'], season: 'Kharif', kind: 'field', sowing: [150, 195], cycleDays: 95, peakNdvi: 0.66, fallowNdvi: 0.14, color: '#d97706' },
  { crop: 'Sunflower', aliases: ['sunflower'], season: 'Kharif', kind: 'field', sowing: [55, 110], cycleDays: 100, peakNdvi: 0.74, fallowNdvi: 0.15, color: '#facc15' },
  { crop: 'Soybean', aliases: ['soybean', 'soya'], season: 'Kharif', kind: 'field', sowing: [150, 195], cycleDays: 105, peakNdvi: 0.76, fallowNdvi: 0.16, color: '#16a34a' },
  { crop: 'Groundnut', aliases: ['groundnut', 'peanut'], season: 'Kharif', kind: 'field', sowing: [90, 150], cycleDays: 120, peakNdvi: 0.7, fallowNdvi: 0.15, color: '#8d6e63' },
  { crop: 'Sesame', aliases: ['sesame', 'til'], season: 'Kharif', kind: 'field', sowing: [120, 170], cycleDays: 95, peakNdvi: 0.62, fallowNdvi: 0.14, color: '#db2777' },
  { crop: 'Lentil', aliases: ['lentil', 'masoor'], season: 'Rabi', kind: 'field', sowing: [295, 335], cycleDays: 125, peakNdvi: 0.58, fallowNdvi: 0.14, color: '#78716c' },
  { crop: 'Fodder (Berseem)', aliases: ['fodder', 'berseem', 'alfalfa'], season: 'Rabi', kind: 'field', sowing: [280, 340], cycleDays: 160, peakNdvi: 0.8, fallowNdvi: 0.17, color: '#22c55e' },
  { crop: 'Onion', aliases: ['onion', 'piyaz'], season: 'Rabi', kind: 'field', sowing: [275, 320], cycleDays: 130, peakNdvi: 0.64, fallowNdvi: 0.14, color: '#a21caf' },
  { crop: 'Tomato', aliases: ['tomato', 'tamatar'], season: 'Kharif', kind: 'field', sowing: [130, 180], cycleDays: 110, peakNdvi: 0.68, fallowNdvi: 0.15, color: '#ef4444' },
  { crop: 'Chili', aliases: ['chili', 'chilli', 'mirch'], season: 'Kharif', kind: 'field', sowing: [100, 160], cycleDays: 150, peakNdvi: 0.62, fallowNdvi: 0.15, color: '#b91c1c' },
  { crop: 'Citrus (Kinnow)', aliases: ['citrus', 'citrus (kinnow)', 'kinnow', 'orange', 'mandarin'], season: 'Annual', kind: 'perennial', peakNdvi: 0.78, winterNdvi: 0.5, color: '#fb923c' },
  { crop: 'Mango', aliases: ['mango', 'aam'], season: 'Annual', kind: 'perennial', peakNdvi: 0.8, winterNdvi: 0.45, color: '#15803d' },
  { crop: 'Banana', aliases: ['banana', 'kela'], season: 'Annual', kind: 'perennial', peakNdvi: 0.78, winterNdvi: 0.55, color: '#fde047' },
  { crop: 'Dates (Palm)', aliases: ['dates', 'dates (palm)', 'date palm', 'khajoor'], season: 'Annual', kind: 'perennial', peakNdvi: 0.6, winterNdvi: 0.42, color: '#7c2d12' },
  { crop: 'Olive', aliases: ['olive'], season: 'Annual', kind: 'perennial', peakNdvi: 0.62, winterNdvi: 0.48, color: '#4d7c0f' },
  { crop: 'Apple', aliases: ['apple', 'seb'], season: 'Annual', kind: 'perennial', peakNdvi: 0.72, winterNdvi: 0.35, color: '#be123c' },
];

const BY_ALIAS = new Map();
for (const def of SATELLITE_COMMODITIES) {
  BY_ALIAS.set(def.crop.toLowerCase(), def);
  for (const a of def.aliases) BY_ALIAS.set(a.toLowerCase(), def);
}

// Lightweight catalog for the client: legend colour + season come from one place.
export function commodityCatalog() {
  return SATELLITE_COMMODITIES.map((d) => ({
    crop: d.crop,
    color: d.color,
    season: d.season,
    kind: d.kind,
  }));
}

// Name (or alias, or registered label) -> canonical commodity definition.
export function resolveCommodity(name) {
  return BY_ALIAS.get(String(name || '').trim().toLowerCase()) || null;
}

// Every label a ?crop= filter should match in the database (canonical + aliases).
export function commodityMatchNames(name) {
  const def = resolveCommodity(name);
  if (!def) return [String(name || '').trim()];
  return [...new Set([def.crop, ...def.aliases])];
}

// Shared NDVI / change verdicts — the client and the registered-farm branch both
// speak the same vocabulary so the legend never disagrees with the map.
export function classifyStress(ndvi) {
  if (ndvi == null) return 'no-data';
  if (ndvi >= 0.5) return 'healthy';
  if (ndvi >= 0.3) return 'moderate';
  return 'stressed';
}

export function classifyChange(delta) {
  if (delta == null) return 'no-data';
  if (delta >= 0.08) return 'greening';
  if (delta <= -0.08) return 'browning';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Regional cultivation profile. Rectangles are checked in order (most specific
// first) so overlapping production belts resolve deterministically.
// ---------------------------------------------------------------------------
const REGIONS = [
  {
    name: 'Northern areas (GB/AJK)', minLon: 71.5, maxLon: 77.9, minLat: 33.5, maxLat: 37.2, prior: 0.08,
    weights: { Maize: 10, Apple: 9, Wheat: 6, Potato: 4, 'Fodder (Berseem)': 4, Barley: 3, 'Rice (Paddy)': 2, Olive: 2 },
  },
  {
    name: 'Khyber Pakhtunkhwa', minLon: 69.5, maxLon: 73.2, minLat: 31.5, maxLat: 34.6, prior: 0.36,
    weights: { Maize: 18, Wheat: 14, 'Rice (Paddy)': 6, 'Fodder (Berseem)': 6, 'Gram (Chickpea)': 5, Apple: 4, Onion: 3, Tomato: 3, Potato: 3, 'Citrus (Kinnow)': 2, Mustard: 2, Olive: 2, Barley: 2, Lentil: 2, Sugarcane: 1, 'Millet (Bajra)': 1, 'Sorghum (Jowar)': 1 },
  },
  {
    name: 'Sindh plains', minLon: 66, maxLon: 71.5, minLat: 23.8, maxLat: 28.5, prior: 0.62,
    weights: { 'Rice (Paddy)': 20, Cotton: 16, Wheat: 12, Sugarcane: 10, 'Fodder (Berseem)': 4, Banana: 5, Mango: 3, 'Dates (Palm)': 3, Chili: 3, Onion: 2, Tomato: 2, Mustard: 2, 'Gram (Chickpea)': 2, Sesame: 2, Groundnut: 2, 'Sorghum (Jowar)': 2, 'Millet (Bajra)': 2, Maize: 2, Sunflower: 1, Potato: 1, Barley: 1 },
  },
  {
    name: 'Punjab plains', minLon: 69.5, maxLon: 75.5, minLat: 27.8, maxLat: 34.2, prior: 0.72,
    weights: { Wheat: 26, 'Rice (Paddy)': 12, Cotton: 10, Sugarcane: 10, Maize: 8, 'Fodder (Berseem)': 6, 'Gram (Chickpea)': 5, Mustard: 4, Potato: 4, 'Citrus (Kinnow)': 3, Mango: 3, Tomato: 2, Onion: 2, Barley: 1, Lentil: 1, Groundnut: 1, Sesame: 1, Sunflower: 1, Soybean: 1, Chili: 1, Banana: 1, Olive: 1, 'Millet (Bajra)': 1, 'Sorghum (Jowar)': 1 },
  },
  {
    name: 'Balochistan uplands', minLon: 60.5, maxLon: 69.5, minLat: 23.6, maxLat: 32.5, prior: 0.12,
    weights: { Wheat: 12, 'Gram (Chickpea)': 8, Apple: 8, 'Dates (Palm)': 6, 'Fodder (Berseem)': 4, Onion: 4, Olive: 4, Mustard: 3, Barley: 3, Maize: 2, Potato: 2, Tomato: 2, Sesame: 2, 'Citrus (Kinnow)': 1, Groundnut: 1, Banana: 1, Chili: 1, Lentil: 1, Sunflower: 1, 'Millet (Bajra)': 1, 'Sorghum (Jowar)': 1, Sugarcane: 1 },
  },
];

const DEFAULT_REGION = {
  name: 'Other cultivated land', prior: 0.1,
  weights: { Wheat: 10, 'Rice (Paddy)': 6, Cotton: 5, Maize: 5, 'Fodder (Berseem)': 4, 'Gram (Chickpea)': 3, Sugarcane: 3, Mustard: 3, Potato: 2, 'Sorghum (Jowar)': 2, 'Millet (Bajra)': 2, 'Citrus (Kinnow)': 2, Mango: 1, 'Dates (Palm)': 1, Banana: 1, Onion: 1, Tomato: 1, Barley: 1, Lentil: 1, Groundnut: 1, Sesame: 1, Sunflower: 1, Soybean: 1, Olive: 1, Apple: 1, Chili: 1 },
};

// Sparse belts where the regional prior over-estimates cultivated land.
const DAMPING = [
  { name: 'Thar desert', minLon: 68.5, maxLon: 71.5, minLat: 24.0, maxLat: 27.5, factor: 0.25 },
  { name: 'Cholistan', minLon: 71.0, maxLon: 73.8, minLat: 27.5, maxLat: 29.6, factor: 0.3 },
  { name: 'Thal', minLon: 70.0, maxLon: 72.2, minLat: 30.4, maxLat: 32.6, factor: 0.35 },
  { name: 'Karakoram / Hindu Kush', minLon: 71.0, maxLon: 77.9, minLat: 35.4, maxLat: 37.2, factor: 0.2 },
];

function regionAt(lon, lat) {
  for (const r of REGIONS) {
    if (lon >= r.minLon && lon <= r.maxLon && lat >= r.minLat && lat <= r.maxLat) return r;
  }
  return DEFAULT_REGION;
}

// Stable pseudo-random in [0,1) for a grid cell.
function hash01(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function dayOfYear(ms) {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((ms - start) / 864e5) + 1;
}

// Deterministic sowing instance for a crop in a given year: the parcel is
// "sown" on a stable day inside the crop's sowing window.
function sowingMs(def, year, seed) {
  const [a, b] = def.sowing;
  const doy = a + Math.floor(hash01(seed, year * 0.37) * (b - a + 1));
  return Date.UTC(year, 0, 1) + (doy - 1) * 864e5;
}

// Days since the most recent sowing (or null when the crop is not in the ground).
function daysSinceSowing(def, dateMs, seed) {
  const year = new Date(dateMs).getUTCFullYear();
  for (const y of [year, year - 1]) {
    const du = (dateMs - sowingMs(def, y, seed)) / 864e5;
    if (du >= 0 && du <= def.cycleDays) return du;
  }
  return null;
}

function isInGround(def, dateMs, seed) {
  if (def.kind === 'perennial') return true;
  return daysSinceSowing(def, dateMs, seed) != null;
}

// NDVI curve: emergence -> growth -> plateau -> senescence. A stable 5-day
// jitter keeps consecutive satellite composites from looking frozen.
function fieldNdvi(def, dateMs, seed) {
  const C = def.cycleDays;
  const { peakNdvi: peak, fallowNdvi: base } = def;
  const du = daysSinceSowing(def, dateMs, seed);
  let v;
  if (du == null) v = base;
  else if (du < 0.45 * C) v = base + (peak - base) * (du / (0.45 * C));
  else if (du < 0.75 * C) v = peak;
  else v = peak - (peak - (base + 0.05)) * ((du - 0.75 * C) / (0.25 * C));
  return roundNdvi(v + jitter5(seed, dateMs) * 0.06);
}

function perennialNdvi(def, dateMs, seed) {
  const mid = (def.peakNdvi + def.winterNdvi) / 2;
  const amp = (def.peakNdvi - def.winterNdvi) / 2;
  const v = mid + amp * Math.sin(((dayOfYear(dateMs) - 100) / 365) * 2 * Math.PI);
  return roundNdvi(v + jitter5(seed, dateMs) * 0.05);
}

function jitter5(seed, dateMs) {
  return hash01(seed + 7.31, Math.floor(dateMs / (5 * 864e5)) * 1.7) - 0.5;
}

function roundNdvi(v) {
  return Number(Math.max(0.04, Math.min(0.95, v)).toFixed(3));
}

export function cellNdvi(def, dateMs, seed) {
  return def.kind === 'perennial' ? perennialNdvi(def, dateMs, seed) : fieldNdvi(def, dateMs, seed);
}

// Weighted crop pick for a parcel: only commodities that can be in the ground on
// either compared date are candidates (so a Rabi parcel still shows its
// greening/decay when the compared dates straddle the season).
function pickCrop(region, dateMs, compareMs, seed) {
  const entries = Object.entries(region.weights);
  const candidates = [];
  let total = 0;
  for (const [crop, weight] of entries) {
    const def = BY_ALIAS.get(crop.toLowerCase());
    if (!def) continue;
    if (!isInGround(def, dateMs, seed) && !isInGround(def, compareMs, seed)) continue;
    candidates.push([def, weight]);
    total += weight;
  }
  if (!candidates.length) return null;
  let r = hash01(seed, 91.7) * total;
  for (const [def, weight] of candidates) {
    r -= weight;
    if (r <= 0) return def;
  }
  return candidates[candidates.length - 1][0];
}

// ---------------------------------------------------------------------------
// Registered-farm masking. Farms are bucketed into 0.1-degree cells so the
// candidate loop only tests the few polygons that can actually cover a parcel.
// ---------------------------------------------------------------------------
function ringOf(boundary) {
  if (boundary?.type === 'Polygon') return boundary.coordinates?.[0] || null;
  if (boundary?.type === 'MultiPolygon') return boundary.coordinates?.[0]?.[0] || null;
  return null;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildExclusionIndex(farms) {
  const index = new Map();
  for (const f of farms) {
    const ring = ringOf(f.boundary);
    if (!ring || ring.length < 4) continue;
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const box = {
      minLon: Math.min(...lons) - 0.02,
      maxLon: Math.max(...lons) + 0.02,
      minLat: Math.min(...lats) - 0.02,
      maxLat: Math.max(...lats) + 0.02,
    };
    for (let gx = Math.floor(box.minLon * 10); gx <= Math.floor(box.maxLon * 10); gx++) {
      for (let gy = Math.floor(box.minLat * 10); gy <= Math.floor(box.maxLat * 10); gy++) {
        const key = `${gx}:${gy}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ ring, box });
      }
    }
  }
  return index;
}

// True when the parcel centre falls inside a registered farm (or touches it
// within half a cell) — such land is already represented by a farm polygon.
function isRegistered(index, lon, lat, bufferDeg) {
  const entries = index.get(`${Math.floor(lon * 10)}:${Math.floor(lat * 10)}`);
  if (!entries) return false;
  for (const { ring, box } of entries) {
    if (lon < box.minLon || lon > box.maxLon || lat < box.minLat || lat > box.maxLat) continue;
    if (pointInRing(lon, lat, ring)) return true;
    const b2 = bufferDeg * bufferDeg;
    for (const [vx, vy] of ring) {
      const dx = vx - lon;
      const dy = vy - lat;
      if (dx * dx + dy * dy < b2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API: cultivate a viewport for two dates.
// Returns { cells, stats } where every cell carries NDVI at the "after" date,
// NDVI at the "compare" date and the signed change between them.
// ---------------------------------------------------------------------------
export function cultivatedCells({
  bbox,
  date,
  compareDate,
  crop = null,
  cellKm = 4,
  exclusions = [],
  maxCells = 350,
} = {}) {
  const afterMs = Date.parse(`${date}T00:00:00Z`);
  const beforeMs = Date.parse(`${compareDate || date}T00:00:00Z`);
  if (!Number.isFinite(afterMs) || !Number.isFinite(beforeMs)) return { cells: [], stats: emptyStats() };

  const minLon = Math.max(bbox?.[0] ?? AGRICULTURAL_EXTENT.minLon, AGRICULTURAL_EXTENT.minLon);
  const minLat = Math.max(bbox?.[1] ?? AGRICULTURAL_EXTENT.minLat, AGRICULTURAL_EXTENT.minLat);
  const maxLon = Math.min(bbox?.[2] ?? AGRICULTURAL_EXTENT.maxLon, AGRICULTURAL_EXTENT.maxLon);
  const maxLat = Math.min(bbox?.[3] ?? AGRICULTURAL_EXTENT.maxLat, AGRICULTURAL_EXTENT.maxLat);
  if (!(minLon < maxLon && minLat < maxLat)) return { cells: [], stats: emptyStats() };

  // Coarsen the grid when a zoomed-out viewport would otherwise need millions of
  // parcels — the request stays fast and the client just draws bigger squares.
  const MAX_GRID = 220000;
  const span = (maxLon - minLon) * (maxLat - minLat);
  const minDeg = Math.sqrt(span / MAX_GRID);
  const requestedDeg = Math.max(0.004, cellKm / KM_PER_DEGREE);
  const cellDeg = Math.max(requestedDeg, minDeg);
  const cellKmEff = cellDeg * KM_PER_DEGREE;

  const cropDef = crop ? resolveCommodity(crop) : null;
  if (crop && !cropDef) return { cells: [], stats: emptyStats() };

  const index = buildExclusionIndex(exclusions);
  const ix0 = Math.floor(minLon / cellDeg);
  const ix1 = Math.floor(maxLon / cellDeg);
  const iy0 = Math.floor(minLat / cellDeg);
  const iy1 = Math.floor(maxLat / cellDeg);

  const stats = { considered: 0, cultivated: 0, excluded: 0, returned: 0, sampled: false, coarsened: cellDeg > requestedDeg, cellKm: Number(cellKmEff.toFixed(2)) };
  const candidates = [];
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iy = iy0; iy <= iy1; iy++) {
      stats.considered++;
      const lon = (ix + 0.5) * cellDeg;
      const lat = (iy + 0.5) * cellDeg;
      if (lon < AGRICULTURAL_EXTENT.minLon || lon > AGRICULTURAL_EXTENT.maxLon) continue;
      if (lat < AGRICULTURAL_EXTENT.minLat || lat > AGRICULTURAL_EXTENT.maxLat) continue;

      const region = regionAt(lon, lat);
      let prior = region.prior;
      for (const d of DAMPING) {
        if (lon >= d.minLon && lon <= d.maxLon && lat >= d.minLat && lat <= d.maxLat) prior *= d.factor;
      }
      const seed = hash01(ix * 0.91, iy * 1.23) * 1000;
      if (hash01(ix * 1.77, iy * 2.31) >= prior * (0.55 + 0.9 * hash01(ix * 3.3, iy * 0.7))) continue;

      stats.cultivated++;
      const def = cropDef || pickCrop(region, afterMs, beforeMs, seed);
      if (!def) continue;
      if (cropDef && !isInGround(def, afterMs, seed) && !isInGround(def, beforeMs, seed)) continue;
      if (isRegistered(index, lon, lat, cellDeg * 0.6)) {
        stats.excluded++;
        continue;
      }
      candidates.push({ ix, iy, lon, lat, def, seed, region: region.name });
    }
  }

  // Deterministic stride keeps the returned parcels spread evenly across the view.
  const stride = candidates.length > maxCells ? Math.ceil(candidates.length / maxCells) : 1;
  stats.sampled = stride > 1;
  const cells = [];
  for (let i = 0; i < candidates.length && cells.length < maxCells; i += stride) {
    const c = candidates[i];
    const ndviAfter = cellNdvi(c.def, afterMs, c.seed);
    const ndviBefore = cellNdvi(c.def, beforeMs, c.seed);
    const delta = Number((ndviAfter - ndviBefore).toFixed(3));
    const latKm = cellKmEff;
    const lonKm = cellKmEff * Math.cos((c.lat * Math.PI) / 180);
    cells.push({
      id: `UR-${c.ix}-${c.iy}`,
      lat: Number(c.lat.toFixed(5)),
      lon: Number(c.lon.toFixed(5)),
      cellKm: Number(cellKmEff.toFixed(2)),
      cropName: c.def.crop,
      season: c.def.season,
      color: c.def.color,
      areaAcres: Math.round(latKm * lonKm * ACRES_PER_KM2 * 0.85), // 85% assumed cultivated within the cell
      region: c.region,
      confidence: Number((0.55 + 0.4 * hash01(c.ix * 5.1, c.iy * 3.9)).toFixed(2)),
      ndviAtDate: { date, ndviMean: ndviAfter },
      ndviBefore: { date: compareDate || date, ndviMean: ndviBefore },
      ndviDelta: delta,
      change: classifyChange(delta),
      stress: classifyStress(ndviAfter),
    });
  }
  stats.returned = cells.length;
  return { cells, stats };
}

function emptyStats() {
  return { considered: 0, cultivated: 0, excluded: 0, returned: 0, sampled: false, cellKm: 0 };
}

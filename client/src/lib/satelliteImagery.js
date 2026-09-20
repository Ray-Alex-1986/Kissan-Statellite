// Client-side satellite imagery helpers for the national commodity map.
//
// Imagery comes from NASA GIBS — free, keyless, time-parameterised WMTS layers.
// Every view is described once (label, URL template, native zoom, composite
// step and legend) so the legend rendered next to the map always matches the
// view that is actually displayed.
//
// The map can also *difference* two dates: the "change" view stacks both
// composites and blends the newer one with `mix-blend-mode: difference`, so any
// pixel whose value moved between the dates lights up against the black
// backdrop (see .blend-diff in styles/app.css).

export const GIBS = {
  ndvi: {
    label: 'Crop greenness (NDVI)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_NDVI_16Day/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png',
    note: 'The farming standard — dense crop = dark green, stressed/bare = pale. 16-day composite.',
    step: 16,
    maxNative: 9,
    legend: [
      { color: '#a6611a', label: 'bare soil / water' },
      { color: '#dfc27d', label: 'sparse cover' },
      { color: '#a6d96a', label: 'moderate crop' },
      { color: '#1a9850', label: 'dense crop canopy' },
    ],
  },
  evi: {
    label: 'Greenness in dense canopy (EVI)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_EVI_16Day/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png',
    note: 'Like NDVI but stays accurate in thick canopy — good for sugarcane/orchards. 16-day.',
    step: 16,
    maxNative: 9,
    legend: [
      { color: '#8c7b4b', label: 'no active canopy' },
      { color: '#c9d96a', label: 'moderate canopy' },
      { color: '#4e9b2f', label: 'dense canopy' },
      { color: '#1b5e20', label: 'very dense canopy' },
    ],
  },
  fpar: {
    label: 'Crop canopy cover (FPAR)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L4_FPAR_8Day/default/{time}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
    note: 'Fraction of sunlight the crop canopy absorbs — biomass build-up. 8-day.',
    step: 8,
    maxNative: 8,
    legend: [
      { color: '#f7f7f7', label: 'no canopy' },
      { color: '#a1d99b', label: 'partial cover' },
      { color: '#41ab5d', label: 'good cover' },
      { color: '#00441b', label: 'full cover' },
    ],
  },
  lst: {
    label: 'Field temperature (heat stress)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L3_Land_Surface_Temp_8Day_Day/default/{time}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
    note: 'Daytime land-surface temperature — hot fields glow, heat stress visible early. 8-day.',
    step: 8,
    maxNative: 7,
    legend: [
      { color: '#3b6fb5', label: 'cool surface' },
      { color: '#b7d3e8', label: 'mild' },
      { color: '#ffe07b', label: 'warm' },
      { color: '#e31a1c', label: 'hot — heat stress' },
    ],
  },
  precip: {
    label: 'Rainfall (IMERG)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/{time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    note: 'Daily precipitation rate — monsoon progress and dry spells. Daily.',
    step: 1,
    maxNative: 6,
    legend: [
      { color: '#c8e6ff', label: 'light rain' },
      { color: '#4a90d9', label: 'moderate rain' },
      { color: '#3b2f8f', label: 'heavy rain' },
    ],
  },
  soil: {
    label: 'Soil moisture (SMAP)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/SMAP_L3_Passive_Day_Soil_Moisture/default/{time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    note: 'Topsoil moisture from radar radiometry — drought before crops show it. Daily.',
    step: 1,
    maxNative: 6,
    legend: [
      { color: '#8c510a', label: 'dry topsoil' },
      { color: '#d8b365', label: 'transitional' },
      { color: '#5ab4ac', label: 'moist' },
      { color: '#01665e', label: 'wet / saturated' },
    ],
  },
  truecolor: {
    label: 'True colour photo',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png',
    note: 'What the satellite sees — fields, water, bare soil. Daily.',
    step: 1,
    maxNative: 9,
    legend: [
      { color: '#3d7a3d', label: 'vegetation' },
      { color: '#c2b280', label: 'bare soil' },
      { color: '#2b6cb0', label: 'water' },
    ],
  },
};

// Pseudo-view: the difference between the two dates of a real GIBS layer.
export const CHANGE_VIEW = {
  key: 'change',
  label: 'Change between dates (difference map)',
  note: 'Blends the two composites — pixels that moved between the dates light up, unchanged land stays black.',
  step: 16,
  maxNative: 9,
  legend: [
    { color: '#000000', label: 'no change' },
    { color: '#6b6b6b', label: 'small change' },
    { color: '#ffb300', label: 'clear change' },
    { color: '#ffffff', label: 'large change' },
  ],
};

// Ordered list for the view selector (change map last, it is a comparison tool).
export const IMAGERY_OPTIONS = [
  ...Object.entries(GIBS).map(([key, g]) => ({ key, ...g })),
  CHANGE_VIEW,
];

// Views that can be differenced in the change map.
export const DIFFERENCE_SOURCES = Object.entries(GIBS).map(([key, g]) => ({ key, label: g.label }));

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

// A black tile below the two composites keeps the difference blend clean: the
// blend only sees the two imagery layers, never the basemap or the page.
let blackTile = null;
export function blackTileDataUrl() {
  if (blackTile) return blackTile;
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 2, 2);
  blackTile = c.toDataURL('image/png');
  return blackTile;
}

// ---------------------------------------------------------------------------
// Imagery availability. GIBS only serves dates it actually has; requesting a
// far-future or too-old date yields an empty tile, which used to make both
// comparison panes look identical ("no change"). These helpers probe one tile
// per candidate date and walk back until imagery exists, then keep the original
// gap between "before" and "after" so the two panes are always different
// composites.
// ---------------------------------------------------------------------------
const PROBE_TILE = { z: 5, y: 13, x: 22 }; // tile covering central Pakistan
const probeCache = new Map();

function tileUrl(urlTemplate, iso, tile = PROBE_TILE) {
  return urlTemplate
    .replace('{time}', iso)
    .replace('{z}', String(tile.z))
    .replace('{y}', String(tile.y))
    .replace('{x}', String(tile.x));
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function probeDate(urlTemplate, iso) {
  const key = `${urlTemplate}|${iso}`;
  if (probeCache.has(key)) return probeCache.get(key);
  const url = tileUrl(urlTemplate, iso);
  let available = false;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      available = blob.size > 1000; // an empty composite compresses to a tiny PNG
    }
  } catch {
    available = await loadImage(url); // no CORS/network for fetch — fall back to <img>
  }
  probeCache.set(key, available);
  return available;
}

// The refresh button clears this so a newly published composite can be picked up.
export function clearImageryProbeCache() {
  probeCache.clear();
}

async function walkBackToLatest(urlTemplate, iso, step, maxProbes) {
  const today = new Date().toISOString().slice(0, 10);
  let d = iso > today ? today : iso; // the future is never in the catalogue
  const stride = Math.max(step, 8);
  for (let i = 0; i <= maxProbes; i++) {
    if (await probeDate(urlTemplate, d)) return d;
    d = addDays(d, -stride);
  }
  return null;
}

// If the pair falls off the start of the catalogue, move the baseline forward
// until imagery exists — but never past the "after" composite, so the two panes
// always stay different dates.
async function walkForwardInsideGap(urlTemplate, beforeISO, latestISO, stride) {
  let d = beforeISO;
  for (let i = 0; i < 6 && d < latestISO; i++) {
    const candidate = addDays(d, stride);
    if (candidate >= latestISO) break;
    if (await probeDate(urlTemplate, candidate)) return candidate;
    d = candidate;
  }
  return beforeISO;
}

/**
 * Resolve the dates actually shown on the map for a requested before/after pair.
 * Returns { after, before, clamped, unavailable }: `clamped` means the requested
 * dates were outside the catalogue and newer composites are shown instead (with
 * the same day gap so the difference stays meaningful).
 */
export async function resolveImageryDates(urlTemplate, beforeISO, afterISO, step) {
  const maxProbes = 40;
  const stride = Math.max(step, 8);
  const latest = await walkBackToLatest(urlTemplate, afterISO, step, maxProbes);
  if (!latest) return { after: afterISO, before: beforeISO, clamped: false, unavailable: true };
  const gap = Math.max(daysBetween(beforeISO, afterISO), stride);
  let before = addDays(latest, -gap);
  if (!(await probeDate(urlTemplate, before))) {
    before = await walkForwardInsideGap(urlTemplate, before, latest, stride);
  }
  const clamped = latest !== afterISO || before !== beforeISO;
  return { after: latest, before, clamped, unavailable: false };
}

// ---------------------------------------------------------------------------
// Colour vocabulary shared by fills, badges and legends.
// ---------------------------------------------------------------------------
export const CHANGE_META = {
  greening: { label: 'Greening', arrow: '▲', color: '#1b7f3b' },
  browning: { label: 'Browning / decline', arrow: '▼', color: '#c62828' },
  stable: { label: 'Stable', arrow: '►', color: '#78909c' },
  'no-data': { label: 'No comparison data', arrow: '·', color: '#90a4ae' },
};

export const CHANGE_RAMP = [
  { to: -0.15, color: '#8e1b1b', label: 'strong decline' },
  { to: -0.05, color: '#e53935', label: 'decline' },
  { to: 0.05, color: '#78909c', label: 'stable ±0.05' },
  { to: 0.15, color: '#66bb6a', label: 'greening' },
  { to: Infinity, color: '#1b7f3b', label: 'strong greening' },
];

export function changeFill(delta) {
  if (delta == null) return '#b0bec5';
  return CHANGE_RAMP.find((s) => delta < s.to).color;
}

export function stressColor(stress) {
  return {
    healthy: '#2e7d32',
    moderate: '#ef6c00',
    stressed: '#c62828',
    warning: '#ef6c00',
    critical: '#c62828',
    'no-data': '#90a4ae',
  }[stress] || '#90a4ae';
}

// Outline colours for crops the backend catalog does not know (free-text crop
// names typed by farmers) — stable per name so the legend stays consistent.
const FALLBACK_CROP_COLORS = [
  '#64748b', '#0f766e', '#9333ea', '#b45309', '#0369a1', '#4d7c0f', '#be185d', '#7c2d12',
];

export function fallbackCropColor(name) {
  const s = String(name || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return FALLBACK_CROP_COLORS[h % FALLBACK_CROP_COLORS.length];
}

/**
 * Heat points for the stress / browning overlays.
 *   stress   — after-date stress (1 - NDVI, boosted by alerts)
 *   browning — only the parcels whose NDVI fell between the two dates
 */
export function toHeatPoints(items, mode) {
  const pts = [];
  if (mode === 'off') return pts;
  for (const it of items) {
    const lat = it.centroidLat ?? it.lat;
    const lon = it.centroidLon ?? it.lon;
    if (lat == null || lon == null) continue;
    if (mode === 'browning') {
      const delta = it.ndviDelta;
      if (delta == null || delta > -0.03) continue;
      pts.push([lat, lon, Number(Math.min(1, Math.abs(delta) * 3).toFixed(2))]);
      continue;
    }
    if (it.ndviAtDate?.ndviMean == null) continue;
    let intensity = Math.min(1, Math.max(0.05, 1 - it.ndviAtDate.ndviMean));
    if (it.openAlerts?.some((a) => a.severity === 'critical')) intensity = Math.max(intensity, 0.95);
    else if (it.openAlerts?.length > 0) intensity = Math.max(intensity, 0.7);
    pts.push([lat, lon, Number(intensity.toFixed(2))]);
  }
  return pts;
}

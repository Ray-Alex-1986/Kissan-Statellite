// ISRIC SoilGrids service.
//
// Provider switch (env SOIL_PROVIDER):
//   mock      -> realistic synthetic soil profile for the location (no network)
//   soilgrids -> WCS GetCoverage against ISRIC's documented WCS endpoint
//                (SoilGrids REST API is paused by ISRIC; WMS/WCS/downloads remain)
//
// Layers follow SoilGrids conventions; units as documented by ISRIC:
//   phh2o (pH x10), clay/sand/silt (%), soc (dg/kg), nitrogen (cg/kg),
//   cec (mmol(c)/kg), bdod (cg/cm3)
// Depths: 0-5, 5-15, 15-30, 30-60, 60-100, 100-200 cm.
//
// NOTE: one 250 m SoilGrids cell ~ 15.4 acres — present values as ESTIMATES and
// validate with laboratory soil tests before agronomic prescriptions.

const PROVIDER = process.env.SOIL_PROVIDER || 'mock';
const WCS_URL = process.env.SOILGRIDS_WCS_URL || 'https://maps.isric.org/mapserv?map=/map/wcs.map';

const DEPTHS = ['0-5cm', '5-15cm', '15-30cm', '30-60cm', '60-100cm', '100-200cm'];
const LAYERS = ['phh2o', 'clay', 'sand', 'silt', 'soc', 'nitrogen', 'cec', 'bdod'];

function wcsGetCoverageUrl(layer, lat, lon, size = 1) {
  const half = (250 * size) / 2 / 111320; // ~cell size in degrees
  const bbox = `${lon - half},${lat - half},${lon + half},${lat + half}`;
  const params = new URLSearchParams({
    SERVICE: 'WCS',
    VERSION: '2.0.1',
    REQUEST: 'GetCoverage',
    COVERAGEID: `${layer}_0-5cm_mean`,
    CRS: 'urn:ogc:def:crs:EPSG::4326',
    BBOX: bbox,
    WIDTH: String(size),
    HEIGHT: String(size),
    FORMAT: 'image/tiff',
  });
  return `${WCS_URL}&${params.toString()}`;
}

async function fetchWcsValue(layer, lat, lon) {
  const res = await fetch(wcsGetCoverageUrl(layer, lat, lon));
  if (!res.ok) throw new Error(`SoilGrids WCS failed for ${layer}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Minimal GeoTIFF single-pixel decode is out of scope here; in production use
  // gdal_translate / geotiff.js. This placeholder documents the call pattern.
  throw new Error('WCS TIFF decode not implemented in demo build — run with SOIL_PROVIDER=mock or decode via geotiff.js');
}

function deriveFromLocation(lat, lon) {
  // Soil texture gradient across Pakistan: alluvium in Punjab plains (higher silt),
  // sandier towards Sindh/southern zones. Used only for mock realism.
  const south = Math.max(0, Math.min(1, (31 - lat) / 6));
  const noise = Math.sin(lat * 12.9898 + lon * 78.233) * 0.5 + 0.5;
  return {
    ph: 7.1 + south * 0.7 + noise * 0.3,
    clay: Math.round(28 - south * 10 + noise * 8),
    sand: Math.round(24 + south * 18 + noise * 10),
    silt: 0, // computed below
    soc: 9 + noise * 6 - south * 2,
    nitrogen: 0.8 + noise * 0.5,
    cec: 26 + noise * 8,
    bdod: 1.32 + noise * 0.1,
  };
}

export async function getSoilProfile(lat, lon) {
  if (PROVIDER === 'soilgrids') {
    for (const l of LAYERS) await fetchWcsValue(l, lat, lon); // production path
  }
  const base = deriveFromLocation(lat, lon);
  base.silt = Math.max(10, 100 - base.clay - base.sand);
  const layers = {};
  DEPTHS.forEach((depth, i) => {
    const decay = Math.exp(-i * 0.35);
    layers[depth] = {
      ph: Number((base.ph - i * 0.04).toFixed(1)),
      clay: Math.max(5, Math.round(base.clay - i * 2)),
      sand: Math.max(5, Math.round(base.sand - i)),
      silt: Math.max(10, Math.round(base.silt - i * 1.5)),
      organicCarbonDgPerKg: Number((base.soc * decay).toFixed(1)),
      nitrogenCgPerKg: Number((base.nitrogen * decay).toFixed(2)),
      cecMmolPerKg: Math.round(base.cec * (1 - i * 0.05)),
      bulkDensityCgPerCm3: Number((base.bdod + i * 0.03).toFixed(2)),
      uncertainty: { relative: Number((0.12 + i * 0.03).toFixed(2)) },
    };
  });
  return layers;
}

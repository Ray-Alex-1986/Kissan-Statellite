import { Router } from 'express';
import { CropMaster } from '../models/index.js';

const router = Router();

// FAO-aligned crop vocabulary (AGROVOC-based, Pakistan focus) used as fallback
// before crop_master is seeded. From then on, /crops is served from the
// configurable crop master table (spec A4) so admins control the catalogue.
const FALLBACK_CROPS = [
  'Wheat', 'Rice (Paddy)', 'Cotton', 'Sugarcane', 'Maize', 'Gram (Chickpea)',
  'Lentil', 'Mustard', 'Canola', 'Sunflower', 'Barley', 'Sorghum (Jowar)',
  'Millet (Bajra)', 'Potato', 'Onion', 'Tomato', 'Chilli', 'Soybean', 'Tobacco', 'Fodder (Berseem)',
];

const DISTRICTS = [
  'Lahore', 'Gujranwala', 'Faisalabad', 'Multan', 'Bahawalpur', 'Rawalpindi',
  'Sialkot', 'Sheikhupura', 'Sargodha', 'Dera Ghazi Khan', 'Rahim Yar Khan',
  'Hyderabad', 'Sukkur', 'Khairpur', 'Larkana', 'Naushahro Feroze',
  'Peshawar', 'Mardan', 'Charsadda', 'Dera Ismail Khan',
  'Quetta', 'Sibi', 'Naseerabad',
];

const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Gilgit-Baltistan', 'AJK'];

const SOIL_PROPERTIES = [
  { key: 'ph', label: 'Soil pH (pH 1:2.5 H2O)', unit: 'pH', depths: true },
  { key: 'clay', label: 'Clay content', unit: '% (w/w)', depths: true },
  { key: 'sand', label: 'Sand content', unit: '% (w/w)', depths: true },
  { key: 'silt', label: 'Silt content', unit: '% (w/w)', depths: true },
  { key: 'organicCarbonDgPerKg', label: 'Soil organic carbon', unit: 'dg/kg', depths: true },
  { key: 'nitrogenCgPerKg', label: 'Total nitrogen', unit: 'cg/kg', depths: true },
  { key: 'cecMmolPerKg', label: 'Cation exchange capacity', unit: 'mmol(c)/kg', depths: true },
  { key: 'bulkDensityCgPerCm3', label: 'Bulk density', unit: 'cg/cm³', depths: true },
];

// Stable reference vocabularies for data-entry forms (spec A8/A9/G34). These
// are field labels, not business rules; they mirror the spec's lists.
const FERTILIZERS = ['Urea', 'DAP', 'SOP', 'MOP', 'NPK', 'Organic Fertilizer', 'Other'];
const SOWING_METHODS = ['Drill', 'Broadcast', 'Transplant', 'Ridge & Furrow', 'Other'];
const IRRIGATION_SOURCES = ['Canal', 'Tube well', 'Rain-fed', 'Drip', 'Sprinkler', 'Other'];
const GROWTH_STAGES = ['Germination', 'Vegetative', 'Reproductive', 'Maturity', 'Harvest'];
const SEASONS = ['Kharif', 'Rabi', 'Zaid', 'Perennial', 'Other'];
const ADVISORY_CATEGORIES = [
  'sowing_window', 'seed_rate', 'fertilizer', 'irrigation', 'weather',
  'heat_stress', 'rainfall', 'moisture_stress', 'vegetation_stress',
  'growth_stage', 'harvesting', 'information',
];
const ADVISORY_SEVERITIES = ['information', 'normal', 'attention', 'warning', 'critical'];

router.get('/crops', async (req, res) => {
  try {
    const rows = await CropMaster.findAll({ where: { active: true }, attributes: ['name'], order: [['name', 'ASC']] });
    if (rows.length) return res.json(rows.map((r) => r.name));
  } catch {
    // crop_master not available (e.g. mid-migration) — fall through to static list.
  }
  res.json(FALLBACK_CROPS);
});
router.get('/districts', (req, res) => res.json(DISTRICTS));
router.get('/provinces', (req, res) => res.json(PROVINCES));
router.get('/soil-properties', (req, res) => res.json(SOIL_PROPERTIES));
router.get('/fertilizers', (req, res) => res.json(FERTILIZERS));
router.get('/sowing-methods', (req, res) => res.json(SOWING_METHODS));
router.get('/irrigation-sources', (req, res) => res.json(IRRIGATION_SOURCES));
router.get('/growth-stages', (req, res) => res.json(GROWTH_STAGES));
router.get('/seasons', (req, res) => res.json(SEASONS));
router.get('/advisory-categories', (req, res) => res.json(ADVISORY_CATEGORIES));
router.get('/advisory-severities', (req, res) => res.json(ADVISORY_SEVERITIES));

export default router;

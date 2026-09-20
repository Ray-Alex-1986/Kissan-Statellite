import { Router } from 'express';

const router = Router();

// FAO-aligned crop vocabulary (AGROVOC-based, Pakistan focus) + reference lists.
const CROPS = [
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

router.get('/crops', (req, res) => res.json(CROPS));
router.get('/districts', (req, res) => res.json(DISTRICTS));
router.get('/provinces', (req, res) => res.json(PROVINCES));
router.get('/soil-properties', (req, res) => res.json(SOIL_PROPERTIES));

export default router;

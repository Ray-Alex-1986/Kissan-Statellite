import bcrypt from 'bcryptjs';
import { initDb, sequelize } from '../config/db.js';
import { User, Farm, CropSeason, Observation, Alert, SoilProfile, CropMaster, AdvisoryRule } from '../models/index.js';
import { rectangleAround } from '../utils/geo.js';
import { mockNdviSeries, detectNdviAlerts } from '../services/sentinelService.js';
import { getSoilProfile } from '../services/soilgridsService.js';

// Demo users for the MNFSR pilot.
const USERS = [
  { name: 'MNFSR Administrator', email: 'admin@mnfsr.gov.pk', password: 'Admin@123', role: 'admin', district: 'Islamabad', province: 'ICT' },
  { name: 'District Officer (Sheikhupura)', email: 'officer@mnfsr.gov.pk', password: 'Officer@123', role: 'officer', district: 'Sheikhupura', province: 'Punjab' },
  { name: 'Muhammad Ashraf', email: 'farmer@demo.gov.pk', password: 'Farmer@123', role: 'farmer', phone: '+92 300 1234567', cnic: '35202-1234567-1', district: 'Sheikhupura', province: 'Punjab' },
  { name: 'Rana Imtiaz Ahmed', email: 'imtiaz@demo.gov.pk', password: 'Farmer@123', role: 'farmer', phone: '+92 301 7654321', cnic: '35202-7654321-3', district: 'Gujranwala', province: 'Punjab' },
];

// [ownerIndex, name, district, tehsil, lat, lon, area]
const FARMS = [
  [2, 'Ashraf Kalan Farm', 'Sheikhupura', 'Ferozewala', 31.784, 74.035, 12.5],
  [2, 'Ravi Belt Plot', 'Sheikhupura', 'Muridke', 31.792, 74.12, 8.2],
  [3, 'Ahmed Brothers Orchard', 'Gujranwala', 'Kamoke', 31.842, 74.008, 15.0],
];

const CROPS = [
  [0, 'Wheat', 'Galaxy-2013', 'Rabi', 170],
  [1, 'Rice (Paddy)', 'Super Basmati', 'Kharif', 130],
  [2, 'Cotton', 'MNH-886', 'Kharif', 150],
];

// Configurable crop catalogue (spec A4/A5): code, name, scientific name,
// category, default season, sowing window (MM-DD), harvest window (MM-DD),
// duration (days), seed rate, seed rate unit, agronomic notes.
const CROP_MASTER = [
  ['WHEAT', 'Wheat', 'Triticum aestivum', 'Cereal', 'Rabi', '11-01', '11-30', '04-15', '05-15', 165, 50, 'kg/acre', 'Timely sowing (early November) maximizes yield; past mid-December raise the seed rate for late sowing.'],
  ['RICE', 'Rice (Paddy)', 'Oryza sativa', 'Cereal', 'Kharif', '05-20', '06-30', '10-15', '11-30', 125, 8, 'kg/acre (nursery)', 'Transplant 25–35 day seedlings; maintain standing water at tillering and flowering.'],
  ['COTTON', 'Cotton', 'Gossypium hirsutum', 'Fiber', 'Kharif', '04-15', '05-31', '09-01', '11-30', 180, 6, 'kg/acre', 'Sow on ridges once cold spells have passed; monitor sucking pests from squaring.'],
  ['SUGARCANE', 'Sugarcane', 'Saccharum officinarum', 'Sugar', 'Perennial', '02-01', '03-15', '11-01', '03-31', 330, 25000, 'setts/acre', 'Plant 2-bud setts; a ratoon crop follows the plant crop.'],
  ['MAIZE', 'Maize', 'Zea mays', 'Cereal', 'Kharif', '07-01', '08-15', '10-01', '11-15', 110, 15, 'kg/acre', 'Spring (Feb–Mar) and autumn (Jul–Aug) windows are both common; season configurable by region.'],
  ['GRAM', 'Gram (Chickpea)', 'Cicer arietinum', 'Legume', 'Rabi', '10-15', '11-30', '03-01', '04-15', 115, 30, 'kg/acre', 'Prefer residual soil moisture; keep irrigation minimal.'],
  ['LENTIL', 'Lentil', 'Lens culinaris', 'Legume', 'Rabi', '10-15', '11-15', '03-01', '04-15', 110, 20, 'kg/acre', 'Well-drained loams; avoid waterlogging.'],
  ['MUSTARD', 'Mustard', 'Brassica juncea', 'Oilseed', 'Rabi', '09-15', '10-31', '02-15', '03-31', 125, 2, 'kg/acre', 'Thin to ~30 cm spacing at the 2-leaf stage.'],
  ['CANOLA', 'Canola', 'Brassica napus', 'Oilseed', 'Rabi', '10-01', '10-31', '03-01', '04-15', 165, 3, 'kg/acre', 'Use certified hybrid seed; responsive to boron.'],
  ['SUNFLOWER', 'Sunflower', 'Helianthus annuus', 'Oilseed', 'Kharif', '07-01', '08-15', '10-01', '11-30', 105, 4, 'kg/acre', 'A spring window (Jan–Feb) is also possible; ensure irrigation in the pollination week.'],
  ['BARLEY', 'Barley', 'Hordeum vulgare', 'Cereal', 'Rabi', '11-01', '11-30', '04-01', '04-30', 135, 40, 'kg/acre', 'Drought-tolerant; suited to rainfed barani areas.'],
  ['SORGHUM', 'Sorghum (Jowar)', 'Sorghum bicolor', 'Cereal', 'Kharif', '06-15', '07-31', '10-01', '11-15', 110, 8, 'kg/acre', 'Dual-purpose grain/fodder; tolerates heat.'],
  ['MILLET', 'Millet (Bajra)', 'Pennisetum glaucum', 'Cereal', 'Kharif', '06-15', '07-31', '09-15', '10-31', 80, 4, 'kg/acre', 'Short duration; escapes terminal drought.'],
  ['POTATO', 'Potato', 'Solanum tuberosum', 'Vegetable', 'Rabi', '10-01', '11-15', '01-15', '02-28', 100, 1200, 'kg tubers/acre', 'Autumn crop; spring planting (Jan) in cooler northern areas.'],
  ['ONION', 'Onion', 'Allium cepa', 'Vegetable', 'Kharif', '10-15', '11-30', '03-01', '04-30', 140, 6, 'kg/acre', 'Transplant 6–8 week seedlings; cure bulbs before storage.'],
  ['TOMATO', 'Tomato', 'Solanum lycopersicum', 'Vegetable', 'Kharif', '08-01', '09-15', '11-01', '01-31', 100, 0.3, 'kg/acre', 'Autumn transplants; stake and prune for market quality.'],
  ['CHILLI', 'Chilli', 'Capsicum annuum', 'Vegetable', 'Kharif', '05-01', '06-30', '09-01', '11-30', 135, 0.6, 'kg/acre', 'Long duration; pick ripe red pods repeatedly.'],
  ['SOYBEAN', 'Soybean', 'Glycine max', 'Legume', 'Kharif', '06-15', '07-31', '10-01', '11-15', 100, 25, 'kg/acre', 'Inoculate with Rhizobium; fixes nitrogen for the rotation.'],
  ['TOBACCO', 'Tobacco', 'Nicotiana tabacum', 'Industrial', 'Other', '03-01', '04-30', '07-01', '08-31', 130, 0.3, 'kg/acre', 'Nursery transplants on raised beds.'],
  ['BERSEEM', 'Fodder (Berseem)', 'Trifolium alexandrinum', 'Fodder', 'Rabi', '10-01', '11-15', '12-01', '04-30', 150, 6, 'kg/acre', 'Multiple cuts (5–7); leave the last cut for seed.'],
];

// Demo advisory rules (spec Part G-33). The Phase 6 advisory engine evaluates
// these declarative conditions; admins can edit them without code changes.
// Existing rules are never overwritten — seeding only adds the missing ones.
const ADVISORY_RULES = [
  {
    name: 'Moisture stress indicator (NDMI decline)',
    category: 'moisture_stress',
    severity: 'warning',
    conditions: { index: 'NDMI', operator: '<', value: 0.05, minObservations: 3, cropStatus: 'growing' },
    messageTemplate: 'Moisture stress indicator detected: recent satellite passes show NDMI {latestValue} (below {threshold}). Review field moisture conditions before the next irrigation decision. Field verification recommended.',
  },
  {
    name: 'Potential vegetation stress (low NDVI)',
    category: 'vegetation_stress',
    severity: 'attention',
    conditions: { index: 'NDVI', operator: '<', value: 0.3, minObservations: 2, cropStatus: 'growing' },
    messageTemplate: 'Potential vegetation stress detected (NDVI {latestValue}). This is an indicator only — field verification recommended before any treatment decision.',
  },
  {
    name: 'Heat stress alert (high temperature)',
    category: 'heat_stress',
    severity: 'warning',
    conditions: { weather: 'maxTemperature', operator: '>=', value: 40 },
    messageTemplate: 'High temperature expected ({latestValue} °C maximum). Heat stress can affect pollination and grain set — consider irrigation scheduling and field monitoring.',
  },
  {
    name: 'Wheat sowing window reminder',
    cropName: 'Wheat',
    category: 'sowing_window',
    severity: 'information',
    conditions: { windowStart: '10-15', windowEnd: '11-30' },
    messageTemplate: 'The typical sowing window for Wheat in your region is 15 October – 30 November. Timely sowing strongly affects yield.',
  },
  {
    name: 'Late sowing — adjust seed rate',
    cropName: 'Wheat',
    category: 'seed_rate',
    severity: 'attention',
    conditions: { sowingWindowStatus: 'late', daysSinceSowingMax: 60 },
    messageTemplate: 'The Wheat crop was sown on {sowingDate}, about {daysOffset} days {earlyLate} ({windowStart} – {windowEnd}). For late-sown wheat, a higher seed rate and early-maturing varieties are standard practice — confirm the right rate with your local agriculture office.',
  },
  {
    name: 'Vegetative stage — split nitrogen timing',
    category: 'fertilizer',
    severity: 'normal',
    conditions: { growthStage: 'Vegetative', daysSinceSowingMin: 21, daysSinceSowingMax: 45, cropStatus: 'growing' },
    messageTemplate: '{cropName} is in vegetative growth (about day {daysSinceSowing} after sowing). If a split nitrogen application is planned, this is the typical window for it — confirm dose and timing with your local agriculture office.',
  },
  {
    name: 'Irrigation at reproductive stage',
    category: 'irrigation',
    severity: 'normal',
    conditions: { growthStage: ['Reproductive', 'Maturity'], cropStatus: 'growing' },
    messageTemplate: '{cropName} is at the {stage} stage (about day {daysSinceSowing} after sowing). Moisture stress in this period affects grain formation — keep soil moisture adequate and check field moisture before the next irrigation.',
  },
  {
    name: 'Rain forecast — review irrigation plan',
    category: 'rainfall',
    severity: 'information',
    conditions: { weather: { field: 'precipitation', operator: '>=', value: 10, withinDays: 3 } },
    messageTemplate: 'About {weatherValue} mm of rain is forecast within the next {withinDays} days. Consider adjusting or postponing the next irrigation to avoid waterlogging and nutrient leaching.',
  },
  {
    name: 'Dry spell — moisture stress watch',
    category: 'moisture_stress',
    severity: 'attention',
    conditions: { index: 'NDMI', operator: '<', value: 0.1, minObservations: 2, weather: { field: 'precipitation', operator: '<=', value: 2, withinDays: 7 } },
    messageTemplate: 'Canopy water is low (NDMI {indexValue}) and only about {weatherValue} mm of rain is forecast over the next {withinDays} days. If the crop is actively growing, review the irrigation schedule — confirm field moisture levels before acting.',
  },
  {
    name: 'Harvest approaching — plan field operations',
    category: 'harvesting',
    severity: 'attention',
    conditions: { daysToHarvestMax: 10, cropStatus: 'growing' },
    messageTemplate: '{cropName} is approaching its expected harvest date ({expectedHarvestDate}, {daysToHarvestLabel}). Plan harvesting, labour and storage, and check grain moisture before combining.',
  },
];

async function run() {
  await initDb();

  for (const u of USERS) {
    await User.upsert({
      name: u.name, email: u.email, role: u.role, phone: u.phone, cnic: u.cnic,
      district: u.district, province: u.province,
      passwordHash: bcrypt.hashSync(u.password, 10),
    });
  }

  const farmers = await User.findAll({ where: { role: 'farmer' } });
  const ownerByIndex = (idx) => farmers.find((f) => f.email === USERS[idx].email);

  if (process.env.SEED_DEMO_DATA !== 'false') {
    for (let i = 0; i < FARMS.length; i++) {
      const [fi, name, district, tehsil, lat, lon, area] = FARMS[i];
      const owner = ownerByIndex(fi);
      let farm = await Farm.findOne({ where: { name } });
      if (!farm) {
        const boundary = rectangleAround(lat, lon, 0.006 + i * 0.001);
        farm = await Farm.create({
          ownerId: owner.id, name, district, tehsil, province: 'Punjab',
          totalAreaAcres: area, irrigationSource: i === 2 ? 'tubewell' : 'canal',
          boundary, centroidLat: lat, centroidLon: lon,
        });
      }
      const [cropName, variety, season, daysAgo] = CROPS[i].slice(1);
      const sowing = new Date(Date.now() - daysAgo * 864e5);
      const [cs] = await CropSeason.findOrCreate({
        where: { farmId: farm.id, cropName, season },
        defaults: {
          farmId: farm.id, cropName, variety, season,
          sowingDate: sowing.toISOString().slice(0, 10),
          areaAcres: area, status: 'growing', irrigationCount: 4,
        },
      });
      const from = new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const series = mockNdviSeries(farm.id, cs.sowingDate, from, to);
      for (const s of series) {
        await Observation.upsert({ farmId: farm.id, source: 'sentinel-2', ...s });
      }
      for (const a of detectNdviAlerts(farm.id, series)) {
        await Alert.findOrCreate({ where: { farmId: a.farmId, type: a.type, message: a.message }, defaults: a });
      }
      const layers = await getSoilProfile(lat, lon);
      await SoilProfile.findOrCreate({
        where: { farmId: farm.id },
        defaults: { farmId: farm.id, source: 'soilgrids(mock)', sourceVersion: '2.0', lat, lon, layers },
      });
    }
  }

  // Reference data: the configurable crop catalogue and demo advisory rules.
  // Seeded on every run (idempotent) so a fresh deployment is usable without
  // demo farm data.
  for (const [code, name, scientificName, category, defaultSeason, sowingWindowStart, sowingWindowEnd, harvestWindowStart, harvestWindowEnd, durationDays, seedRateValue, seedRateUnit, agronomicNotes] of CROP_MASTER) {
    const [row] = await CropMaster.findOrCreate({
      where: { code },
      defaults: { name, scientificName, category, defaultSeason, sowingWindowStart, sowingWindowEnd, harvestWindowStart, harvestWindowEnd, durationDays, seedRateValue, seedRateUnit, agronomicNotes },
    });
    await row.update({ name, scientificName, category, defaultSeason, sowingWindowStart, sowingWindowEnd, harvestWindowStart, harvestWindowEnd, durationDays, seedRateValue, seedRateUnit, agronomicNotes });
  }
  for (const r of ADVISORY_RULES) {
    await AdvisoryRule.findOrCreate({ where: { name: r.name }, defaults: r });
  }

  console.log('[seed] done. Demo logins:');
  console.log('  admin : admin@mnfsr.gov.pk / Admin@123');
  console.log('  officer: officer@mnfsr.gov.pk / Officer@123');
  console.log('  farmer: farmer@demo.gov.pk / Farmer@123 (also imtiaz@demo.gov.pk)');
  await sequelize.close();
}

run().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});

import bcrypt from 'bcryptjs';
import { initDb, sequelize } from '../config/db.js';
import { User, Farm, CropSeason, Observation, Alert, SoilProfile } from '../models/index.js';
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

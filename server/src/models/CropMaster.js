import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Configurable crop catalogue (spec Parts A-4 / A-5). Administrators maintain
// this table from the admin panel; frontend components never hard-code crops.
// `defaultSeason` carries the Rabi/Kharif/Perennial identification and can be
// adjusted per region without code changes.
export const CropMaster = sequelize.define(
  'CropMaster',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    scientificName: { type: DataTypes.STRING(160) },
    category: { type: DataTypes.STRING(60) },
    defaultSeason: {
      type: DataTypes.STRING(20),
      validate: { isIn: [['Kharif', 'Rabi', 'Zaid', 'Perennial', 'Other']] },
    },
    // Windows are MM-DD strings; they are hemisphere-fixed reference windows,
    // not year-specific dates.
    sowingWindowStart: { type: DataTypes.STRING(5) },
    sowingWindowEnd: { type: DataTypes.STRING(5) },
    harvestWindowStart: { type: DataTypes.STRING(5) },
    harvestWindowEnd: { type: DataTypes.STRING(5) },
    durationDays: { type: DataTypes.INTEGER },
    seedRateValue: { type: DataTypes.FLOAT },
    seedRateUnit: { type: DataTypes.STRING(30) },
    agronomicNotes: { type: DataTypes.TEXT },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'crop_master' }
);

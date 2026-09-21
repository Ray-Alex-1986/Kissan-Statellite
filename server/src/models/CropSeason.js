import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const CropSeason = sequelize.define(
  'CropSeason',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropName: { type: DataTypes.STRING(120), allowNull: false },
    variety: { type: DataTypes.STRING(120) },
    // varchar (not ENUM) so Rabi/Kharif/Perennial/Other values stay configurable
    // from the admin panel without Postgres ENUM migrations (spec A5).
    season: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [['Kharif', 'Rabi', 'Zaid', 'Perennial', 'Other']] },
    },
    sowingDate: { type: DataTypes.DATEONLY, allowNull: false },
    expectedGerminationDate: { type: DataTypes.DATEONLY },
    expectedHarvestDate: { type: DataTypes.DATEONLY },
    actualHarvestDate: { type: DataTypes.DATEONLY },
    areaAcres: { type: DataTypes.FLOAT },
    seedSource: { type: DataTypes.STRING(120) },
    seedRateKgPerAcre: { type: DataTypes.FLOAT },
    sowingMethod: { type: DataTypes.STRING(60) },
    irrigationMethod: { type: DataTypes.STRING(60) },
    previousCrop: { type: DataTypes.STRING(120) },
    fertilizerApplied: { type: DataTypes.STRING(255) },
    irrigationCount: { type: DataTypes.INTEGER },
    status: { type: DataTypes.ENUM('planned', 'growing', 'harvested'), defaultValue: 'growing' },
    remarks: { type: DataTypes.TEXT },
    notes: { type: DataTypes.TEXT },
  },
  { tableName: 'crop_seasons' }
);

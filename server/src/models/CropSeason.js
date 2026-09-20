import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const CropSeason = sequelize.define(
  'CropSeason',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropName: { type: DataTypes.STRING(120), allowNull: false },
    variety: { type: DataTypes.STRING(120) },
    season: { type: DataTypes.ENUM('Kharif', 'Rabi', 'Zaid'), allowNull: false },
    sowingDate: { type: DataTypes.DATEONLY, allowNull: false },
    expectedHarvestDate: { type: DataTypes.DATEONLY },
    areaAcres: { type: DataTypes.FLOAT },
    seedSource: { type: DataTypes.STRING(120) },
    seedRateKgPerAcre: { type: DataTypes.FLOAT },
    fertilizerApplied: { type: DataTypes.STRING(255) },
    irrigationCount: { type: DataTypes.INTEGER },
    status: { type: DataTypes.ENUM('planned', 'growing', 'harvested'), defaultValue: 'growing' },
    notes: { type: DataTypes.TEXT },
  },
  { tableName: 'crop_seasons' }
);

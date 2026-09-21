import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Structured fertilizer application record (spec Part A-8). One row per
// application event, tied to the farm and (optionally) the active crop cycle.
export const FertilizerApplication = sequelize.define(
  'FertilizerApplication',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropSeasonId: { type: DataTypes.INTEGER },
    fertilizer: { type: DataTypes.STRING(60), allowNull: false },
    applicationDate: { type: DataTypes.DATEONLY, allowNull: false },
    quantity: { type: DataTypes.FLOAT },
    unit: { type: DataTypes.STRING(20), defaultValue: 'kg' },
    method: { type: DataTypes.STRING(60) },
    growthStage: { type: DataTypes.STRING(60) },
    remarks: { type: DataTypes.TEXT },
  },
  { tableName: 'fertilizer_applications' }
);

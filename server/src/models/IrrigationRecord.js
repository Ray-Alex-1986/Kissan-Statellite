import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Irrigation event record (spec Part A-9).
export const IrrigationRecord = sequelize.define(
  'IrrigationRecord',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropSeasonId: { type: DataTypes.INTEGER },
    irrigationDate: { type: DataTypes.DATEONLY, allowNull: false },
    waterSource: { type: DataTypes.STRING(60) },
    method: { type: DataTypes.STRING(60) },
    durationHours: { type: DataTypes.FLOAT },
    estimatedQuantity: { type: DataTypes.FLOAT },
    quantityUnit: { type: DataTypes.STRING(20) },
    remarks: { type: DataTypes.TEXT },
  },
  { tableName: 'irrigation_records' }
);

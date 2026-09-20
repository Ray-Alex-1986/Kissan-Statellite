import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Satellite observation summary for a farm on a date (Sentinel-2 NDVI by default).
export const Observation = sequelize.define(
  'Observation',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    source: { type: DataTypes.STRING(40), defaultValue: 'sentinel-2' },
    ndviMean: { type: DataTypes.FLOAT },
    ndviMin: { type: DataTypes.FLOAT },
    ndviMax: { type: DataTypes.FLOAT },
    cloudPct: { type: DataTypes.FLOAT },
    dataCoveragePct: { type: DataTypes.FLOAT },
    stats: { type: DataTypes.JSONB },
  },
  { tableName: 'observations', indexes: [{ unique: true, fields: ['farmId', 'date', 'source'] }] }
);

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Satellite processing job (spec Part P-57). Created when a farm's index
// history is requested/backfilled; the UI can surface status transitions
// (pending → processing → completed/failed) without recomputing on page load.
export const SatelliteJob = sequelize.define(
  'SatelliteJob',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    indexType: { type: DataTypes.STRING(10), defaultValue: 'ALL' },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending',
      validate: { isIn: [['pending', 'processing', 'completed', 'failed']] },
    },
    requestedById: { type: DataTypes.INTEGER },
    params: { type: DataTypes.JSONB },
    scenesFound: { type: DataTypes.INTEGER },
    scenesProcessed: { type: DataTypes.INTEGER },
    error: { type: DataTypes.TEXT },
    startedAt: { type: DataTypes.DATE },
    finishedAt: { type: DataTypes.DATE },
  },
  { tableName: 'satellite_jobs' }
);

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const Alert = sequelize.define(
  'Alert',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    // VARCHAR + isIn rather than a native PG ENUM: sync({alter}) cannot extend
    // an existing enum type, which would block new alert kinds from the
    // pipeline (e.g. ndmi_water_stress). Widened by migration 003.
    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      validate: { isIn: [['ndvi_decline', 'ndmi_water_stress', 'low_vigor', 'flood', 'data_gap', 'other']] },
    },
    severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), defaultValue: 'warning' },
    message: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM('open', 'acknowledged', 'resolved'), defaultValue: 'open' },
  },
  { tableName: 'alerts' }
);

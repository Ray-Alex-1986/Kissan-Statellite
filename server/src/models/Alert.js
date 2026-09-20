import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const Alert = sequelize.define(
  'Alert',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.ENUM('ndvi_decline', 'low_vigor', 'flood', 'data_gap', 'other'), allowNull: false },
    severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), defaultValue: 'warning' },
    message: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM('open', 'acknowledged', 'resolved'), defaultValue: 'open' },
  },
  { tableName: 'alerts' }
);

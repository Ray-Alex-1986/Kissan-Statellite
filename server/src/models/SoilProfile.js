import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Estimated soil profile from ISRIC SoilGrids (or mock). `layers` holds values per
// depth interval with units and uncertainty, e.g.
// { "0-5cm": { "ph": 7.5, "clay": 32, "sand": 22, "silt": 46, "soc": 12.4,
//              "nitrogen": 1.1, "cec": 28, "bdod": 1.35, "uncertainty": {...} } }
export const SoilProfile = sequelize.define(
  'SoilProfile',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    source: { type: DataTypes.STRING(40), defaultValue: 'soilgrids' },
    sourceVersion: { type: DataTypes.STRING(40), defaultValue: '2.0' },
    lat: { type: DataTypes.FLOAT, allowNull: false },
    lon: { type: DataTypes.FLOAT, allowNull: false },
    layers: { type: DataTypes.JSONB, allowNull: false },
    fetchedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: 'soil_profiles' }
);

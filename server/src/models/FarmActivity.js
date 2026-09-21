import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Unified chronological farm timeline entry (spec Part H-37): registration,
// crop registration, sowing, satellite passes, weather events, fertilizer,
// irrigation, advisories, harvest. `source` distinguishes user-entered events
// from system-generated ones; `meta` carries type-specific payload.
export const FarmActivity = sequelize.define(
  'FarmActivity',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropSeasonId: { type: DataTypes.INTEGER },
    activityDate: { type: DataTypes.DATEONLY, allowNull: false },
    type: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        isIn: [[
          'registration', 'crop_registration', 'sowing', 'fertilizer',
          'irrigation', 'satellite', 'weather', 'advisory', 'harvest', 'other',
        ]],
      },
    },
    description: { type: DataTypes.TEXT },
    source: { type: DataTypes.STRING(10), defaultValue: 'user', validate: { isIn: [['user', 'system']] } },
    userId: { type: DataTypes.INTEGER },
    meta: { type: DataTypes.JSONB },
  },
  {
    tableName: 'farm_activities',
    indexes: [{ fields: ['farmId', 'activityDate'], name: 'farm_activities_farm_date' }],
  }
);

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Cached daily forecast per farm (spec Part B). Refreshed on a short TTL by the
// weather service; served from here otherwise.
export const WeatherForecast = sequelize.define(
  'WeatherForecast',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    forecastFor: { type: DataTypes.DATEONLY, allowNull: false },
    tempMinC: { type: DataTypes.FLOAT },
    tempMaxC: { type: DataTypes.FLOAT },
    precipitationMm: { type: DataTypes.FLOAT },
    precipitationProbabilityPct: { type: DataTypes.FLOAT },
    weatherCode: { type: DataTypes.INTEGER },
    windSpeedMaxKmh: { type: DataTypes.FLOAT },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    retrievedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'weather_forecasts',
    indexes: [{ unique: true, fields: ['farmId', 'forecastFor', 'provider'], name: 'weather_fc_farm_for_provider' }],
  }
);

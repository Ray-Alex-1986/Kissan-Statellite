import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Cached weather observation for a farm location (spec Part B-13). Rows are
// keyed by farm + datetime + provider so identical historical observations are
// never fetched twice from the external provider.
export const WeatherObservation = sequelize.define(
  'WeatherObservation',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    observationDatetime: { type: DataTypes.DATE, allowNull: false },
    temperature: { type: DataTypes.FLOAT },
    minTemperature: { type: DataTypes.FLOAT },
    maxTemperature: { type: DataTypes.FLOAT },
    humidity: { type: DataTypes.FLOAT },
    precipitationMm: { type: DataTypes.FLOAT },
    rainfallMm: { type: DataTypes.FLOAT },
    windSpeedKmh: { type: DataTypes.FLOAT },
    windDirectionDeg: { type: DataTypes.FLOAT },
    weatherCode: { type: DataTypes.INTEGER },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    latitude: { type: DataTypes.FLOAT, allowNull: false },
    longitude: { type: DataTypes.FLOAT, allowNull: false },
    retrievedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'weather_observations',
    indexes: [
      { unique: true, fields: ['farmId', 'observationDatetime', 'provider'], name: 'weather_obs_farm_dt_provider' },
      { fields: ['farmId', 'observationDatetime'], name: 'weather_obs_farm_dt' },
    ],
  }
);

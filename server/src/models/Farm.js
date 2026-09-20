import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Boundary is stored as GeoJSON (EPSG:4326). In Postgres deployments the same
// geometry is mirrored into a PostGIS `geom` column for ST_Intersects queries.
export const Farm = sequelize.define(
  'Farm',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    address: { type: DataTypes.STRING(255) },
    district: { type: DataTypes.STRING(80), allowNull: false },
    tehsil: { type: DataTypes.STRING(80) },
    province: { type: DataTypes.STRING(80) },
    totalAreaAcres: { type: DataTypes.FLOAT },
    irrigationSource: {
      type: DataTypes.ENUM('canal', 'tubewell', 'rainfed', 'canal+tubewell', 'other'),
      defaultValue: 'canal',
    },
    boundary: { type: DataTypes.JSONB, allowNull: false },
    centroidLat: { type: DataTypes.FLOAT, allowNull: false },
    centroidLon: { type: DataTypes.FLOAT, allowNull: false },
  },
  { tableName: 'farms' }
);

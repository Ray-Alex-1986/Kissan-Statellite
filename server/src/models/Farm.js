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
    farmCode: { type: DataTypes.STRING(20), unique: true },
    status: {
      type: DataTypes.ENUM('active', 'fallow', 'suspended'),
      defaultValue: 'active',
    },
    address: { type: DataTypes.STRING(255) },
    village: { type: DataTypes.STRING(120) },
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
  {
    tableName: 'farms',
    hooks: {
      // Human-readable registry code (spec A1): F-00001, F-00002, ...
      afterCreate: async (farm) => {
        if (farm.farmCode) return;
        farm.farmCode = `F-${String(farm.id).padStart(5, '0')}`;
        await farm.save({ hooks: false });
      },
      // Mirror the GeoJSON boundary into the PostGIS geom column so spatial
      // queries (ST_Intersects, ST_Area on geography) are available. The JSONB
      // boundary remains the source of truth; non-Postgres dialects skip this.
      afterSave: async (farm) => {
        if (!farm.boundary) return;
        try {
          await sequelize.query(
            'UPDATE farms SET geom = ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326) WHERE id = :id',
            { replacements: { g: JSON.stringify(farm.boundary), id: farm.id } }
          );
        } catch {
          // geom mirror requires PostGIS; JSONB boundary remains authoritative.
        }
      },
    },
  }
);

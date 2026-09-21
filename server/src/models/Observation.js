import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Satellite observation summary for a farm on a date. Rows are per index type
// (NDVI/NDMI/NDRE, spec D20-D22): ndviMean/Min/Max remain the storage for NDVI
// rows consumed by existing dashboards; `medianValue`/`stdDevValue` are the
// generic stats columns used for every index. Never overwritten in place —
// new passes upsert on (farm, date, source, indexType).
export const Observation = sequelize.define(
  'Observation',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    source: { type: DataTypes.STRING(40), defaultValue: 'sentinel-2' },
    indexType: {
      type: DataTypes.STRING(10),
      defaultValue: 'NDVI',
      validate: { isIn: [['NDVI', 'NDMI', 'NDRE']] },
    },
    ndviMean: { type: DataTypes.FLOAT },
    ndviMin: { type: DataTypes.FLOAT },
    ndviMax: { type: DataTypes.FLOAT },
    medianValue: { type: DataTypes.FLOAT },
    stdDevValue: { type: DataTypes.FLOAT },
    cloudPct: { type: DataTypes.FLOAT },
    dataCoveragePct: { type: DataTypes.FLOAT },
    stats: { type: DataTypes.JSONB },
  },
  {
    tableName: 'observations',
    indexes: [
      {
        unique: true,
        fields: ['farmId', 'date', 'source', 'indexType'],
        name: 'observations_farm_id_date_source_index_type',
      },
    ],
  }
);

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const FieldPhoto = sequelize.define(
  'FieldPhoto',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    cropSeasonId: { type: DataTypes.INTEGER },
    filePath: { type: DataTypes.STRING(255), allowNull: false },
    lat: { type: DataTypes.FLOAT },
    lon: { type: DataTypes.FLOAT },
    capturedAt: { type: DataTypes.DATE },
    note: { type: DataTypes.STRING(255) },
  },
  { tableName: 'field_photos' }
);

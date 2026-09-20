import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Laboratory soil test result — ground truth used to validate SoilGrids estimates.
export const SoilTest = sequelize.define(
  'SoilTest',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    farmId: { type: DataTypes.INTEGER, allowNull: false },
    labName: { type: DataTypes.STRING(160) },
    testedAt: { type: DataTypes.DATEONLY },
    pH: { type: DataTypes.FLOAT },
    ec: { type: DataTypes.FLOAT },
    nitrogen: { type: DataTypes.FLOAT },
    phosphorus: { type: DataTypes.FLOAT },
    potassium: { type: DataTypes.FLOAT },
    organicMatter: { type: DataTypes.FLOAT },
    texture: { type: DataTypes.STRING(60) },
    reportPath: { type: DataTypes.STRING(255) },
  },
  { tableName: 'soil_tests' }
);

import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Configurable advisory rule (spec Part G-33). `conditions` is a declarative
// JSON predicate the advisory engine evaluates against farm inputs (indices,
// weather, crop stage, dates); `messageTemplate` supports {placeholders} the
// engine fills with the triggering values. Administrators edit these rows —
// no code changes required to update agronomic guidance.
export const AdvisoryRule = sequelize.define(
  'AdvisoryRule',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    // null = applies to every crop.
    cropName: { type: DataTypes.STRING(120) },
    category: { type: DataTypes.STRING(40), allowNull: false },
    severity: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'information',
      validate: { isIn: [['information', 'normal', 'attention', 'warning', 'critical']] },
    },
    conditions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    messageTemplate: { type: DataTypes.TEXT, allowNull: false },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdBy: { type: DataTypes.INTEGER },
    updatedBy: { type: DataTypes.INTEGER },
  },
  { tableName: 'advisory_rules' }
);

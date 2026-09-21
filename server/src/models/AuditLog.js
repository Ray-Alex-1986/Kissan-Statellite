import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

// Audit trail (spec Part O-54): authentication events and every mutating API
// call, including polygon edits and crop-cycle modifications. Written
// fire-and-forget — an audit failure must never break the API it records.
export const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER },
    userRole: { type: DataTypes.STRING(20) },
    action: { type: DataTypes.STRING(40), allowNull: false },
    resource: { type: DataTypes.STRING(60), allowNull: false },
    resourceId: { type: DataTypes.INTEGER },
    farmId: { type: DataTypes.INTEGER },
    detail: { type: DataTypes.JSONB },
    ip: { type: DataTypes.STRING(45) },
  },
  {
    tableName: 'audit_logs',
    updatedAt: false,
    indexes: [{ fields: ['resource', 'resourceId'], name: 'audit_resource' }, { fields: ['farmId'], name: 'audit_farm' }],
  }
);

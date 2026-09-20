import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

export const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(160), allowNull: false, unique: true, validate: { isEmail: true } },
    passwordHash: { type: DataTypes.STRING(120), allowNull: false },
    role: { type: DataTypes.ENUM('farmer', 'officer', 'admin'), allowNull: false, defaultValue: 'farmer' },
    phone: { type: DataTypes.STRING(32) },
    cnic: { type: DataTypes.STRING(20) },
    district: { type: DataTypes.STRING(80) },
    province: { type: DataTypes.STRING(80) },
  },
  { tableName: 'users' }
);

import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const dialect = process.env.DB_DIALECT || 'postgres';

export const sequelize = new Sequelize(
  process.env.DB_NAME || 'farmportal',
  process.env.DB_USER || 'farmportal',
  process.env.DB_PASSWORD || 'farmportal',
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    dialect,
    logging: false,
  }
);

export async function initDb() {
  await sequelize.authenticate();
  if (dialect === 'postgres') {
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;');
  }
  await sequelize.sync({ alter: true });
  console.log(`[db] connected (${dialect})`);
}

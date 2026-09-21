import fs from 'node:fs';
import path from 'node:path';
import { QueryTypes } from 'sequelize';

/**
 * Ordered, idempotent SQL migrations tracked in schema_migrations.
 *
 * Runs AFTER sequelize.sync so sync owns table/column creation while
 * migrations own everything sync cannot do safely: rebuilding unique indexes
 * (multi-index satellite observations), PostGIS geometry columns, and data
 * backfills. Boot fails loudly if a migration fails — never half-applied.
 */
export async function runMigrations(sequelize) {
  if (sequelize.getDialect() !== 'postgres') return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return;

  const applied = await sequelize.query('SELECT name FROM schema_migrations', { type: QueryTypes.SELECT });
  const done = new Set(applied.map((r) => r.name));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await sequelize.transaction(async (t) => {
      await sequelize.query(sql, { transaction: t });
      await sequelize.query('INSERT INTO schema_migrations (name) VALUES (:name)', {
        replacements: { name: file },
        transaction: t,
      });
    });
    console.log(`[db] migration applied: ${file}`);
  }
}

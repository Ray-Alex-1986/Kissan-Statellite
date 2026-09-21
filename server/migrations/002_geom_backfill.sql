-- 002: Backfill the PostGIS geom mirror for farms whose geometry was lost
-- when Sequelize sync({alter}) rebuilt the farms table (the pre-002 geom
-- column was raw-migration DDL, which sync does not preserve).
--
-- The geom column and its GIST index are now owned by the Farm model
-- (DataTypes.GEOMETRY + indexes), so sync recreates the structure on every
-- boot; this migration only needs to re-copy boundary -> geom for existing
-- rows. Idempotent: fills only NULL rows, safe to re-run.
UPDATE farms
SET geom = ST_SetSRID(ST_GeomFromGeoJSON(boundary::text), 4326)
WHERE geom IS NULL AND boundary IS NOT NULL;

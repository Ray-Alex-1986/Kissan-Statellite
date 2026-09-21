-- Phase 1 — data model extensions (spec Parts A/D/K/O).
-- Idempotent; safe to re-run. Owns changes sequelize.sync cannot make safely.
-- NOTE: this database keeps camelCase column names (Sequelize attribute names
-- are used verbatim), so quoted mixed-case identifiers appear below.

-- 1) Farms: PostGIS geometry mirror of the GeoJSON boundary. The JSONB
--    `boundary` column stays the source of truth; `geom` enables
--    ST_Intersects / ST_Area(geography) spatial work (spec K46).
ALTER TABLE farms ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);
CREATE INDEX IF NOT EXISTS farms_geom_gix ON farms USING GIST (geom);
UPDATE farms SET geom = ST_SetSRID(ST_GeomFromGeoJSON(boundary::text), 4326)
 WHERE geom IS NULL AND boundary IS NOT NULL;

-- 2) Farms: human-readable farm codes for the registry (spec A1).
UPDATE farms SET "farmCode" = 'F-' || LPAD(id::text, 5, '0') WHERE "farmCode" IS NULL;

-- 3) Crop seasons: season widened to varchar by sync so Perennial/Other are
--    supported without Postgres ENUM surgery (spec A5).

-- 4) Observations: widen the natural key to (farm, date, source, index) so
--    NDVI/NDMI/NDRE rows can coexist per date (spec D25). Drop any earlier
--    farm/date/source unique index regardless of how sequelize named it.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'observations'
      AND indexname LIKE 'observations%farm%date%source%'
      AND indexname <> 'observations_farm_id_date_source_index_type'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS observations_farm_id_date_source_index_type
  ON observations ("farmId", date, source, "indexType");

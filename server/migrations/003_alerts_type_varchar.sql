-- 003: Widen alerts.type from the native PG enum to VARCHAR(40).
--
-- The pipeline now raises NDMI water-stress alerts (sentinelService
-- detectIndexAlerts), but Sequelize sync({alter}) cannot extend an existing
-- PG enum type, so inserting a new alert kind failed with
--   invalid input value for enum enum_alerts_type: "ndmi_water_stress".
-- The Alert model owns the value set via validate.isIn (project convention
-- for configurable enumerations); this migration converts the column and
-- drops the orphaned enum type. Idempotent: re-running is a no-op cast.
ALTER TABLE alerts ALTER COLUMN type TYPE VARCHAR(40);
DROP TYPE IF EXISTS enum_alerts_type;

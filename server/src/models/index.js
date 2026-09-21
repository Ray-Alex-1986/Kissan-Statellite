import { User } from './User.js';
import { Farm } from './Farm.js';
import { CropSeason } from './CropSeason.js';
import { FieldPhoto } from './FieldPhoto.js';
import { SoilProfile } from './SoilProfile.js';
import { SoilTest } from './SoilTest.js';
import { Observation } from './Observation.js';
import { Alert } from './Alert.js';
import { CropMaster } from './CropMaster.js';
import { FertilizerApplication } from './FertilizerApplication.js';
import { IrrigationRecord } from './IrrigationRecord.js';
import { WeatherObservation } from './WeatherObservation.js';
import { WeatherForecast } from './WeatherForecast.js';
import { FarmActivity } from './FarmActivity.js';
import { AdvisoryRule } from './AdvisoryRule.js';
import { Advisory } from './Advisory.js';
import { AuditLog } from './AuditLog.js';
import { SatelliteJob } from './SatelliteJob.js';

User.hasMany(Farm, { foreignKey: 'ownerId', as: 'farms' });
Farm.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

Farm.hasMany(CropSeason, { foreignKey: 'farmId', as: 'cropSeasons' });
CropSeason.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(FieldPhoto, { foreignKey: 'farmId', as: 'photos' });
FieldPhoto.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(SoilProfile, { foreignKey: 'farmId', as: 'soilProfiles' });
SoilProfile.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(SoilTest, { foreignKey: 'farmId', as: 'soilTests' });
SoilTest.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(Observation, { foreignKey: 'farmId', as: 'observations' });
Observation.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(Alert, { foreignKey: 'farmId', as: 'alerts' });
Alert.belongsTo(Farm, { foreignKey: 'farmId', as: 'farm' });

// --- Phase 1 extensions ---------------------------------------------------

Farm.hasMany(FertilizerApplication, { foreignKey: 'farmId', as: 'fertilizerApplications' });
FertilizerApplication.belongsTo(Farm, { foreignKey: 'farmId' });
CropSeason.hasMany(FertilizerApplication, { foreignKey: 'cropSeasonId', as: 'fertilizerApplications' });
FertilizerApplication.belongsTo(CropSeason, { foreignKey: 'cropSeasonId' });

Farm.hasMany(IrrigationRecord, { foreignKey: 'farmId', as: 'irrigationRecords' });
IrrigationRecord.belongsTo(Farm, { foreignKey: 'farmId' });
CropSeason.hasMany(IrrigationRecord, { foreignKey: 'cropSeasonId', as: 'irrigationRecords' });
IrrigationRecord.belongsTo(CropSeason, { foreignKey: 'cropSeasonId' });

Farm.hasMany(WeatherObservation, { foreignKey: 'farmId', as: 'weatherObservations' });
WeatherObservation.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(WeatherForecast, { foreignKey: 'farmId', as: 'weatherForecasts' });
WeatherForecast.belongsTo(Farm, { foreignKey: 'farmId' });

Farm.hasMany(FarmActivity, { foreignKey: 'farmId', as: 'activities' });
FarmActivity.belongsTo(Farm, { foreignKey: 'farmId' });
CropSeason.hasMany(FarmActivity, { foreignKey: 'cropSeasonId', as: 'activities' });
FarmActivity.belongsTo(CropSeason, { foreignKey: 'cropSeasonId' });
User.hasMany(FarmActivity, { foreignKey: 'userId' });
FarmActivity.belongsTo(User, { foreignKey: 'userId' });

Farm.hasMany(Advisory, { foreignKey: 'farmId', as: 'advisories' });
Advisory.belongsTo(Farm, { foreignKey: 'farmId' });
CropSeason.hasMany(Advisory, { foreignKey: 'cropSeasonId', as: 'advisories' });
Advisory.belongsTo(CropSeason, { foreignKey: 'cropSeasonId' });
Advisory.belongsTo(AdvisoryRule, { foreignKey: 'ruleId', as: 'rule' });

User.hasMany(AuditLog, { foreignKey: 'userId' });
AuditLog.belongsTo(User, { foreignKey: 'userId' });

Farm.hasMany(SatelliteJob, { foreignKey: 'farmId', as: 'satelliteJobs' });
SatelliteJob.belongsTo(Farm, { foreignKey: 'farmId' });
SatelliteJob.belongsTo(User, { foreignKey: 'requestedById' });

export {
  User, Farm, CropSeason, FieldPhoto, SoilProfile, SoilTest, Observation, Alert,
  CropMaster, FertilizerApplication, IrrigationRecord,
  WeatherObservation, WeatherForecast, FarmActivity,
  AdvisoryRule, Advisory, AuditLog, SatelliteJob,
};

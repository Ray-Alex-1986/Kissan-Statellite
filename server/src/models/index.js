import { User } from './User.js';
import { Farm } from './Farm.js';
import { CropSeason } from './CropSeason.js';
import { FieldPhoto } from './FieldPhoto.js';
import { SoilProfile } from './SoilProfile.js';
import { SoilTest } from './SoilTest.js';
import { Observation } from './Observation.js';
import { Alert } from './Alert.js';

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

export { User, Farm, CropSeason, FieldPhoto, SoilProfile, SoilTest, Observation, Alert };

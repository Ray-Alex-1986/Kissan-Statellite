import { Router } from 'express';
import { Op } from 'sequelize';
import { Farm, CropSeason, Observation, SoilProfile, SoilTest, FieldPhoto, Alert, User } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';

const router = Router();
router.use(requireAuth, requireRole('officer', 'admin'));

router.get('/overview', asyncWrap(async (req, res) => {
  const [farms, farmers, activeSeasons, openAlerts, observations] = await Promise.all([
    Farm.count(),
    User.count({ where: { role: 'farmer' } }),
    CropSeason.count({ where: { status: 'growing' } }),
    Alert.count({ where: { status: 'open' } }),
    Observation.count(),
  ]);
  const recentAlerts = await Alert.findAll({
    where: { status: 'open' },
    include: [{ model: Farm, as: 'farm', attributes: ['id', 'name', 'district'] }],
    order: [['id', 'DESC']],
    limit: 10,
  });
  res.json({ farms, farmers, activeSeasons, openAlerts, observations, recentAlerts });
}));

router.get('/farms/:id', asyncWrap(async (req, res) => {
  const farm = await Farm.findByPk(req.params.id, {
    include: [
      { model: User, as: 'owner', attributes: ['id', 'name', 'phone', 'email'] },
      { model: CropSeason, as: 'cropSeasons' },
      { model: SoilProfile, as: 'soilProfiles', order: [['fetchedAt', 'DESC']], limit: 1 },
      { model: SoilTest, as: 'soilTests', order: [['testedAt', 'DESC']] },
      { model: FieldPhoto, as: 'photos', order: [['id', 'DESC']] },
      { model: Alert, as: 'alerts', order: [['id', 'DESC']], where: { status: { [Op.in]: ['open', 'acknowledged'] } }, required: false },
    ],
  });
  if (!farm) return res.status(404).json({ error: 'Farm not found' });
  res.json(farm);
}));

export default router;

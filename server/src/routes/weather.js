import { Router } from 'express';
import { Farm } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';
import { getWeatherSummary } from '../services/weatherService.js';

const router = Router();

// Current conditions + 7-day forecast for a farm (spec Part B-13). Farmers
// may only read weather for farms they own; officers/admin read any farm.
router.get(
  '/farms/:id/summary',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, { attributes: ['id', 'ownerId', 'centroidLat', 'centroidLon'] });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(await getWeatherSummary(farm));
  })
);

export default router;

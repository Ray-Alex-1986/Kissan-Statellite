import { Router } from 'express';
import { Farm } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';
import { loadFarmContext, buildAnalyticsSummary, todayIso } from '../services/analyticsService.js';

const router = Router();

const isoOr = (value, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : fallback);

// Analytics summary for a farm (spec Parts E/F): per crop cycle — growth stage,
// progress, sowing-window compliance (early / on time / late) and harvest
// countdown — plus the multi-index and weather stress indicators. Derived from
// stored rows on every call (no provider fetch), so screens can render it
// freely. Farmers may only read farms they own.
router.get(
  '/farms/:id/summary',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, {
      attributes: ['id', 'ownerId', 'name', 'district', 'totalAreaAcres', 'centroidLat', 'centroidLon'],
    });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const asOf = isoOr(req.query.asOf, todayIso());
    const windowDays = Math.min(Math.max(Number(req.query.windowDays) || 365, 30), 730);
    const ctx = await loadFarmContext(farm, { asOf, includeWeather: req.query.weather !== 'false' });
    res.json(buildAnalyticsSummary(ctx, { windowDays }));
  })
);

export default router;

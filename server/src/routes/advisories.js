import { Router } from 'express';
import { Advisory, Farm } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';
import { audit } from '../utils/audit.js';
import { generateAdvisoriesForFarm, generateAdvisoriesForAllFarms } from '../services/advisoryService.js';
import { todayIso } from '../services/analyticsService.js';

const router = Router();

const isoOr = (value, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : fallback);

// Farm-scoped access: farmers only reach farms they own; officers/admin any.
async function loadFarmFor(req, res, farmId) {
  const farm = await Farm.findByPk(farmId, { attributes: ['id', 'name', 'ownerId', 'centroidLat', 'centroidLon'] });
  if (!farm) {
    res.status(404).json({ error: 'Farm not found' });
    return null;
  }
  if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return farm;
}

// Run the advisory engine for one farm (spec G-33..G-35). Idempotent by
// design: re-running refreshes live advisories in place (no duplicates) and
// auto-resolves advisories whose condition has cleared. ?dryRun=true returns
// the matches without writing — used by admin tooling and tests.
router.post(
  '/farms/:id/generate',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const farm = await loadFarmFor(req, res, req.params.id);
    if (!farm) return;
    const asOf = isoOr(req.query.asOf, todayIso());
    const dryRun = req.query.dryRun === 'true';
    const result = await generateAdvisoriesForFarm(farm, { asOf, dryRun });
    if (!dryRun) {
      audit(req, {
        action: 'generate',
        resource: 'advisories',
        resourceId: farm.id,
        farmId: farm.id,
        detail: result.counts,
      });
    }
    res.json(result);
  })
);

// District / national refresh: evaluate every farm (officer dashboard action).
router.post(
  '/generate-all',
  requireAuth,
  requireRole('officer', 'admin'),
  asyncWrap(async (req, res) => {
    const asOf = isoOr(req.query.asOf, todayIso());
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const result = await generateAdvisoriesForAllFarms({ asOf, limit });
    audit(req, { action: 'generate-all', resource: 'advisories', detail: { farms: result.farms, totals: result.totals } });
    res.json(result);
  })
);

// Lifecycle transitions a farmer may run on their own advisories: acknowledge
// (seen, still relevant — the engine keeps refreshing it) or resolve (done).
const setStatus = (status) =>
  asyncWrap(async (req, res) => {
    const row = await Advisory.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Advisory not found' });
    const farm = await loadFarmFor(req, res, row.farmId);
    if (!farm) return;
    await row.update({ status });
    audit(req, { action: status, resource: 'advisories', resourceId: row.id, farmId: row.farmId });
    res.json(row);
  });

router.post('/:id/acknowledge', requireAuth, requireRole('farmer', 'officer', 'admin'), setStatus('acknowledged'));
router.post('/:id/resolve', requireAuth, requireRole('farmer', 'officer', 'admin'), setStatus('resolved'));

export default router;

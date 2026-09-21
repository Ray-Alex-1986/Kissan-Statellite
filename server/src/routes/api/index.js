import { Router } from 'express';
import { createCrudRouter } from '../../utils/crudFactory.js';
import { User, Farm, CropSeason, FieldPhoto, SoilProfile, SoilTest, Observation, Alert, CropMaster, FertilizerApplication, IrrigationRecord, FarmActivity, AdvisoryRule, Advisory, WeatherObservation, WeatherForecast } from '../../models/index.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncWrap } from '../../middleware/error.js';
import { centroidOf, polygonAreaHa, isValidPolygon } from '../../utils/geo.js';

// ---------------------------------------------------------------------------
// Auto-generated REST APIs.
// Adding a model here (one line) creates its full REST API and /api/docs entry.
// ---------------------------------------------------------------------------

export const apiRouters = [
  createCrudRouter({
    model: Farm,
    resource: 'farms',
    ownerField: 'ownerId',
    searchable: ['name', 'district', 'tehsil'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
    hooks: {
      beforeCreate(req, body) {
        if (!isValidPolygon(body.boundary)) {
          const err = new Error('boundary must be a GeoJSON Polygon with a closed ring');
          err.status = 400;
          throw err;
        }
        const c = centroidOf(body.boundary);
        body.centroidLat = c.lat;
        body.centroidLon = c.lon;
        if (!body.totalAreaAcres) body.totalAreaAcres = Number((polygonAreaHa(body.boundary) * 2.47105).toFixed(2));
      },
      beforeUpdate(req, row, body) {
        if (body.boundary) {
          if (!isValidPolygon(body.boundary)) {
            const err = new Error('boundary must be a GeoJSON Polygon with a closed ring');
            err.status = 400;
            throw err;
          }
          const c = centroidOf(body.boundary);
          body.centroidLat = c.lat;
          body.centroidLon = c.lon;
        }
      },
    },
    include: () => [{ model: User, as: 'owner', attributes: ['id', 'name', 'phone'] }],
  }),

  createCrudRouter({
    model: CropSeason,
    resource: 'crop-seasons',
    searchable: ['cropName', 'variety', 'season'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
  }),

  createCrudRouter({
    model: FieldPhoto,
    resource: 'field-photos',
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
  }),

  createCrudRouter({
    model: SoilTest,
    resource: 'soil-tests',
    roles: { read: ['farmer', 'officer', 'admin'], write: ['officer', 'admin'] },
  }),

  createCrudRouter({
    model: Observation,
    resource: 'observations',
    roles: { read: ['farmer', 'officer', 'admin'], write: ['admin'] },
  }),

  createCrudRouter({
    model: Alert,
    resource: 'alerts',
    searchable: ['type', 'status'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['officer', 'admin'] },
  }),

  createCrudRouter({
    model: SoilProfile,
    resource: 'soil-profiles',
    roles: { read: ['farmer', 'officer', 'admin'], write: ['admin'] },
  }),

  createCrudRouter({
    model: CropMaster,
    resource: 'crop-masters',
    searchable: ['name', 'code', 'category'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['officer', 'admin'] },
  }),

  createCrudRouter({
    model: FertilizerApplication,
    resource: 'fertilizer-applications',
    farmField: 'farmId',
    searchable: ['fertilizer', 'growthStage'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
  }),

  createCrudRouter({
    model: IrrigationRecord,
    resource: 'irrigation-records',
    farmField: 'farmId',
    searchable: ['method', 'waterSource'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
  }),

  createCrudRouter({
    model: FarmActivity,
    resource: 'farm-activities',
    farmField: 'farmId',
    searchable: ['type', 'description'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
  }),

  createCrudRouter({
    model: AdvisoryRule,
    resource: 'advisory-rules',
    searchable: ['name', 'category', 'cropName'],
    roles: { read: ['officer', 'admin'], write: ['officer', 'admin'] },
  }),

  createCrudRouter({
    model: Advisory,
    resource: 'advisories',
    farmField: 'farmId',
    searchable: ['category', 'severity', 'status'],
    roles: { read: ['farmer', 'officer', 'admin'], write: ['officer', 'admin'] },
  }),

  // Weather cache tables (spec B-13): written by the weather service; readable
  // by officers/admin for monitoring and dashboard use.
  createCrudRouter({
    model: WeatherObservation,
    resource: 'weather-observations',
    farmField: 'farmId',
    searchable: ['provider'],
    roles: { read: ['officer', 'admin'], write: ['officer', 'admin'] },
  }),
  createCrudRouter({
    model: WeatherForecast,
    resource: 'weather-forecasts',
    farmField: 'farmId',
    searchable: ['provider'],
    roles: { read: ['officer', 'admin'], write: ['officer', 'admin'] },
  }),
];

export function mountApi(app) {
  for (const r of apiRouters) app.use(r.path, r.router);
}

// Lightweight profile endpoint for lists/markers (avoids shipping full GeoJSON).
// Each farm carries its latest NDVI reading and a stress verdict so the admin
// map can flag stressed crops without per-farm requests.
export const farmSummaryRouter = Router();
farmSummaryRouter.get(
  '/summaries',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const where = req.user.role === 'farmer' ? { ownerId: req.user.id } : {};
    const farms = await Farm.findAll({
      where,
      attributes: ['id', 'name', 'district', 'tehsil', 'province', 'centroidLat', 'centroidLon', 'totalAreaAcres', 'ownerId', 'updatedAt'],
      include: [
        { model: Alert, as: 'alerts', attributes: ['id', 'type', 'severity', 'status'] },
        { model: CropSeason, as: 'cropSeasons', attributes: ['id', 'cropName', 'season', 'sowingDate', 'status'] },
      ],
      order: [['id', 'DESC']],
    });
    const observations = await Observation.findAll({
      where: { farmId: farms.map((f) => f.id) },
      attributes: ['farmId', 'date', 'ndviMean'],
      order: [['date', 'DESC']],
    });
    const latestByFarm = new Map();
    for (const o of observations) {
      if (!latestByFarm.has(o.farmId)) latestByFarm.set(o.farmId, o);
    }
    res.json(farms.map((f) => {
      const latest = latestByFarm.get(f.id) || null;
      const open = (f.alerts || []).filter((a) => a.status === 'open');
      let stress = 'no-data';
      if (open.some((a) => a.severity === 'critical')) stress = 'critical';
      else if (open.length) stress = 'warning';
      else if (latest?.ndviMean != null) {
        stress = latest.ndviMean >= 0.5 ? 'healthy' : latest.ndviMean >= 0.3 ? 'moderate' : 'stressed';
      }
      return {
        ...f.toJSON(),
        latestNdvi: latest ? { date: latest.date, ndviMean: latest.ndviMean } : null,
        stress,
      };
    }));
  })
);

// Unified chronological farm timeline (spec Part H-37): registration, crop
// cycles, sowing, fertilizer, irrigation, satellite passes, advisories and
// manual journal entries, composed from the domain tables so it can never
// drift out of sync with them.
farmSummaryRouter.get(
  '/:id/timeline',
  requireAuth,
  requireRole('farmer', 'officer', 'admin'),
  asyncWrap(async (req, res) => {
    const farm = await Farm.findByPk(req.params.id, { attributes: ['id', 'ownerId', 'createdAt'] });
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [seasons, fertilizers, irrigations, observations, advisories, activities] = await Promise.all([
      CropSeason.findAll({ where: { farmId: farm.id } }),
      FertilizerApplication.findAll({ where: { farmId: farm.id } }),
      IrrigationRecord.findAll({ where: { farmId: farm.id } }),
      Observation.findAll({
        where: { farmId: farm.id, indexType: 'NDVI' },
        order: [['date', 'DESC']],
        limit: 90,
        attributes: ['date', 'ndviMean'],
      }),
      Advisory.findAll({
        where: { farmId: farm.id },
        attributes: ['id', 'category', 'severity', 'title', 'message', 'generatedAt', 'status'],
      }),
      FarmActivity.findAll({
        where: { farmId: farm.id },
        order: [['activityDate', 'DESC']],
        limit: 50,
      }),
    ]);

    const DERIVED = ['registration', 'crop_registration', 'sowing', 'fertilizer', 'irrigation', 'satellite', 'advisory', 'harvest'];
    const events = [];
    const push = (date, type, title, description = null, source = 'system', ref = null) => {
      if (!date) return;
      events.push({ date: String(date).slice(0, 10), type, title, description, source, ref });
    };

    push(farm.createdAt, 'registration', 'Farm registered', null, 'system');
    for (const s of seasons) {
      push(s.createdAt, 'crop_registration', `${s.cropName} crop registered`, s.variety ? `Variety: ${s.variety}` : null, 'user', { cropSeasonId: s.id });
      push(
        s.sowingDate,
        'sowing',
        `${s.cropName} sown`,
        [s.variety && `variety ${s.variety}`, s.season, s.sowingMethod && `method: ${s.sowingMethod}`].filter(Boolean).join(' · ') || null,
        'user',
        { cropSeasonId: s.id }
      );
      if (s.status === 'harvested') {
        push(s.actualHarvestDate || s.expectedHarvestDate, 'harvest', `${s.cropName} harvested`, null, 'user', { cropSeasonId: s.id });
      }
    }
    for (const f of fertilizers) {
      push(f.applicationDate, 'fertilizer', `${f.fertilizer} applied`, [f.quantity != null && `${f.quantity} ${f.unit || 'kg'}`, f.growthStage && `stage: ${f.growthStage}`, f.remarks].filter(Boolean).join(' · ') || null, 'user', { refId: f.id });
    }
    for (const i of irrigations) {
      push(i.irrigationDate, 'irrigation', 'Irrigation', [i.waterSource, i.method, i.durationHours != null && `${i.durationHours} h`, i.remarks].filter(Boolean).join(' · ') || null, 'user', { refId: i.id });
    }
    // Satellite: one representative NDVI observation per calendar month keeps
    // the timeline readable across a multi-year history.
    const seenMonth = new Set();
    for (const o of observations) {
      const month = String(o.date).slice(0, 7);
      if (seenMonth.has(month)) continue;
      seenMonth.add(month);
      push(o.date, 'satellite', 'Satellite observation', o.ndviMean != null ? `NDVI ${Number(o.ndviMean).toFixed(2)} · Sentinel-2` : null, 'system');
    }
    for (const a of advisories) {
      push(a.generatedAt, 'advisory', a.title, a.message, 'system', { refId: a.id });
    }
    // farm_activities contributes manual journal entries only; types that are
    // derived from domain tables above would double-count.
    for (const act of activities) {
      if (!DERIVED.includes(act.type)) {
        push(act.activityDate, act.type, act.description || act.type, null, act.source, { refId: act.id });
      }
    }

    events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    res.json({ farmId: farm.id, events: events.slice(0, 120) });
  })
);

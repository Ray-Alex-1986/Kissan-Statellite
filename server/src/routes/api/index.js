import { Router } from 'express';
import { createCrudRouter } from '../../utils/crudFactory.js';
import { User, Farm, CropSeason, FieldPhoto, SoilProfile, SoilTest, Observation, Alert } from '../../models/index.js';
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

import { Router } from 'express';
import { Op } from 'sequelize';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';

/**
 * Auto REST API generator.
 *
 * createCrudRouter({ model, resource, roles, ownerField, searchable, defaults, hooks })
 * exposes standard endpoints for any Sequelize model:
 *
 *   GET    /api/<resource>            list   (pagination ?page&limit, filter ?q, ?field=value)
 *   GET    /api/<resource>/:id        get one
 *   POST   /api/<resource>            create
 *   PUT    /api/<resource>/:id        update
 *   DELETE /api/<resource>/:id        remove
 *
 * Registering a new model in `api/index.js` automatically creates its full REST API.
 * Every generated router also registers its manifest in apiManifest for GET /api/docs.
 */
export const apiManifest = [];

export function createCrudRouter(opts) {
  const {
    model,
    resource,
    roles = { read: ['farmer', 'officer', 'admin'], write: ['farmer', 'officer', 'admin'] },
    ownerField = null,
    searchable = [],
    allowDeleteRoles = ['admin'],
    hooks = {},
  } = opts;

  const router = Router();
  const path = `/api/${resource}`;

  const canAccessRow = (req, row) => {
    if (req.user.role === 'admin' || req.user.role === 'officer') return true;
    if (ownerField && row[ownerField] !== req.user.id) return false;
    return true;
  };

  router.get(
    '/',
    requireAuth,
    requireRole(...roles.read),
    asyncWrap(async (req, res) => {
      const { page = 1, limit = 50, q, ...filters } = req.query;
      const where = { ...filters };
      if (ownerField && req.user.role === 'farmer') where[ownerField] = req.user.id;
      if (q && searchable.length) {
        where[Op.or] = searchable.map((f) => ({ [f]: { [Op.iLike]: `%${q}%` } }));
      }
      const { rows, count } = await model.findAndCountAll({
        where,
        limit: Math.min(Number(limit), 200),
        offset: (Number(page) - 1) * Number(limit),
        order: [['id', 'DESC']],
        ...(opts.include ? { include: opts.include(req) } : {}),
      });
      res.json({ data: rows, total: count, page: Number(page) });
    })
  );

  router.get(
    '/:id',
    requireAuth,
    requireRole(...roles.read),
    asyncWrap(async (req, res) => {
      const row = await model.findByPk(req.params.id, {
        ...(opts.include ? { include: opts.include(req) } : {}),
      });
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (!canAccessRow(req, row)) return res.status(403).json({ error: 'Forbidden' });
      res.json(row);
    })
  );

  router.post(
    '/',
    requireAuth,
    requireRole(...roles.write),
    asyncWrap(async (req, res) => {
      const body = { ...req.body };
      if (ownerField && req.user.role === 'farmer') body[ownerField] = req.user.id;
      if (hooks.beforeCreate) hooks.beforeCreate(req, body);
      const row = await model.create(body);
      if (hooks.afterCreate) await hooks.afterCreate(req, row);
      res.status(201).json(row);
    })
  );

  router.put(
    '/:id',
    requireAuth,
    requireRole(...roles.write),
    asyncWrap(async (req, res) => {
      const row = await model.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (!canAccessRow(req, row)) return res.status(403).json({ error: 'Forbidden' });
      if (hooks.beforeUpdate) hooks.beforeUpdate(req, row, req.body);
      await row.update(req.body);
      res.json(row);
    })
  );

  router.delete(
    '/:id',
    requireAuth,
    requireRole(...allowDeleteRoles),
    asyncWrap(async (req, res) => {
      const row = await model.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      await row.destroy();
      res.json({ deleted: true });
    })
  );

  apiManifest.push({
    resource,
    base: path,
    endpoints: [
      { method: 'GET', path, description: `List ${resource} (paginated, filterable)` },
      { method: 'GET', path: `${path}/:id`, description: `Get one ${resource}` },
      { method: 'POST', path, description: `Create ${resource}`, roles: roles.write },
      { method: 'PUT', path: `${path}/:id`, description: `Update ${resource}`, roles: roles.write },
      { method: 'DELETE', path: `${path}/:id`, description: `Delete ${resource}`, roles: allowDeleteRoles },
    ],
    fields: Object.keys(model.rawAttributes).filter((f) => !['createdAt', 'updatedAt'].includes(f)),
  });

  return { path, router };
}

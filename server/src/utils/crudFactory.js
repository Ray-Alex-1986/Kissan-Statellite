import { Router } from 'express';
import { Op, literal } from 'sequelize';
import { Farm, AuditLog } from '../models/index.js';
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
    farmField = null,
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

  // Farmers may only touch records tied to farms they own (spec M50).
  const assertFarmAccess = async (req, farmId) => {
    if (!farmId || req.user.role !== 'farmer') return;
    const farm = await Farm.findByPk(Number(farmId), { attributes: ['id', 'ownerId'] });
    if (!farm || farm.ownerId !== req.user.id) {
      const err = new Error('Forbidden: farm is not registered against your account');
      err.status = 403;
      throw err;
    }
  };

  const assertRowAccess = async (req, row) => {
    if (!canAccessRow(req, row)) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }
    if (farmField) await assertFarmAccess(req, row[farmField]);
  };

  // Audit trail for every mutation (spec O54). Fire-and-forget: an audit
  // failure must never fail the audited action.
  const writeAudit = (req, action, row, detail = null) => {
    Promise.resolve(
      AuditLog.create({
        userId: req.user?.id ?? null,
        userRole: req.user?.role ?? null,
        action,
        resource,
        resourceId: row?.id ?? null,
        farmId: row?.farmId ?? (resource === 'farms' ? row?.id ?? null : null),
        detail,
        ip: req.ip ?? null,
      })
    ).catch(() => {});
  };

  router.get(
    '/',
    requireAuth,
    requireRole(...roles.read),
    asyncWrap(async (req, res) => {
      const { page = 1, limit = 50, q, ...filters } = req.query;
      const where = { ...filters };
      if (ownerField && req.user.role === 'farmer') where[ownerField] = req.user.id;
      if (farmField && req.user.role === 'farmer') {
        const ownedFarms = { [Op.in]: literal(`(SELECT id FROM farms WHERE "ownerId" = ${Number(req.user.id)})`) };
        // An explicit ?farmId= filter must still be honoured — intersect it with
        // the ownership scope instead of letting it be silently overwritten.
        if (where[farmField] != null) {
          const explicit = where[farmField];
          delete where[farmField];
          where[Op.and] = [...(where[Op.and] ? [where[Op.and]] : []), { [farmField]: explicit }, { [farmField]: ownedFarms }];
        } else {
          where[farmField] = ownedFarms;
        }
      }
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
      await assertRowAccess(req, row);
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
      if (farmField) await assertFarmAccess(req, body[farmField]);
      if (hooks.beforeCreate) hooks.beforeCreate(req, body);
      const row = await model.create(body);
      if (hooks.afterCreate) await hooks.afterCreate(req, row);
      writeAudit(req, 'create', row, { keys: Object.keys(req.body).slice(0, 25) });
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
      await assertRowAccess(req, row);
      if (farmField && req.body[farmField] && Number(req.body[farmField]) !== Number(row[farmField])) {
        await assertFarmAccess(req, req.body[farmField]);
      }
      if (hooks.beforeUpdate) hooks.beforeUpdate(req, row, req.body);
      await row.update(req.body);
      writeAudit(req, 'update', row, { keys: Object.keys(req.body).slice(0, 25) });
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
      writeAudit(req, 'delete', row);
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

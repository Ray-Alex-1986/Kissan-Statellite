import { AuditLog } from '../models/index.js';

/**
 * Fire-and-forget audit write (spec Part O-54). An audit failure is logged to
 * the console but never propagates — the audited action must not fail because
 * its trail did.
 */
export function audit(req, { action, resource, resourceId = null, farmId = null, detail = null }) {
  Promise.resolve(
    AuditLog.create({
      userId: req.user?.id ?? null,
      userRole: req.user?.role ?? null,
      action,
      resource,
      resourceId,
      farmId,
      detail,
      ip: req.ip || req.headers?.['x-forwarded-for']?.split?.(',')[0] || null,
    })
  ).catch((e) => console.error('[audit] write failed:', e.message));
}

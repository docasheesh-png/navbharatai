import { chatAvailabilityMessage } from './chatAvailabilityMessage';
import type { RequestHandler } from 'express';
import { rewriteVersionedPath } from '../routes/apiVersion';
import { aiMaintenanceStore, MAINTENANCE_MESSAGE, type AiMaintenanceStore } from './aiMaintenance';

/** Maintenance pauses API work by default, including new AI tools and bot webhooks. The admin,
 * sign-in, payment settlement and health endpoints remain reachable so recovery never locks itself out. */
export function maintenanceProtected(method: string, path: string): boolean {
  const raw = path.split('?')[0];
  const p = rewriteVersionedPath(raw) ?? raw;
  if (method.toUpperCase() === 'OPTIONS' || !p.startsWith('/api/')) return false;
  return !/^\/api\/(?:admin(?:\/|$)|auth(?:\/|$)|firebase-auth(?:\/|$)|github-auth(?:\/|$)|payment(?:\/|$)|wallet(?:\/|$)|live(?:\/|$)|config(?:\/|$)|public-config(?:\/|$)|public-flags(?:\/|$)|app-version(?:\/|$)|internal\/scheduler-tick$|health(?:\/|$)|ready(?:\/|$)|status(?:\/|$)|version(?:\/|$)|legal(?:\/|$))/.test(p);
}
export function aiMaintenanceGuard(store: AiMaintenanceStore = aiMaintenanceStore): RequestHandler {
  return async (req, res, next) => {
    if (!maintenanceProtected(req.method, req.path)) { next(); return; }
    store.start();
    const state = await store.read();
    // Fail-open: recent known-off + unreadable flag → keep serving (do not fake a pause).
    if (state.unavailable && !state.enabled) { next(); return; }
    if (!state.enabled && !state.unavailable) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '60');
    if (state.unavailable) {
      // An unreadable flag is not evidence of overload; keep its state and use a neutral notice.
      const notice = chatAvailabilityMessage('temporary', { message: req.body?.message ?? req.body?.prompt, history: req.body?.history, replyLanguage: req.body?.replyLanguage });
      res.status(503).json({
        error: notice,
        message: notice,
        reply: notice,
        maintenance: false,
        statusUnavailable: true,
      });
      return;
    }
    res.status(503).json({ error: MAINTENANCE_MESSAGE, message: MAINTENANCE_MESSAGE, reply: MAINTENANCE_MESSAGE, maintenance: true });
  };
}

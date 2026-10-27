import type { Express, Request, Response } from 'express';
import { requireUserMatch, trackDevice, verifyFirebaseSession } from '../lib/authMiddleware';
import { deviceTokenStore, type DevicePlatform } from '../lib/DeviceTokenStore';
import { routeParam, routeParams } from '../lib/expressCompat';

const VALID_PLATFORMS: DevicePlatform[] = ['android', 'ios', 'web'];

/**
 * Push-notification device-token registration routes (admin request 2026-07-26 — push notifications
 * were never built; this is the greenfield server side). Mirrors /api/secrets/:userId exactly:
 * requireUserMatch verifies the caller's Firebase ID token matches :userId, so a device token can only
 * ever be registered under the account that actually owns the signed-in session.
 *
 * - POST   /api/push/:userId/register-token   — register (or refresh) this device's FCM token
 * - DELETE /api/push/:userId/register-token   — unregister a token (e.g. on sign-out)
 */
export function registerPushRoutes(app: Express): void {
  app.post('/api/push/:userId/register-token', requireUserMatch('userId'), trackDevice('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const { token, platform, appVersionCode } = req.body || {};
      if (typeof token !== 'string' || !token.trim()) {
        res.status(400).json({ error: 'token required' });
        return;
      }
      const session = (await verifyFirebaseSession(req)).token;
      if (!session || session.uid !== userId || !Number.isSafeInteger(session.auth_time)) {
        return res.status(401).json({ error: 'Sign in again to register notifications.' });
      }
      // A legacy custom credential can be redeemed after a provider revocation but before the
      // shared mirror advances. Its fresh auth_time does not prove its original sign-in epoch.
      // Preserve cutoff-0 compatibility, but mark the unknown origin ineligible at any later cutoff.
      const origin = session.firebase?.sign_in_provider === 'custom' && session.session_auth_time === undefined
        ? 0 : session.session_auth_time ?? session.auth_time!;
      const sessionAuthTime = Math.min(session.auth_time!, origin);
      const plat: DevicePlatform = VALID_PLATFORMS.includes(platform) ? platform : 'web';
      // The build this device is running — what makes "notify only the users who are behind"
      // possible at all. Parsed strictly: junk becomes undefined (unknown), never a number.
      const parsedVersion = Number.parseInt(String(appVersionCode ?? ''), 10);
      const version = Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : undefined;
      const ok = await deviceTokenStore.saveToken(userId, token.trim(), plat, version, sessionAuthTime);
      if (!ok) {
        res.status(500).json({ error: 'Could not save the device token. Please try again.' });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Could not save the device token. Please try again.' });
    }
  });

  app.delete('/api/push/:userId/register-token', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      if (!token) {
        res.status(400).json({ error: 'token required' });
        return;
      }
      await deviceTokenStore.removeToken(userId, token);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Could not remove the device token.' });
    }
  });
}

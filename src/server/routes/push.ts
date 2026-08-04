import type { Express, Request, Response } from 'express';
import { requireUserMatch, trackDevice } from '../lib/authMiddleware';
import { deviceTokenStore, type DevicePlatform } from '../lib/DeviceTokenStore';

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
      const { userId } = req.params;
      const { token, platform } = req.body || {};
      if (typeof token !== 'string' || !token.trim()) {
        res.status(400).json({ error: 'token required' });
        return;
      }
      const plat: DevicePlatform = VALID_PLATFORMS.includes(platform) ? platform : 'web';
      const ok = await deviceTokenStore.saveToken(userId, token.trim(), plat);
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
      const { userId } = req.params;
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

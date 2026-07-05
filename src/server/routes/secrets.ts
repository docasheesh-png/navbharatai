import type { Express, Request, Response } from 'express';
import { doc, getDoc, updateDoc, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { encrypt } from '../lib/secrets';
import { requireUserMatch, trackDevice } from '../lib/authMiddleware';

/**
 * User-secret CRUD routes extracted from the server.ts monolith (Phase 1).
 * P0a C4: all three routes now require a valid Firebase ID token whose uid
 * matches the :userId path param. Mismatches → 401/403.
 *
 * - GET    /api/secrets/:userId            — list a user's (non-deleted) secrets
 * - POST   /api/secrets/:userId            — save an encrypted secret
 * - DELETE /api/secrets/:userId/:secretId  — soft-delete a secret
 */
export function registerSecretsRoutes(app: Express): void {
  app.get('/api/secrets/:userId', requireUserMatch('userId'), trackDevice('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    console.log('[DEBUG] GET /api/secrets/:userId called for:', req.params.userId);
    try {
      const { userId } = req.params;
      const secretsSnapshot = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', userId)));
      const secrets = secretsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as { deleted?: boolean }[];
      console.log('[DEBUG] Secrets found:', secrets);
      res.json(secrets.filter(s => !s.deleted));
    } catch (err) {
      console.error('[DEBUG] Error fetching secrets:', err);
      res.status(500).json({ error: 'Failed to fetch secrets' });
    }
  });

  app.post('/api/secrets/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = req.params;
      const { secret_name, secret_value } = req.body;
      const encryptedValue = encrypt(secret_value);
      await addDoc(collection(db, 'user_secrets'), {
        user_id: userId,
        secret_name,
        encrypted_secret_value: encryptedValue,
        created_at: new Date()
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save secret' });
    }
  });

  app.delete('/api/secrets/:userId/:secretId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId, secretId } = req.params;
      const ref = doc(db, 'user_secrets', secretId);
      const snap = await getDoc(ref);
      // IDOR guard: user_secrets is a FLAT collection, so requireUserMatch (caller === :userId) is
      // NOT enough — the delete keys off :secretId alone. Confirm the target secret actually belongs
      // to the authenticated user before soft-deleting, so a caller can't destroy another user's
      // secret by guessing its document id. Respond 404 (not 403) so we don't leak that the id exists.
      if (!snap.exists() || (snap.data() as { user_id?: string } | undefined)?.user_id !== userId) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }
      await updateDoc(ref, { deleted: true }); // Soft delete
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete secret' });
    }
  });
}

import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { doc, getDoc, updateDoc, collection, addDoc, getDocs, query, where, getServerDb as getDb } from '../lib/serverDb';
import { encrypt, loadUserVaultSecrets } from '../lib/secrets';
import { requireUserMatch, trackDevice } from '../lib/authMiddleware';
import { probeCredentials, realProbeFetch } from '../AgentV3/credentialProbe';

/** Shortest gap between two verify calls from one user. In-memory: a throttle, not an audit record. */
export const VERIFY_COOLDOWN_MS = 5_000;
/** Bound on the throttle map, so it can never grow into a memory leak on a long-lived instance. */
export const VERIFY_COOLDOWN_MAX_ENTRIES = 5_000;
const verifyCooldown = new Map<string, number>();

/**
 * May this user run a verification now, and what does the throttle look like afterwards?
 *
 * Extracted as a pure function because it is the only real decision in the route, and because both of
 * its edges matter: each call can fan out to several outbound provider requests, so a caller must not be
 * able to loop on it — and the map must not grow without limit on an instance that stays up for weeks.
 * Mutates and returns `state` so the caller keeps one map. PURE apart from that map.
 */
export function allowVerify(state: Map<string, number>, userId: string, now: number): boolean {
  // `has`, not `?? 0`: a user who has never called must be distinguishable from one who called at
  // timestamp 0. Collapsing the two makes "never verified" look like "just verified" and silently
  // refuses a caller's very first request.
  const last = state.get(userId);
  if (last !== undefined && now - last < VERIFY_COOLDOWN_MS) return false;
  // Clear rather than evict-oldest: this is a throttle whose worst case on a flush is that a few users
  // may verify one extra time. Tracking insertion order to evict precisely would cost more than the bug.
  if (state.size >= VERIFY_COOLDOWN_MAX_ENTRIES) state.clear();
  state.set(userId, now);
  return true;
}

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
    try {
      const { userId } = req.params;
      const secretsSnapshot = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', userId)));
      // Return ONLY the metadata the UI needs (name + timestamp) — never the encrypted value. The
      // ciphertext has no reason to leave the server, and the client only ever renders the name.
      const secrets = secretsSnapshot.docs
        .map((doc: any) => {
          const d = doc.data() as { secret_name?: string; created_at?: unknown; deleted?: boolean };
          return { id: doc.id, secret_name: d.secret_name, created_at: d.created_at, deleted: d.deleted };
        })
        .filter((s) => !s.deleted);
      res.json(secrets);
    } catch (err) {
      console.error('Error fetching secrets:', err);
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

  // DID THE KEY ACTUALLY WORK? (2026-08-17)
  //
  // The vault used to accept anything and say "Saved" — which is true about the STORAGE and silent about
  // the credential. A mistyped Stripe key saved exactly as successfully as a working one, and the user
  // found out from a payment button that failed for their first real customer.
  //
  // The plaintext is NOT sent here. The client saves through the existing POST and then asks this route
  // to check what is already stored, so verification adds no second path for a live credential to travel
  // — the values are read back from the user's own encrypted vault, server-side, and go nowhere except
  // the provider's own API. Only free, read-only endpoints are called (see credentialProbe.ts).
  //
  // A rejected key is still SAVED. The user chose it; silently discarding it would be a second, quieter
  // version of the bug this fixes. We store it and tell the truth about it.
  app.post('/api/secrets/:userId/verify', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      // Each call can fan out to MAX_PROBES outbound requests, so one caller must not be able to loop on
      // it. A short per-user cooldown keeps the button honest without needing shared state.
      if (!allowVerify(verifyCooldown, userId, Date.now())) {
        res.status(429).json({ error: 'Please wait a moment before checking your keys again.' });
        return;
      }

      const vault = await loadUserVaultSecrets(userId);
      const verdicts = await probeCredentials(vault, realProbeFetch);
      // `detail` carries HTTP statuses and error types — diagnostics, not product copy. It stays server-side.
      res.json({ verdicts: verdicts.map(({ names, provider, status, message }) => ({ names, provider, status, message })) });
    } catch (err) {
      console.error('Error verifying secrets:', err);
      // A verification that fails is never a verdict on the user's keys.
      res.status(500).json({ error: 'Could not check your keys just now. They are saved as you entered them.' });
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

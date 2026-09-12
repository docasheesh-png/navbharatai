import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { doc, getDoc, updateDoc, collection, addDoc, getDocs, query, where, getServerDb as getDb } from '../lib/serverDb';
import { encrypt, loadUserVaultSecrets, secretCreatedAtMs } from '../lib/secrets';
import { planSecretWrite } from '../lib/secretScope';
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
          const d = doc.data() as { secret_name?: string; created_at?: unknown; deleted?: boolean; workspace_id?: string | null };
          // `workspace_id` is metadata, not a credential: the UI needs it to show which app a key
          // belongs to and to offer the app picker. Absent ⇒ shared with every app (see secretScope.ts).
          return {
            id: doc.id, secret_name: d.secret_name, created_at: d.created_at, deleted: d.deleted,
            workspace_id: d.workspace_id ?? null,
          };
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
      const { secret_name, secret_value, workspace_id } = req.body;
      const encryptedValue = encrypt(secret_value);
      // WHICH APP IS THIS KEY FOR? (admin 2026-08-17). Absent/empty ⇒ SHARED with every app, which is
      // what every key saved before scoping existed is, and what the Settings screen still offers as an
      // option. A value here ties the key to one workspace, so the user's other apps never receive it.
      const scope = typeof workspace_id === 'string' && workspace_id.trim() ? workspace_id.trim() : null;

      // SAVING AN EXISTING NAME REPLACES IT (2026-09-12). This used to be an unconditional addDoc, so a
      // user rotating a leaked key ended up with TWO rows and no rule about which one their build would
      // get — Firestore returns documents in id order, and auto-ids are random. Now the save updates the
      // row it is replacing and retires any duplicate already sitting there, so the pile collapses on the
      // next save instead of growing. Rows of a DIFFERENT scope are never touched — see secretScope.ts.
      const existing = await getDocs(query(
        collection(db, 'user_secrets'),
        where('user_id', '==', userId),
        where('secret_name', '==', secret_name),
      ));
      const plan = planSecretWrite(
        existing.docs.map((d: any) => ({
          id: d.id,
          workspaceId: d.data()?.workspace_id ?? null,
          createdAt: secretCreatedAtMs(d.data()?.created_at),
          deleted: !!d.data()?.deleted,
        })),
        scope,
      );

      if (plan.replace) {
        await updateDoc(doc(db, 'user_secrets', plan.replace), {
          encrypted_secret_value: encryptedValue,
          workspace_id: scope,
          // `created_at` is what "newest wins" reads, so a replacement must move it forward. Leaving it
          // at the original date would make a freshly rotated key lose to an older duplicate.
          created_at: new Date(),
          deleted: false,
        });
        // Soft-delete, matching the DELETE route: the vault has never hard-deleted a user's secret, and
        // a cleanup is not the place to start.
        for (const id of plan.retire) await updateDoc(doc(db, 'user_secrets', id), { deleted: true });
      } else {
        await addDoc(collection(db, 'user_secrets'), {
          user_id: userId,
          secret_name,
          encrypted_secret_value: encryptedValue,
          workspace_id: scope,
          created_at: new Date()
        });
      }
      res.json({ success: true, replaced: !!plan.replace, duplicatesRetired: plan.retire.length });
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

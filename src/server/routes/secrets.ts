import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { doc, getDoc, updateDoc, deleteDoc, setDoc, collection, addDoc, getDocs, query, where, getServerDb as getDb } from '../lib/serverDb';
import { encrypt, decrypt, loadUserVaultSecrets, secretCreatedAtMs } from '../lib/secrets';
import { planSecretWrite, planScopeMove } from '../lib/secretScope';
import { requireUserMatch, trackDevice } from '../lib/authMiddleware';
import { ticketFor } from '../lib/vaultTicketHttp';
import { auditVault } from '../lib/vaultAudit';
import { allowAfterCooldown } from '../lib/callCooldown';
import { probeCredentials, realProbeFetch } from '../AgentV3/credentialProbe';
import { routeParam, routeParams } from '../lib/expressCompat';

/** Shortest gap between two verify calls from one user. In-memory: a throttle, not an audit record. */
export const VERIFY_COOLDOWN_MS = 5_000;
/** Bound on the throttle map, so it can never grow into a memory leak on a long-lived instance. */
export const VERIFY_COOLDOWN_MAX_ENTRIES = 5_000;
const verifyCooldown = new Map<string, number>();

/**
 * May this user run a verification now, and what does the throttle look like afterwards?
 *
 * The rule itself now lives in `callCooldown.ts`, because a second route needed exactly the same one
 * (re-probing a user's connected MCP services) and a second copy is how two implementations drift
 * until only one of them carries the fix. This stays as the named, tested entry point for THIS route —
 * the behaviour is unchanged and the tests below still pin it.
 */
export function allowVerify(state: Map<string, number>, userId: string, now: number): boolean {
  return allowAfterCooldown(state, userId, now, VERIFY_COOLDOWN_MS, VERIFY_COOLDOWN_MAX_ENTRIES);
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

/**
 * THE VAULT'S OWN DOOR — the App Lock's 4-digit PIN.
 *
 * 🔴 THE LOCK ITSELF NO LONGER LIVES IN THIS FILE, and the move is the point (admin 2026-09-13: *"yeh PIN
 * system sirf 'secret and api key' ke liye nahi … general pin system banana hai"*). The PIN now guards
 * several parts of the app, so it is owned by `routes/appLock.ts` and its rules by `lib/vaultPin.ts`.
 * What stays here is the CHECK: the two routes below that can hand back a DECRYPTED key, or destroy one,
 * refuse to act without a live ticket from that lock (`lib/vaultTicketHttp.ts`).
 *
 * 🔒 WHY THAT SPLIT MATTERS FOR HONESTY. On most screens the App Lock protects the SCREEN — the data
 * behind it is the user's own and their session already entitles them to it. Here it protects the DATA:
 * the values stay encrypted on the server until a ticket is presented, so removing every line of the
 * unlock UI would make these keys unreadable rather than public. That difference is real and is stated
 * to the user rather than glossed over.
 */

export function registerSecretsRoutes(app: Express): void {
  app.get('/api/secrets/:userId', requireUserMatch('userId'), trackDevice('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = routeParams(req.params);
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
      const { userId } = routeParams(req.params);
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
      const { userId } = routeParams(req.params);
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

  /**
   * MOVE ONE KEY BETWEEN SCOPES — "apply this to all my apps", and back again (admin 2026-09-13).
   *
   * There was no way to re-scope a saved key at all: the only cure was to delete it and retype it in
   * the other scope, and a typo there silently creates a second key no build reads.
   *
   * 🔒 IT IS A MOVE, NOT A SAVE, AND THAT IS THE WHOLE DESIGN. The row keeps its id and its ciphertext
   * and changes only `workspace_id`, so the plaintext is never decrypted to re-scope a key. Doing it as
   * a save at the new scope would have left the old row alive (`planSecretWrite` only touches rows of
   * the same scope) and `resolveScopedSecrets` makes an app-specific key beat a shared one — so the
   * app would have kept injecting the old value while every other app got the new one. See
   * `planScopeMove`.
   */
  app.patch('/api/secrets/:userId/:secretId/scope', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId, secretId } = routeParams(req.params);
      const ref = doc(db, 'user_secrets', secretId);
      const snap = await getDoc(ref);
      // Same IDOR guard as the delete route, for the same reason: this collection is FLAT, so matching
      // the caller to :userId does not prove the :secretId belongs to them. 404, never 403 — a 403
      // would confirm the id exists.
      if (!snap.exists() || (snap.data() as { user_id?: string } | undefined)?.user_id !== userId) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }

      // 🔒 THE SAME PROOF AS DELETING. Widening a key to every app is not a cosmetic setting — it puts a
      // payment or database secret into the `.env` of apps that never had it. An attacker who cannot
      // read a vault would be satisfied by spraying one key across every app the victim owns.
      const unlock = ticketFor(req, userId);
      if (!unlock) {
        res.status(401).json({ error: 'Unlock the vault before changing where a key applies.', needsUnlock: true });
        return;
      }

      const raw = (req.body ?? {}).workspace_id;
      const target = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      const name = (snap.data() as { secret_name?: string } | undefined)?.secret_name ?? '';

      const existing = await getDocs(query(
        collection(db, 'user_secrets'),
        where('user_id', '==', userId),
        where('secret_name', '==', name),
      ));
      const plan = planScopeMove(
        existing.docs.map((d: any) => ({
          id: d.id,
          workspaceId: d.data()?.workspace_id ?? null,
          createdAt: secretCreatedAtMs(d.data()?.created_at),
          deleted: !!d.data()?.deleted,
        })),
        secretId,
        target,
      );

      if (plan.alreadyThere) {
        // Not an error and not a write: the key is already where the user is asking for it to be.
        res.json({ success: true, moved: false, duplicatesRetired: 0 });
        return;
      }
      if (!plan.move) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }

      // Retire FIRST, so a failure between the two writes leaves the key exactly where it was rather
      // than at the destination beside a duplicate it was meant to replace.
      for (const id of plan.retire) await deleteDoc(doc(db, 'user_secrets', id));
      await updateDoc(ref, {
        workspace_id: target,
        // `created_at` is what "newest wins" reads. A moved key must win against anything already
        // sitting at the destination, exactly as a freshly saved value does.
        created_at: new Date(),
      });

      auditVault(userId, 'scope', { secretId, name, scope: target ?? 'all-apps', retired: plan.retire.length });
      res.json({ success: true, moved: true, duplicatesRetired: plan.retire.length });
    } catch (err) {
      console.error('Error re-scoping secret:', err);
      res.status(500).json({ error: 'Could not change where this key applies.' });
    }
  });

  app.delete('/api/secrets/:userId/:secretId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId, secretId } = routeParams(req.params);
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

      // 🔒 DESTRUCTIVE, SO IT NEEDS THE SAME PROOF AS READING. Deleting a key breaks every app that
      // injects it, and an attacker who cannot read a vault can still be satisfied by emptying it.
      const unlock = ticketFor(req, userId);
      if (!unlock) {
        res.status(401).json({ error: 'Unlock the vault before deleting a key.', needsUnlock: true });
        return;
      }

      // 🗑️ A REAL DELETE, NOT A FLAG (admin 2026-09-12: "puri row (keys and value dono) delete ho jaye").
      // This route used to set `deleted: true` and leave the encrypted value sitting in the row forever,
      // so "Delete" meant "hide". The user asked for the row to go, and a promise to delete that leaves
      // the ciphertext behind is the kind of half-truth the second absolute rule forbids. Every reader
      // already skips a missing row exactly as it skipped a flagged one (`secrets.ts` and
      // `secretScope.ts` both test `deleted` before use), so removing the document is strictly safer
      // than flagging it — there is no code path that needed the tombstone.
      const name = (snap.data() as { secret_name?: string } | undefined)?.secret_name ?? '';
      await deleteDoc(ref);
      auditVault(userId, 'delete', { secret_name: name, secret_id: secretId, unlock_method: unlock.method });
      res.json({ success: true, deleted: true })
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete secret' });
    }
  });

  /**
   * The values — and the ONLY route in the app that returns them.
   *
   * 🔴 THIS IS A DELIBERATE CHANGE OF POSTURE, recorded rather than slipped in. The list route above
   * says, in a comment that has been true since the vault was built, that "the ciphertext has no reason
   * to leave the server". That was the right default while the screen only ever showed key NAMES. The
   * admin asked for the Cloud Run experience — the value visible in its box, so it can be checked and
   * copied — and that is a real requirement: a user who cannot see what they saved cannot tell a
   * working key from a mistyped one, which is the bug the verify route exists to paper over.
   *
   * What makes it defensible is that this route is unreachable without a verified unlock from seconds
   * ago, it is the narrow path (one endpoint, one method, POST so no value can land in a browser
   * history or a proxy log), and every call is recorded. The old GET route is unchanged and still
   * returns names only, so nothing that used to be safe became less so.
   */
  app.post('/api/secrets/:userId/reveal', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = routeParams(req.params);
      const unlock = ticketFor(req, userId);
      if (!unlock) {
        res.status(401).json({ error: 'Unlock the vault to see your keys.', needsUnlock: true });
        return;
      }

      const snap = await getDocs(query(collection(db, 'user_secrets'), where('user_id', '==', userId)));
      const rows = snap.docs
        .map((d: any) => {
          const data = d.data() as { secret_name?: string; encrypted_secret_value?: string; deleted?: boolean; workspace_id?: string | null; created_at?: unknown };
          if (data?.deleted || !data?.secret_name) return null;
          // A value that will not decrypt is reported as UNREADABLE rather than as an empty string: an
          // empty box would read as "this key is blank" and invite the user to overwrite a key that is
          // actually fine but was encrypted under a rotated key.
          let value = '';
          let readable = false;
          try {
            value = decrypt(String(data.encrypted_secret_value ?? ''));
            readable = value !== '';
          } catch {
            readable = false;
          }
          return {
            id: d.id,
            secret_name: data.secret_name,
            secret_value: readable ? value : '',
            readable,
            workspace_id: data.workspace_id ?? null,
            created_at: data.created_at ?? null,
          };
        })
        .filter((r: unknown): r is NonNullable<typeof r> => r !== null);

      auditVault(userId, 'reveal', { key_count: rows.length, unlock_method: unlock.method });
      // No-store, so a revealed value is never written into a disk cache by the browser or a proxy.
      res.set('Cache-Control', 'no-store, max-age=0');
      res.json(rows);
    } catch (err) {
      console.error('[vault-reveal] failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not read your keys just now.' });
    }
  });

}

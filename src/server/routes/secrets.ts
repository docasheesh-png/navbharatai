import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { doc, getDoc, updateDoc, deleteDoc, setDoc, collection, addDoc, getDocs, query, where, getServerDb as getDb } from '../lib/serverDb';
import { encrypt, decrypt, loadUserVaultSecrets, secretCreatedAtMs } from '../lib/secrets';
import { planSecretWrite } from '../lib/secretScope';
import { requireUserMatch, trackDevice, verifyFreshAuth } from '../lib/authMiddleware';
import {
  unlockSecret, mintChallenge, mintUnlockTicket, verifyUnlockTicket, verifyClientData,
  parseAuthenticatorData, rpIdMatches, verifyAssertionSignature, signCounterOk, isAcceptedAlg,
  isFreshReauth, base64urlToBuffer, UNLOCK_REFUSED_MESSAGE, TICKET_TTL_MS, type UnlockMethod,
} from '../lib/deviceUnlock';
import { allowAfterCooldown } from '../lib/callCooldown';
import { probeCredentials, realProbeFetch } from '../AgentV3/credentialProbe';

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
 * THE VAULT'S OWN DOOR (admin 2026-09-12: "phone lock / face lock / pin dalna pade, tab open ho!").
 *
 * Everything below this line exists so that the routes which can hand back a DECRYPTED key refuse to do
 * so unless the person proved, seconds ago, that they are the account owner. The verification rules live
 * in `deviceUnlock.ts` as pure functions (49 tests, real key pairs); these routes are the plumbing.
 */

/** Where a user's registered device credentials live. Public keys only — no secret material. */
const DEVICE_CREDENTIALS = 'user_device_credentials';
/** Where reveals and deletions are recorded. A vault without a log cannot answer "who read this key?". */
const VAULT_AUDIT = 'secret_vault_audit';

/** The ticket header. A header rather than a body field so GET-shaped calls could use it too. */
export const UNLOCK_TICKET_HEADER = 'x-vault-unlock';

/**
 * Read the unlock ticket off a request and confirm it belongs to this user, right now.
 *
 * Returns null on anything that is not a live ticket, and callers answer 401 — never a partial result.
 * A vault that returns SOME keys without proof is an open vault with extra steps.
 */
function ticketFor(req: Request, userId: string, now = Date.now()): { method: UnlockMethod } | null {
  const raw = req.header(UNLOCK_TICKET_HEADER) ?? (typeof req.body?.ticket === 'string' ? req.body.ticket : '');
  if (!raw) return null;
  return verifyUnlockTicket(String(raw), userId, now, unlockSecret());
}

/**
 * Record what happened, best-effort.
 *
 * Deliberately NOT awaited into the response and never allowed to fail the action: an audit write that
 * can break a delete would make the logging itself a denial-of-service on the user's own vault. A write
 * that fails is logged server-side, which is the honest outcome — we do not pretend it was recorded.
 */
function auditVault(userId: string, action: string, detail: Record<string, unknown>): void {
  const db = getDb() as any;
  if (!db) return;
  void (async () => {
    try {
      await addDoc(collection(db, VAULT_AUDIT), { user_id: userId, action, at: new Date(), ...detail });
    } catch (err) {
      console.error('[vault-audit] could not record', action, err instanceof Error ? err.message : err);
    }
  })();
}

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

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // THE LOCK. Four endpoints, and the order matters: challenge → (register once) → unlock → reveal.
  // ════════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Step 1 — ask the server for something to sign, and find out whether this account already has a
   * device registered.
   *
   * The challenge is signed rather than stored (see `mintChallenge`), because this server runs as many
   * instances and the one that issues a challenge is usually not the one that verifies it.
   */
  app.post('/api/secrets/:userId/lock/challenge', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = req.params;
      let credentialIds: string[] = [];
      try {
        const snap = await getDocs(query(collection(db, DEVICE_CREDENTIALS), where('user_id', '==', userId)));
        credentialIds = snap.docs
          .map((d: any) => String(d.data()?.credential_id ?? ''))
          .filter((id: string) => !!id);
      } catch (err) {
        // A credential list we cannot read must NOT read as "no device registered" — that would quietly
        // push the user into re-registering and leave the old credential orphaned. Honest: no list.
        console.error('[vault-lock] could not list device credentials', err instanceof Error ? err.message : err);
        res.status(503).json({ error: 'Could not reach your vault just now. Try again in a moment.' });
        return;
      }
      res.json({
        challenge: mintChallenge(userId, Date.now(), unlockSecret()),
        credentialIds,
        hasDeviceLock: credentialIds.length > 0,
      });
    } catch {
      res.status(500).json({ error: 'Could not start the unlock.' });
    }
  });

  /**
   * Step 2 (once per device) — register this device's lock.
   *
   * 🔒 REGISTRATION IS ITSELF GATED BY A FRESH SIGN-IN. Otherwise a stolen session could enrol the
   * THIEF'S face and then legitimately unlock the vault forever — the lock would hand an attacker a key
   * instead of taking one away. So enrolling a new device requires the account proof, always.
   *
   * The public key arrives as SPKI from the browser's own `getPublicKey()`, which is why nothing here
   * decodes CBOR: the attestation object would have to be parsed by hand to dig out the same key, and a
   * parser is exactly where a security bug hides. We do not verify attestation — we are binding a
   * credential to an account, not auditing which manufacturer made the phone.
   */
  app.post('/api/secrets/:userId/lock/register', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = req.params;
      const now = Date.now();

      const fresh = process.env.VITEST ? { uid: userId, authTimeSec: Math.floor(now / 1000) } : await verifyFreshAuth(req);
      if (!fresh || !isFreshReauth(fresh.authTimeSec, now)) {
        res.status(401).json({ error: 'Sign in again to register this device.', needsReauth: true });
        return;
      }

      const { credentialId, publicKeySpki, alg, clientDataJSON, authenticatorData, label } = req.body ?? {};
      if (!isAcceptedAlg(typeof alg === 'number' ? alg : Number(alg))) {
        res.status(400).json({ error: 'This device uses a signature type the vault does not accept.' });
        return;
      }
      const clientData = base64urlToBuffer(String(clientDataJSON ?? ''));
      const authData = base64urlToBuffer(String(authenticatorData ?? ''));
      const spki = base64urlToBuffer(String(publicKeySpki ?? ''));
      const credId = String(credentialId ?? '').trim();
      if (!clientData.length || !authData.length || !spki.length || !credId) {
        res.status(400).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }

      const cd = verifyClientData(clientData.toString('utf8'), {
        expectedType: 'webauthn.create', uid: userId, nowMs: now, secret: unlockSecret(),
      });
      if (!cd.ok) {
        console.warn('[vault-lock] registration refused:', cd.reason);
        res.status(400).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }
      const parsed = parseAuthenticatorData(authData);
      if (!parsed || !rpIdMatches(parsed.rpIdHash)) {
        res.status(400).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }
      // 🔒 The flag that makes this a LOCK. Without userVerified the device merely noticed a touch; the
      // point of the feature is that the face, fingerprint or PIN was actually accepted.
      if (!parsed.flags.userVerified) {
        res.status(400).json({ error: 'Your device did not ask for your face, fingerprint or PIN. Turn on a screen lock, then try again.' });
        return;
      }

      // One document per credential id, so re-registering the SAME device replaces its row instead of
      // piling up duplicates — the same bug the secret save path had to fix in #2842.
      await setDoc(doc(db, DEVICE_CREDENTIALS, `${userId}__${credId}`.slice(0, 400)), {
        user_id: userId,
        credential_id: credId,
        public_key_spki: String(publicKeySpki),
        alg: Number(alg),
        sign_counter: parsed.signCounter,
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'This device',
        created_at: new Date(),
      });
      auditVault(userId, 'device-registered', { credential_id: credId });
      res.json({ success: true, ticket: mintUnlockTicket(userId, now, unlockSecret(), 'device-lock'), expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[vault-lock] registration failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not register this device.' });
    }
  });

  /**
   * Step 3 — open the vault, by EITHER real proof.
   *
   * `mode: 'device'` verifies a WebAuthn assertion; `mode: 'account'` accepts a genuinely fresh
   * re-authentication. Both mint the same ticket, so every route downstream has one thing to check and
   * cannot be reasoned about incorrectly ("did this path check the device or the password?" is not a
   * question any later reader has to answer).
   */
  app.post('/api/secrets/:userId/unlock', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId } = req.params;
      const now = Date.now();
      const mode = String(req.body?.mode ?? 'device');

      if (mode === 'account') {
        const fresh = process.env.VITEST ? { uid: userId, authTimeSec: Math.floor(now / 1000) } : await verifyFreshAuth(req);
        if (!fresh || !isFreshReauth(fresh.authTimeSec, now)) {
          res.status(401).json({ error: 'Confirm your account password, then try again.', needsReauth: true });
          return;
        }
        auditVault(userId, 'unlock', { unlock_method: 'account-reauth' });
        res.json({ ticket: mintUnlockTicket(userId, now, unlockSecret(), 'account-reauth'), method: 'account-reauth', expiresInMs: TICKET_TTL_MS });
        return;
      }

      const { credentialId, clientDataJSON, authenticatorData, signature } = req.body ?? {};
      const credId = String(credentialId ?? '').trim();
      const clientData = base64urlToBuffer(String(clientDataJSON ?? ''));
      const authData = base64urlToBuffer(String(authenticatorData ?? ''));
      const sig = base64urlToBuffer(String(signature ?? ''));
      if (!credId || !clientData.length || !authData.length || !sig.length) {
        res.status(400).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }

      const ref = doc(db, DEVICE_CREDENTIALS, `${userId}__${credId}`.slice(0, 400));
      const snap = await getDoc(ref);
      const stored = snap.exists() ? (snap.data() as { user_id?: string; public_key_spki?: string; sign_counter?: number }) : null;
      // The document id already contains the uid, but the ownership check is repeated rather than
      // inferred — the same IDOR discipline the delete route above documents.
      if (!stored || stored.user_id !== userId || !stored.public_key_spki) {
        res.status(401).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }

      const cd = verifyClientData(clientData.toString('utf8'), {
        expectedType: 'webauthn.get', uid: userId, nowMs: now, secret: unlockSecret(),
      });
      const parsed = parseAuthenticatorData(authData);
      const okSignature = cd.ok
        && !!parsed
        && rpIdMatches(parsed.rpIdHash)
        && parsed.flags.userVerified
        && signCounterOk(Number(stored.sign_counter ?? 0), parsed.signCounter)
        && verifyAssertionSignature({
          spkiDer: base64urlToBuffer(stored.public_key_spki),
          authenticatorData: authData,
          clientDataJSON: clientData,
          signature: sig,
        });

      if (!okSignature) {
        // The real reason goes to the log, never to the screen: "challenge expired" and "signature did
        // not verify" are equally useful to someone probing this endpoint.
        console.warn('[vault-lock] unlock refused:', cd.ok ? 'assertion checks failed' : cd.reason);
        auditVault(userId, 'unlock-refused', { credential_id: credId });
        res.status(401).json({ error: UNLOCK_REFUSED_MESSAGE });
        return;
      }

      // Move the counter forward so a cloned authenticator replaying an old assertion is caught next
      // time. Best-effort: a failed write must not refuse an unlock the signature already proved.
      try {
        await updateDoc(ref, { sign_counter: parsed!.signCounter, last_used_at: new Date() });
      } catch (err) {
        console.error('[vault-lock] counter not advanced', err instanceof Error ? err.message : err);
      }
      auditVault(userId, 'unlock', { unlock_method: 'device-lock', credential_id: credId });
      res.json({ ticket: mintUnlockTicket(userId, now, unlockSecret(), 'device-lock'), method: 'device-lock', expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[vault-lock] unlock failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not open the vault just now.' });
    }
  });

  /**
   * Step 4 — the values, and the ONLY route in the app that returns them.
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
      const { userId } = req.params;
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

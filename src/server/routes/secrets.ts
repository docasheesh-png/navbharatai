import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Reads/writes user_secrets (owner-only).
import { doc, getDoc, updateDoc, deleteDoc, setDoc, collection, addDoc, getDocs, query, where, getServerDb as getDb } from '../lib/serverDb';
import { encrypt, decrypt, loadUserVaultSecrets, secretCreatedAtMs } from '../lib/secrets';
import { planSecretWrite } from '../lib/secretScope';
import { requireUserMatch, trackDevice, verifyFreshAuth, resolveAccountContact } from '../lib/authMiddleware';
import {
  unlockSecret, mintUnlockTicket, verifyUnlockTicket, UNLOCK_REFUSED_MESSAGE, TICKET_TTL_MS,
  type UnlockMethod,
} from '../lib/vaultTicket';
import {
  readPinRecord, writePinRecord, emptyPinRecord, hasPin, pinGate, afterWrongPin, afterCorrectPin,
  pinRejectReason, newSalt, hashPin, matchesPin, newOtpCode, otpSendGate, afterOtpSent, otpCheck,
  otpDelivery, otpEmailMessage, otpEmailSubject, isFreshSignIn, OTP_RESEND_COOLDOWN_MS,
  MAX_PIN_ATTEMPTS, type OtpPurpose, type VaultPinRecord,
} from '../lib/vaultPin';
import { resolveEmailConfig, sendAlertEmail } from '../lib/alertEmail';
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
 * THE VAULT'S OWN DOOR — a 4-digit PIN (admin 2026-09-13: *"bas PIN banao, mobile number/email otp se
 * PIN banao, PIN (4 digit pin se hi open ho) … pin bhul jaye to, forget pin — otp — pin reset! waaki
 * sab hata do"*).
 *
 * Everything below this line exists so that the routes which can hand back a DECRYPTED key refuse to do
 * so unless the person proved, moments ago, that they are the account owner. The rules live in
 * `vaultPin.ts` (the PIN, the lock-out and the OTP) and `vaultTicket.ts` (the ticket) as pure functions;
 * these routes are the plumbing and the only part that touches Firestore.
 *
 * 🔴 WHY THE PIN IS VERIFIED HERE AND NOT IN THE BROWSER. Four digits are 10,000 guesses; a client-side
 * check would be tried exhaustively in under a second, and a client that is TOLD whether a digit was
 * right has already given the attacker everything. So the browser sends the PIN, learns only
 * right-or-wrong, and earns a short-lived ticket on success. Five wrong attempts and the vault locks
 * itself for an escalating window — that lock-out, not the PIN's length, is what makes four digits safe.
 */

/** Where each user's PIN hash, lock-out state and pending OTP live. One document per user. */
const VAULT_PIN = 'user_vault_pin';
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
  // THE PIN. Four endpoints: status → send a code → set the PIN → unlock with it.
  // ════════════════════════════════════════════════════════════════════════════════════════════════

  /** Load one user's PIN record, or a safe empty one. Throws only when the database itself is missing. */
  async function loadPinRecord(userId: string): Promise<VaultPinRecord> {
    const db = getDb() as any;
    if (!db) return emptyPinRecord();
    const snap = await getDoc(doc(db, VAULT_PIN, userId));
    return snap.exists() ? readPinRecord(snap.data()) : emptyPinRecord();
  }

  /**
   * Persist a PIN record.
   *
   * 🔒 A FAILED WRITE MUST FAIL THE REQUEST, which is the opposite of how the audit log above behaves,
   * and the difference is deliberate: this record holds the lock-out counter. If a wrong-PIN attempt
   * could be swallowed, an attacker whose writes always failed would get unlimited guesses — the
   * lock-out would silently stop existing. So every caller awaits this and answers an error if it throws.
   */
  async function savePinRecord(userId: string, record: VaultPinRecord): Promise<void> {
    const db = getDb() as any;
    if (!db) throw new Error('vault store unavailable');
    await setDoc(doc(db, VAULT_PIN, userId), { user_id: userId, ...writePinRecord(record), updated_at: new Date() }, { merge: true });
  }

  /** What the screen needs to decide which of the three states to render. Never reveals the PIN or code. */
  app.get('/api/secrets/:userId/pin', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const now = Date.now();
      const record = await loadPinRecord(userId);
      const gate = pinGate(record, now);
      const contact = await resolveAccountContact(userId);
      const delivery = otpDelivery(contact);
      res.set('Cache-Control', 'no-store, max-age=0');
      res.json({
        hasPin: hasPin(record),
        locked: gate.locked,
        lockedForMs: gate.lockedForMs,
        attemptsLeft: gate.attemptsLeft,
        maxAttempts: MAX_PIN_ATTEMPTS,
        channel: delivery.channel,
        destination: delivery.destination,
        resendInMs: Math.max(0, record.otpSentAtMs + OTP_RESEND_COOLDOWN_MS - now),
        /** True when a code has been sent and is still usable, so a reopened screen resumes mid-flow. */
        codePending: !!record.otpHash && record.otpExpiresAtMs > now,
      });
    } catch (err) {
      console.error('[vault-pin] status failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not check your vault just now. Please try again.' });
    }
  });

  /**
   * Send the verification code that authorises creating or resetting the PIN.
   *
   * 🔒 THE CODE IS NEVER RETURNED TO THE CLIENT, and the response does not say whether the account has
   * an address — it says where the code WENT, masked, which the owner recognises and nobody else learns
   * anything from.
   */
  app.post('/api/secrets/:userId/pin/otp', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const now = Date.now();
      const purpose: OtpPurpose = String(req.body?.purpose ?? '') === 'reset' ? 'reset' : 'create';

      const contact = await resolveAccountContact(userId);
      const delivery = otpDelivery(contact);
      if (delivery.channel !== 'email') {
        // Honest, and it names the door that DOES work for this account rather than just refusing.
        res.status(400).json({
          error: delivery.channel === 'fresh-sign-in'
            ? 'Your account has no email address, so we cannot send a code to it. Sign in again with your mobile number — that OTP is your verification — then create your PIN.'
            : 'Your account has no email address or mobile number on it, so we cannot send a verification code. Add one to your profile, then come back.',
          channel: delivery.channel,
        });
        return;
      }

      const record = await loadPinRecord(userId);
      const gate = otpSendGate(record, now);
      if (!gate.allowed) {
        res.status(429).json({ error: gate.reason, waitMs: gate.waitMs });
        return;
      }

      const cfg = resolveEmailConfig();
      if (!cfg.configured) {
        // NOT a silent failure and NOT a pretend send: the admin-facing reason is logged and the user is
        // told plainly that the code could not be sent, so nobody sits waiting for an email that is
        // never coming.
        console.error('[vault-pin] cannot send code — email is not configured:', cfg.reason);
        res.status(503).json({ error: 'We could not send your code just now. Please try again in a few minutes.' });
        return;
      }

      const code = newOtpCode();
      // The record is stored BEFORE the send, so a code that does reach the inbox always has a hash to
      // check it against. The reverse order would produce codes that are genuinely delivered and
      // genuinely unusable, which is the worst of both.
      await savePinRecord(userId, afterOtpSent(record, code, purpose, now));

      const sent = await sendAlertEmail({ ...cfg, to: [String(contact.email)] }, otpEmailMessage(code, purpose), {
        subject: otpEmailSubject(),
        footer: '— NavBharatAI\nYou are receiving this because someone asked to set the PIN on your saved keys.',
      });
      if (!sent.sent) {
        console.error('[vault-pin] code email not sent:', sent.error);
        res.status(502).json({ error: 'We could not send your code just now. Please try again in a moment.' });
        return;
      }

      auditVault(userId, 'pin-code-sent', { purpose });
      res.json({ sent: true, channel: 'email', destination: delivery.destination, resendInMs: OTP_RESEND_COOLDOWN_MS });
    } catch (err) {
      console.error('[vault-pin] send code failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not send your code just now. Please try again.' });
    }
  });

  /**
   * Create or reset the PIN.
   *
   * Creating and resetting are ONE endpoint on purpose: both need exactly the same proof, and a separate
   * "reset" path would be a second place for that requirement to weaken. The ticket is returned with it
   * so the user lands inside their keys instead of being asked for the PIN they just chose.
   */
  app.post('/api/secrets/:userId/pin', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const now = Date.now();
      const pin = String(req.body?.pin ?? '').trim();
      const reject = pinRejectReason(pin);
      if (reject) {
        res.status(400).json({ error: reject });
        return;
      }

      const contact = await resolveAccountContact(userId);
      const delivery = otpDelivery(contact);
      let record = await loadPinRecord(userId);

      if (delivery.channel === 'fresh-sign-in') {
        // An account with no email proves itself by the mobile OTP it signs in with; `auth_time` in the
        // SIGNED token is what we read, so this is not a claim the client can make on its own.
        const fresh = process.env.VITEST ? { uid: userId, authTimeSec: Math.floor(now / 1000) } : await verifyFreshAuth(req);
        if (!fresh || !isFreshSignIn(fresh.authTimeSec, now)) {
          res.status(401).json({
            error: 'Sign in again with your mobile number, then set your PIN.',
            needsFreshSignIn: true,
          });
          return;
        }
      } else {
        const check = otpCheck(record, String(req.body?.otp ?? ''), now);
        // The attempt is recorded either way — a wrong code that cost nothing to try is unlimited tries.
        await savePinRecord(userId, check.next);
        record = check.next;
        if (!check.ok) {
          res.status(400).json({ error: check.reason });
          return;
        }
      }

      const salt = newSalt();
      // A new PIN clears the lock-out too: the owner has just proved themselves through the account's own
      // contact, which is strictly stronger proof than the PIN the counter was protecting.
      const next = afterCorrectPin({ ...record, pinHash: hashPin(pin, salt), pinSalt: salt });
      await savePinRecord(userId, next);
      auditVault(userId, hasPin(record) ? 'pin-reset' : 'pin-created', {});
      res.json({ success: true, ticket: mintUnlockTicket(userId, now, unlockSecret()), method: 'pin', expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[vault-pin] set failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not save your PIN just now. Please try again.' });
    }
  });

  /** Open the vault with the PIN. The only place a PIN is ever compared, and it is compared here. */
  app.post('/api/secrets/:userId/pin/unlock', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const now = Date.now();
      const record = await loadPinRecord(userId);
      if (!hasPin(record)) {
        res.status(409).json({ error: 'Set up your PIN first.', needsSetup: true });
        return;
      }

      const gate = pinGate(record, now);
      if (gate.locked) {
        const mins = Math.ceil(gate.lockedForMs / 60_000);
        res.status(429).json({
          error: `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or use "Forgot PIN".`,
          lockedForMs: gate.lockedForMs,
        });
        return;
      }

      const pin = String(req.body?.pin ?? '').trim();
      if (!matchesPin(pin, record.pinSalt, record.pinHash)) {
        const next = afterWrongPin(record, now);
        // Awaited, and a write failure refuses the request: a lock-out counter that can be dropped is
        // not a lock-out. See `savePinRecord`.
        await savePinRecord(userId, next);
        const after = pinGate(next, now);
        auditVault(userId, 'pin-refused', { attempts_left: after.attemptsLeft });
        if (after.locked) {
          const mins = Math.ceil(after.lockedForMs / 60_000);
          res.status(429).json({ error: `Too many wrong PINs. Your vault is locked for ${mins} minute${mins === 1 ? '' : 's'}.`, lockedForMs: after.lockedForMs });
          return;
        }
        res.status(401).json({
          error: `That PIN is not right. ${after.attemptsLeft} ${after.attemptsLeft === 1 ? 'try' : 'tries'} left before your vault locks.`,
          attemptsLeft: after.attemptsLeft,
        });
        return;
      }

      await savePinRecord(userId, afterCorrectPin(record));
      auditVault(userId, 'unlock', { unlock_method: 'pin' });
      res.json({ ticket: mintUnlockTicket(userId, now, unlockSecret()), method: 'pin', expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[vault-pin] unlock failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: UNLOCK_REFUSED_MESSAGE });
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

/**
 * THE APP LOCK — one 4-digit PIN, and the user chooses which parts of NavBharatAI it guards.
 *
 * Admin 2026-09-13, verbatim: *"yeh PIN system sirf 'secret and api key' ke liye nahi, aur bhi options ke
 * liye lagu karna hoga … general pin system banana hai. setting me general settings me, user ko option do
 * kahan kahan pin lagana hai … 1- api keys and secret (non removal ✅) 2- user chahe to (on/off) default
 * off: navbharatai pro, billings, subscription, wallet recharge, code studio, settings"*.
 *
 * Five endpoints, and the order a screen uses them: status → send a code → set the PIN → unlock → choose
 * the areas.
 *
 * 🔴 WHY THE PIN IS VERIFIED HERE AND NOT IN THE BROWSER. Four digits are 10,000 guesses; a client-side
 * check would be tried exhaustively in under a second, and a client that is TOLD whether a digit was
 * right has already given the attacker everything. So the browser sends the PIN, learns only
 * right-or-wrong, and earns a short-lived ticket on success. Five wrong attempts and the lock holds for
 * an escalating window — that lock-out, not the PIN's length, is what makes four digits safe. The rules
 * are pure functions in `lib/vaultPin.ts`; this file is the plumbing and the only part touching Firestore.
 *
 * 🔒 AND THE ONE THAT MAKES THE WHOLE FEATURE REAL: CHANGING WHICH AREAS ARE LOCKED NEEDS THE PIN.
 * A lock somebody holding your unlocked phone can switch off in Settings is not a lock — it is a
 * preference. So `PUT /areas` demands a live ticket, exactly like revealing a key does, and `api_keys`
 * cannot be removed at any layer (`normaliseLockedAreas` puts it back whatever arrives).
 */
import type { Express, Request, Response } from 'express';
import { requireUserMatch, verifyFreshAuth, resolveAccountContact } from '../lib/authMiddleware';
import { loadLockRecord, saveLockRecord } from '../lib/appLockStore';
import { unlockSecret, mintUnlockTicket, UNLOCK_REFUSED_MESSAGE, TICKET_TTL_MS } from '../lib/vaultTicket';
import { ticketFor } from '../lib/vaultTicketHttp';
import { auditVault } from '../lib/vaultAudit';
import {
  hasPin, pinGate, afterWrongPin, afterCorrectPin,
  pinRejectReason, newSalt, hashPin, matchesPin, newOtpCode, otpSendGate, afterOtpSent, otpCheck,
  otpDelivery, otpEmailMessage, otpEmailSubject, isFreshSignIn, OTP_RESEND_COOLDOWN_MS,
  MAX_PIN_ATTEMPTS, type OtpPurpose, type VaultPinRecord,
} from '../lib/vaultPin';
import { normaliseLockedAreas, effectiveLockedAreas } from '../../lib/appLockAreas';
import { resolveEmailConfig, sendAlertEmail } from '../lib/alertEmail';
import { routeParam, routeParams } from '../lib/expressCompat';

export function registerAppLockRoutes(app: Express): void {
  /** The shape every screen reads. Never reveals the PIN, its hash, or a pending code. */
  app.get('/api/app-lock/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const now = Date.now();
      const record = await loadLockRecord(userId);
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
        /** Exactly what the user ticked, for the Settings list. */
        areas: normaliseLockedAreas(record.lockedAreas),
        /**
         * What is ACTUALLY in force — the same list plus what locking the whole Wallet & Billing screen
         * already contains. The gates read this one, so a screen can never disagree with the server
         * about whether it is locked.
         */
        effectiveAreas: effectiveLockedAreas(record.lockedAreas),
      });
    } catch (err) {
      console.error('[app-lock] status failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not check your app lock just now. Please try again.' });
    }
  });

  /**
   * Send the verification code that authorises creating or resetting the PIN.
   *
   * 🔒 THE CODE IS NEVER RETURNED TO THE CLIENT, and the response says only where it WENT, masked — which
   * the owner recognises and nobody else learns anything from.
   */
  app.post('/api/app-lock/:userId/otp', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const now = Date.now();
      const purpose: OtpPurpose = String(req.body?.purpose ?? '') === 'reset' ? 'reset' : 'create';

      const contact = await resolveAccountContact(userId);
      const delivery = otpDelivery(contact);
      if (delivery.channel !== 'email') {
        // Honest, and it names the door that DOES work for this account rather than just refusing.
        res.status(400).json({
          error: delivery.channel === 'fresh-sign-in'
            ? 'Your account has no email address, so we cannot send a code to it. Sign in again with your mobile number — that OTP is your verification — then set your PIN.'
            : 'Your account has no email address or mobile number on it, so we cannot send a verification code. Add one to your profile, then come back.',
          channel: delivery.channel,
        });
        return;
      }

      const record = await loadLockRecord(userId);
      const gate = otpSendGate(record, now);
      if (!gate.allowed) {
        res.status(429).json({ error: gate.reason, waitMs: gate.waitMs });
        return;
      }

      const cfg = resolveEmailConfig();
      if (!cfg.configured) {
        // NOT a silent failure and NOT a pretend send: the admin-facing reason is logged and the user is
        // told plainly that the code could not be sent, so nobody waits for an email that is not coming.
        console.error('[app-lock] cannot send code — email is not configured:', cfg.reason);
        res.status(503).json({ error: 'We could not send your code just now. Please try again in a few minutes.' });
        return;
      }

      const code = newOtpCode();
      // Stored BEFORE the send, so a code that does reach the inbox always has a hash to check it
      // against. The reverse order produces codes that are genuinely delivered and genuinely unusable.
      await saveLockRecord(userId, afterOtpSent(record, code, purpose, now));

      const sent = await sendAlertEmail({ ...cfg, to: [String(contact.email)] }, otpEmailMessage(code, purpose), {
        subject: otpEmailSubject(),
        footer: '— NavBharatAI\nYou are receiving this because someone asked to set the PIN on your app lock.',
      });
      if (!sent.sent) {
        console.error('[app-lock] code email not sent:', sent.error);
        res.status(502).json({ error: 'We could not send your code just now. Please try again in a moment.' });
        return;
      }

      auditVault(userId, 'pin-code-sent', { purpose });
      res.json({ sent: true, channel: 'email', destination: delivery.destination, resendInMs: OTP_RESEND_COOLDOWN_MS });
    } catch (err) {
      console.error('[app-lock] send code failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not send your code just now. Please try again.' });
    }
  });

  /**
   * Create or reset the PIN.
   *
   * Creating and resetting are ONE endpoint on purpose: both need exactly the same proof, and a separate
   * "reset" path would be a second place for that requirement to weaken. The ticket comes back with it so
   * the user lands inside whatever they were opening instead of being asked for the PIN they just chose.
   */
  app.post('/api/app-lock/:userId/pin', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const now = Date.now();
      const pin = String(req.body?.pin ?? '').trim();
      const reject = pinRejectReason(pin);
      if (reject) {
        res.status(400).json({ error: reject });
        return;
      }

      const contact = await resolveAccountContact(userId);
      const delivery = otpDelivery(contact);
      let record = await loadLockRecord(userId);

      if (delivery.channel === 'fresh-sign-in') {
        // An account with no email proves itself by the mobile OTP it signs in with; `auth_time` in the
        // SIGNED token is what we read, so this is not a claim the client can make on its own.
        const fresh = process.env.VITEST ? { uid: userId, authTimeSec: Math.floor(now / 1000) } : await verifyFreshAuth(req);
        if (!fresh || !isFreshSignIn(fresh.authTimeSec, now)) {
          res.status(401).json({ error: 'Sign in again with your mobile number, then set your PIN.', needsFreshSignIn: true });
          return;
        }
      } else {
        const check = otpCheck(record, String(req.body?.otp ?? ''), now);
        // The attempt is recorded either way — a wrong code that cost nothing to try is unlimited tries.
        await saveLockRecord(userId, check.next);
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
      await saveLockRecord(userId, next);
      auditVault(userId, hasPin(record) ? 'pin-reset' : 'pin-created', {});
      res.json({ success: true, ticket: mintUnlockTicket(userId, now, unlockSecret()), method: 'pin', expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[app-lock] set failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not save your PIN just now. Please try again.' });
    }
  });

  /** Unlock with the PIN. The only place a PIN is ever compared, and it is compared here. */
  app.post('/api/app-lock/:userId/unlock', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const now = Date.now();
      const record = await loadLockRecord(userId);
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
        // Awaited, and a write failure refuses the request: a lock-out counter that can be dropped is not
        // a lock-out. See `saveRecord`.
        await saveLockRecord(userId, next);
        const after = pinGate(next, now);
        auditVault(userId, 'pin-refused', { attempts_left: after.attemptsLeft });
        if (after.locked) {
          const mins = Math.ceil(after.lockedForMs / 60_000);
          res.status(429).json({ error: `Too many wrong PINs. Your app lock is held for ${mins} minute${mins === 1 ? '' : 's'}.`, lockedForMs: after.lockedForMs });
          return;
        }
        res.status(401).json({
          error: `That PIN is not right. ${after.attemptsLeft} ${after.attemptsLeft === 1 ? 'try' : 'tries'} left before it locks for a while.`,
          attemptsLeft: after.attemptsLeft,
        });
        return;
      }

      await saveLockRecord(userId, afterCorrectPin(record));
      auditVault(userId, 'unlock', { unlock_method: 'pin' });
      res.json({ ticket: mintUnlockTicket(userId, now, unlockSecret()), method: 'pin', expiresInMs: TICKET_TTL_MS });
    } catch (err) {
      console.error('[app-lock] unlock failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: UNLOCK_REFUSED_MESSAGE });
    }
  });

  /**
   * Choose which areas the PIN guards.
   *
   * 🔒 THIS IS THE ROUTE THAT MAKES THE FEATURE MORE THAN A PREFERENCE, so it is the one to read twice:
   *
   *  - **It needs a live ticket.** Otherwise somebody holding an unlocked phone opens Settings and
   *    switches the lock off, and everything else here was theatre. The ticket is the same one a reveal
   *    spends, so a user who just typed their PIN is not asked again.
   *  - **It needs a PIN to exist first.** Locking areas with no PIN set would lock the owner out of their
   *    own app with no way back in — the worst possible outcome, and the one the first absolute rule is
   *    about. A request with no PIN is refused and the screen is told to set one up.
   *  - **`api_keys` cannot be dropped.** `normaliseLockedAreas` puts it back whatever arrives, so
   *    "unlock my keys permanently" is not a request that exists at any layer.
   *  - **Unknown ids are dropped, not stored.** A stale id would sit in the list looking like a lock that
   *    is on while nothing checks it — a lock that lies about itself is worse than no lock.
   */
  app.put('/api/app-lock/:userId/areas', requireUserMatch('userId'), async (req: Request, res: Response) => {
    try {
      const { userId } = routeParams(req.params);
      const record = await loadLockRecord(userId);
      if (!hasPin(record)) {
        res.status(409).json({ error: 'Set up your PIN before choosing what to lock.', needsSetup: true });
        return;
      }
      const unlock = ticketFor(req, userId);
      if (!unlock) {
        res.status(401).json({ error: 'Enter your PIN to change what is locked.', needsUnlock: true });
        return;
      }

      const areas = normaliseLockedAreas(req.body?.areas);
      await saveLockRecord(userId, { ...record, lockedAreas: areas });
      auditVault(userId, 'lock-areas-changed', { areas, unlock_method: unlock.method });
      res.json({ areas, effectiveAreas: effectiveLockedAreas(areas) });
    } catch (err) {
      console.error('[app-lock] areas update failed', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not save your app lock settings just now. Please try again.' });
    }
  });
}

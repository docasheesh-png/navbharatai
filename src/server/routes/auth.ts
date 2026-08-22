import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, getAdminAuthForPhone } from '../lib/authMiddleware';
import { otpSendDecision, phoneOwnerUid, phoneForLog, type OtpPurpose } from '../lib/phoneGate';
import { consumeDurableRate } from '../lib/DurableRateLimit';
import { normalizePhoneForGift } from '../lib/giftIdentity';

/**
 * Authentication routes extracted from the server.ts monolith (Phase 1).
 * Currently hosts the server-side OTP anti-spam / cooldown gateway. GitHub and
 * Firebase OAuth routes remain in server.ts for now (extracted in a later step).
 */

// Secure Server-Side OTP Cooldown Protection & Anti-Spam Rates State Maps
interface OtpRequestRecord {
  lastRequestedAt: number;
  requestTimestamps: number[];
}

const phoneOtpRecords = new Map<string, OtpRequestRecord>();
const ipOtpRecords = new Map<string, OtpRequestRecord>();

/**
 * These maps are the FAST first line, and they are per-INSTANCE. Cloud Run runs several instances
 * and recycles them, so on their own the 5/hour below is not the ceiling it looks like: a caller
 * landing on a fresh instance starts from zero. That was tolerable when an OTP only gated a login.
 * It stops being tolerable with gift plan v2, where one completed verification pays ₹500 — a gap
 * worth scripting against. The durable buckets added below are the real limit; these stay because
 * they are instant, free, and still hold when Firestore is unreachable (the durable limiter is
 * deliberately fail-open, so something has to).
 */
const MAX_TRACKED_KEYS = 20_000;

/**
 * Drop entries nothing can still be rate-limited by. Without this the maps grow for every unique
 * phone and IP ever seen and are never emptied — a slow leak on a long-lived instance, since only
 * the timestamps INSIDE a record were ever pruned, never the record itself. Swept only when the map
 * is already large, so the normal path costs nothing.
 */
function pruneStale(map: Map<string, OtpRequestRecord>, now: number, hourMs: number): void {
  if (map.size < MAX_TRACKED_KEYS) return;
  for (const [key, rec] of map) {
    if (now - rec.lastRequestedAt > hourMs) map.delete(key);
  }
}

/** Platform-wide OTP ceiling per hour. This is the one that caps the actual SMS BILL: per-phone and
 *  per-IP limits are both evaded by a botnet rotating numbers and addresses, and neither bounds what
 *  we can be made to spend in an hour. Generous by default and env-tunable, because a ceiling set too
 *  low blocks real users during a growth spike. */
function otpGlobalHourlyMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OTP_GLOBAL_HOURLY_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

export function registerAuthRoutes(app: Express): void {
  // Secure Send-OTP Pre-Request Security Gateway / Cooldown Checker
  app.post('/api/auth/send-otp', async (req: Request, res: Response) => {
    try {
      const { phone } = req.body;
      /**
       * WHY THIS ENDPOINT NOW ASKS WHAT THE OTP IS *FOR* (admin 2026-08-22).
       *
       * A number that already has an account must not be verifiable onto a SECOND account — but it
       * must absolutely stay signable-in-with, because that is how its owner gets back in. Same
       * endpoint, same number, opposite answers, so the purpose has to travel with the request.
       *
       * Defaulting to 'login' keeps every existing caller — including the installed Android/iOS build,
       * which ships its own bundled frontend and will not carry this field until a new store release —
       * on exactly today's behaviour.
       */
      const purpose: OtpPurpose = req.body?.purpose === 'verify' ? 'verify' : 'login';
      const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown-ip').split(',')[0].trim();

      // Validate TYPE, not just truthiness: a non-string phone (number/object/array) used to reach
      // `phone.replace(...)` below and throw → a 500 on malformed input. Reject it cleanly as a 400.
      if (!phone || typeof phone !== 'string' || phone.length > 20) {
        return res.status(400).json({ success: false, message: "A valid phone number is required." });
      }

      // Normalize with the SAME function the gift marker uses. The old strip-the-symbols version left
      // `9876543210` and `+919876543210` as two DIFFERENT keys, so one handset simply got two buckets
      // and twice the hourly allowance. Sharing the normalizer means "the same number" means the same
      // thing to the rate limiter and to the money.
      const cleanPhone = normalizePhoneForGift(phone) || phone.replace(/[\s\-()+]/g, '');
      const now = Date.now();
      const COOLDOWN_MS = 30000; // 30 seconds
      const HOUR_MS = 3600000; // 1 hour
      const MAX_HOURLY_REQUESTS = 5;

      const checkRecordLimits = (record: OtpRequestRecord | undefined, identifierType: 'phone' | 'IP'): { ok: boolean; message?: string } => {
        if (!record) return { ok: true };

        // 1. 30 Seconds Cooldown Prevention Check
        const elapsed = now - record.lastRequestedAt;
        if (elapsed < COOLDOWN_MS) {
          const remainingSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
          return {
            ok: false,
            message: `Please wait ${remainingSeconds} seconds before requesting another OTP.`
          };
        }

        // 2. Hourly Rate limit (Max 5 request attempts per hour)
        const hourlyTimestamps = record.requestTimestamps.filter(t => now - t < HOUR_MS);
        record.requestTimestamps = hourlyTimestamps; // update current list in place

        if (hourlyTimestamps.length >= MAX_HOURLY_REQUESTS) {
          const oldestRequest = hourlyTimestamps[0];
          const waitTimeLeftMs = HOUR_MS - (now - oldestRequest);
          const minutesLeft = Math.ceil(waitTimeLeftMs / 60000);
          return {
            ok: false,
            message: `Too many OTP requests from this ${identifierType}. Please try again after ${minutesLeft} minutes.`
          };
        }

        return { ok: true };
      };

      // ONE NUMBER, ONE ACCOUNT — checked BEFORE the rate-limit bookkeeping, so a refusal costs the
      // user nothing from their hourly OTP budget for a message they were never going to receive.
      // Fails OPEN by construction (see phoneGate): an unreadable directory sends the OTP, because the
      // auth provider itself still refuses a duplicate at link time.
      if (purpose === 'verify') {
        const callerUid = await verifyFirebaseToken(req);
        const ownerUid = await phoneOwnerUid(phone, getAdminAuthForPhone);
        const decision = otpSendDecision({ purpose, ownerUid, callerUid });
        if (!decision.allow) {
          console.log(`[OTP GATE] refused verify for ${phoneForLog(phone)} — already owned by another account`);
          // 409, not 429: nothing is rate-limited here and retrying later cannot help. The body carries
          // the machine-readable code so the client can offer the way out rather than a dead end.
          return res.status(409).json({ success: false, code: decision.code, message: decision.message });
        }
      }

      // Check phone limits
      const phoneCheck = checkRecordLimits(phoneOtpRecords.get(cleanPhone), 'phone');
      if (!phoneCheck.ok) {
        return res.status(429).json({ success: false, message: phoneCheck.message });
      }

      // Check IP limits
      const ipCheck = checkRecordLimits(ipOtpRecords.get(ip), 'IP');
      if (!ipCheck.ok) {
        return res.status(429).json({ success: false, message: ipCheck.message });
      }

      // Record this attempt in maps
      const updateOtpRecord = (currRecord: OtpRequestRecord | undefined): OtpRequestRecord => {
        const timestamps = currRecord ? [...currRecord.requestTimestamps, now] : [now];
        return {
          lastRequestedAt: now,
          requestTimestamps: timestamps
        };
      };

      // ── DURABLE LIMITS — the ones that actually hold (2026-08-21) ──
      //
      // Checked only after the in-memory pass, so a caller already over the fast limit never reaches
      // Firestore. All three are FAIL-OPEN by design (`consumeDurableRate`): a database hiccup must
      // never stop a real person signing in, and the in-memory limiter above is still in force if it
      // does. Consumed BEFORE returning success, because success is what causes the SMS to be sent.
      const durable = await Promise.all([
        consumeDurableRate('otp_phone', cleanPhone, MAX_HOURLY_REQUESTS, HOUR_MS, now),
        consumeDurableRate('otp_ip', ip, MAX_HOURLY_REQUESTS, HOUR_MS, now),
        // The platform-wide ceiling. Per-phone and per-IP limits are both evaded by rotating the key;
        // neither bounds what an attacker can make us SPEND in an hour. This one does.
        consumeDurableRate('otp_global', 'all', otpGlobalHourlyMax(), HOUR_MS, now),
      ]);
      const [phoneRate, ipRate, globalRate] = durable;
      if (!phoneRate.allowed || !ipRate.allowed) {
        return res.status(429).json({
          success: false,
          message: 'Too many OTP requests. Please try again in a little while.',
        });
      }
      if (!globalRate.allowed) {
        // Logged loudly and separately: this is not one user misbehaving, it is the whole platform at
        // its SMS ceiling — either genuine growth (raise OTP_GLOBAL_HOURLY_MAX) or an attack in
        // progress. Either way the admin needs to know it happened, not just the user.
        console.error(`[OTP PROTECTION] GLOBAL hourly ceiling reached (${globalRate.used}/${globalRate.limit}) — OTP dispatch refused platform-wide.`);
        return res.status(429).json({
          success: false,
          message: 'Verification is busy right now. Please try again in a few minutes.',
        });
      }

      phoneOtpRecords.set(cleanPhone, updateOtpRecord(phoneOtpRecords.get(cleanPhone)));
      ipOtpRecords.set(ip, updateOtpRecord(ipOtpRecords.get(ip)));
      pruneStale(phoneOtpRecords, now, HOUR_MS);
      pruneStale(ipOtpRecords, now, HOUR_MS);

      console.log(`[OTP PROTECTION SUCCESS] Request verified for phone ${cleanPhone} from source IP ${ip}`);
      return res.json({ success: true, message: "Verification cooldown validated. Safe to initialize OTP dispatch." });

    } catch (err: any) {
      console.error("[OTP PROTECTION SECURITY ERROR]", err);
      return res.status(500).json({ success: false, message: "Security gateway error during OTP dispatch validation." });
    }
  });
}

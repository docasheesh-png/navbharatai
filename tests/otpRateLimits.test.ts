/**
 * The OTP send gateway's limits must actually HOLD.
 *
 * Why this exists: the limits were in-process `Map`s. Cloud Run runs several instances and recycles
 * them, so 5/hour was the per-instance figure, not the ceiling — a caller landing on a fresh instance
 * started from zero. That was tolerable while an OTP only gated a login. It stops being tolerable
 * under gift plan v2, where one completed verification pays ₹500.
 *
 * Two further defects were found in the same code and are pinned here:
 *  • `9876543210` and `+919876543210` were DIFFERENT keys, so one handset got two buckets and twice
 *    the allowance.
 *  • The maps were never emptied — only the timestamps inside a record were pruned, never the record
 *    — so they grew for every unique phone and IP ever seen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizePhoneForGift } from '../src/server/lib/giftIdentity';
import { windowKey, decideRate } from '../src/server/lib/DurableRateLimit';

const SRC = readFileSync(join(__dirname, '..', 'src/server/routes/auth.ts'), 'utf8');

describe('OTP limits survive a Cloud Run instance recycle', () => {
  it('consumes DURABLE buckets for phone, IP and the platform as a whole', () => {
    expect(SRC).toMatch(/consumeDurableRate\('otp_phone', cleanPhone, MAX_HOURLY_REQUESTS, HOUR_MS, now\)/);
    expect(SRC).toMatch(/consumeDurableRate\('otp_ip', ip, MAX_HOURLY_REQUESTS, HOUR_MS, now\)/);
    expect(SRC).toMatch(/consumeDurableRate\('otp_global', 'all', otpGlobalHourlyMax\(\), HOUR_MS, now\)/);
  });

  it('keeps the in-memory limiter as well, not instead', () => {
    // The durable limiter is fail-open by design, so something must still hold when Firestore is down.
    expect(SRC).toMatch(/phoneOtpRecords\.get\(cleanPhone\)/);
    expect(SRC).toMatch(/ipOtpRecords\.get\(ip\)/);
  });

  it('spends the durable budget BEFORE reporting success', () => {
    // Success is what causes the SMS to be sent, so the budget must be consumed on this side of it.
    const consumeAt = SRC.indexOf("consumeDurableRate('otp_global'");
    const successAt = SRC.indexOf('Safe to initialize OTP dispatch');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(consumeAt);
  });

  it('a durable bucket is shared across instances by construction', () => {
    // Same name+key+window ⇒ same document id, whichever instance computes it.
    const now = 1_700_000_000_000;
    expect(windowKey('otp_phone', '919876543210', now, 3_600_000))
      .toBe(windowKey('otp_phone', '919876543210', now + 60_000, 3_600_000));
    expect(decideRate(5, 5)).toBe(false);
    expect(decideRate(4, 5)).toBe(true);
  });
});

describe('one handset is one bucket', () => {
  it('the OTP limiter and the gift marker agree on what "the same number" means', () => {
    expect(SRC).toMatch(/const cleanPhone = normalizePhoneForGift\(phone\)/);
    // The forms that used to land on separate buckets now share one.
    const base = normalizePhoneForGift('+919876543210');
    for (const form of ['9876543210', '09876543210', '+91 98765-43210']) {
      expect(normalizePhoneForGift(form)).toBe(base);
    }
  });

  it('still produces a key for input the normalizer cannot resolve', () => {
    // A number it does not recognise must not fall through to an EMPTY key, which would put every
    // such caller in one shared bucket (or disable the limit entirely).
    expect(SRC).toMatch(/normalizePhoneForGift\(phone\) \|\| phone\.replace\(/);
  });
});

describe('the platform ceiling — what actually caps the SMS bill', () => {
  it('is generous by default and tunable without a deploy', () => {
    expect(SRC).toMatch(/OTP_GLOBAL_HOURLY_MAX/);
    expect(SRC).toMatch(/Number\.isFinite\(n\) && n > 0 \? Math\.floor\(n\) : 500/);
  });

  it('is reported to the admin as a platform event, not as one user misbehaving', () => {
    expect(SRC).toMatch(/console\.error\(`\[OTP PROTECTION\] GLOBAL hourly ceiling reached/);
  });

  it('tells the user it is busy rather than blaming them', () => {
    const idx = SRC.indexOf('GLOBAL hourly ceiling reached');
    const after = SRC.slice(idx, idx + 400);
    expect(after).toMatch(/Verification is busy right now/);
    expect(after).not.toMatch(/blocked|abuse|suspicious/i);
  });
});

describe('the tracking maps cannot grow forever', () => {
  it('prunes stale records once the map is large', () => {
    expect(SRC).toMatch(/function pruneStale/);
    expect(SRC).toMatch(/if \(map\.size < MAX_TRACKED_KEYS\) return;/);
    expect(SRC).toMatch(/if \(now - rec\.lastRequestedAt > hourMs\) map\.delete\(key\);/);
  });

  it('prunes both maps on a successful request', () => {
    expect(SRC).toMatch(/pruneStale\(phoneOtpRecords, now, HOUR_MS\);/);
    expect(SRC).toMatch(/pruneStale\(ipOtpRecords, now, HOUR_MS\);/);
  });
});

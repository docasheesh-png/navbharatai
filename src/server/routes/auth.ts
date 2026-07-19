import type { Express, Request, Response } from 'express';

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

export function registerAuthRoutes(app: Express): void {
  // Secure Send-OTP Pre-Request Security Gateway / Cooldown Checker
  app.post('/api/auth/send-otp', (req: Request, res: Response) => {
    try {
      const { phone } = req.body;
      const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown-ip').split(',')[0].trim();

      // Validate TYPE, not just truthiness: a non-string phone (number/object/array) used to reach
      // `phone.replace(...)` below and throw → a 500 on malformed input. Reject it cleanly as a 400.
      if (!phone || typeof phone !== 'string' || phone.length > 20) {
        return res.status(400).json({ success: false, message: "A valid phone number is required." });
      }

      // Normalize phone number structure (remove symbols, spaces, dashes)
      const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');
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

      phoneOtpRecords.set(cleanPhone, updateOtpRecord(phoneOtpRecords.get(cleanPhone)));
      ipOtpRecords.set(ip, updateOtpRecord(ipOtpRecords.get(ip)));

      console.log(`[OTP PROTECTION SUCCESS] Request verified for phone ${cleanPhone} from source IP ${ip}`);
      return res.json({ success: true, message: "Verification cooldown validated. Safe to initialize OTP dispatch." });

    } catch (err: any) {
      console.error("[OTP PROTECTION SECURITY ERROR]", err);
      return res.status(500).json({ success: false, message: "Security gateway error during OTP dispatch validation." });
    }
  });
}

// U-4 (verified recipe modules) — India-timezone date/time formatting (dependency-free, Intl-based).
//
// Servers run in UTC, but Indian users expect times in IST (Asia/Kolkata, UTC+5:30). If you format a
// timestamp with the server's local/UTC clock, every date shown is off by up to 5.5 hours — a real,
// user-visible bug on order times, appointment slots, "posted at" labels. This recipe ships correct,
// IST-pinned formatters (built on Intl with an explicit timeZone) plus a human "2 hours ago" relative-time
// helper. Accepts a Date, an ISO string, or an epoch-ms number. No dependency, no env keys. PURE builder;
// correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface DateTimeConfig {
  files: Record<string, string>;
  instructions: string;
}

const DATETIME_SERVER = `// The app's display timezone. Change this one constant if you serve a different region.
const TZ = 'Asia/Kolkata';

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "19 Jul 2026" — the date in IST, regardless of the server's own timezone.
export function formatIstDate(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

// "3:45 PM" — the time of day in IST.
export function formatIstTime(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

// "19 Jul 2026, 3:45 PM" — date + time in IST, for order/appointment/"posted at" labels.
export function formatIstDateTime(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

// "2 hours ago" / "in 3 days" — a human relative-time label. Pass a reference "now" for deterministic tests.
export function relativeTime(value: Date | string | number, now: Date | string | number = new Date()): string {
  const d = toDate(value);
  const ref = toDate(now);
  if (!d || !ref) return '';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffSec = Math.round((d.getTime() - ref.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return rtf.format(0, 'second');
}
`;

const INSTRUCTIONS =
  'IST date/time formatting wired at server/lib/datetime.ts (no dependency — native Intl). Import ' +
  'formatIstDateTime(ts) / formatIstDate(ts) / formatIstTime(ts) to show any timestamp in IST (Asia/Kolkata) ' +
  "regardless of the server's own timezone — fixing the common bug where a UTC server shows times 5.5 hours " +
  'off to Indian users. Use relativeTime(ts) for a "2 hours ago" label. All accept a Date, an ISO string, or ' +
  'an epoch-ms number. Change the TZ constant to serve a different region. No API key needed.';

export function generateDateTimeIntegration(): DateTimeConfig {
  return {
    files: { 'server/lib/datetime.ts': DATETIME_SERVER },
    instructions: INSTRUCTIONS,
  };
}

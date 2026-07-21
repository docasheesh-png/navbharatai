// Roadmap breadth — availability / opening-hours starter (a packaged domain vertical).
//
// A business-hours engine for shops, clinics, restaurants, support desks — anything with "are you open right
// now?". The real feature is CORRECT OPEN/CLOSED RESOLUTION: weekly recurring windows per weekday, multiple
// windows a day, OVERNIGHT spans that cross midnight (e.g. Fri 22:00 → Sat 02:00), and date-specific
// exceptions (a holiday closed, or special hours) that override the weekly schedule — isOpenAt(date) resolves
// all of that exactly, and nextOpenFrom(date) finds the next opening. This emits a dependency-free
// AvailabilityService (no crypto/deps) + an Express router + a README. Real logic, not a stub — the
// overnight-span + exception rules are unit-tested against the emitted code. Pure builder → the caller writes
// the files. Distinct from generate_booking (reserves discrete slots) and generate_scheduler (runs cron jobs).

export const AVAILABILITY_SERVICE_SOURCE = `// Availability / opening-hours domain logic. The core guarantee is CORRECT OPEN/CLOSED RESOLUTION: weekly
// recurring windows per weekday, multiple windows a day, OVERNIGHT windows that cross midnight (close <= open
// means the window runs into the next day), and date-specific EXCEPTIONS that override the weekly schedule for
// one date (closed, or special hours). Times are minutes-from-midnight internally so comparisons never drift.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Window { open: string; close: string } // 'HH:MM'..'HH:MM' ('24:00' = end of day)

// weekday: 0=Sunday .. 6=Saturday (matches Date.getUTCDay()).
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface Win { openMin: number; closeMin: number } // closeMin<=openMin ⇒ overnight

function parseHHMM(s: string): number {
  const m = /^([0-2]\\d):([0-5]\\d)$/.exec(String(s).trim());
  if (!m) throw new Error('time must be HH:MM');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || (h === 24 && min !== 0) || min > 59) throw new Error('time out of range');
  return h * 60 + min; // 24:00 -> 1440
}

export class AvailabilityService {
  private weekly = new Map<Weekday, Win[]>();     // recurring windows per weekday
  private exceptions = new Map<string, Win[]>();  // YYYY-MM-DD -> windows ([] = explicitly closed that date)

  private toWins(windows: Window[]): Win[] {
    if (!Array.isArray(windows)) throw new Error('windows must be a list');
    return windows.map((w) => {
      const openMin = parseHHMM(w.open);
      const closeMin = parseHHMM(w.close);
      if (openMin === closeMin) throw new Error('a window cannot be zero-length');
      return { openMin, closeMin };
    });
  }

  /** Set the recurring windows for a weekday (replaces any existing). Empty list = closed all day. */
  setWeekly(weekday: Weekday, windows: Window[]): void {
    if (weekday < 0 || weekday > 6 || !Number.isInteger(weekday)) throw new Error('weekday must be 0..6');
    this.weekly.set(weekday, this.toWins(windows));
  }

  /** Add/replace a date-specific exception. windows=[] closes that date; otherwise it uses these special hours. */
  setException(dateISO: string, windows: Window[]): void {
    const date = String(dateISO).trim();
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
    this.exceptions.set(date, this.toWins(windows));
  }

  private dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** The effective windows for a given calendar date: the exception if one exists, else the weekly schedule. */
  private windowsForDate(d: Date): Win[] {
    const key = this.dateKey(d);
    if (this.exceptions.has(key)) return this.exceptions.get(key) as Win[];
    return this.weekly.get(d.getUTCDay() as Weekday) ?? [];
  }

  /**
   * Is the business open at this instant? Resolves exceptions first, then the weekly schedule, and correctly
   * handles OVERNIGHT windows — a window that closes at/after midnight is open both late today and early the
   * next day, so we also check the PREVIOUS day's overnight windows for spillover.
   */
  isOpenAt(at: Date): boolean {
    const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
    // 1) today's windows
    for (const w of this.windowsForDate(at)) {
      if (w.closeMin > w.openMin) {
        if (minutes >= w.openMin && minutes < w.closeMin) return true;      // same-day
      } else {
        if (minutes >= w.openMin) return true;                              // overnight: open from openMin to midnight
      }
    }
    // 2) yesterday's overnight spillover into the early hours of today
    const yesterday = new Date(at.getTime());
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    for (const w of this.windowsForDate(yesterday)) {
      if (w.closeMin <= w.openMin && minutes < w.closeMin) return true;     // overnight tail: [0, closeMin)
    }
    return false;
  }

  /**
   * The next instant the business opens at or after {from}. Scans minute-by-minute up to {horizonDays} ahead
   * (default 14); returns null if it never opens in that horizon. If already open, returns {from} itself.
   */
  nextOpenFrom(from: Date, horizonDays = 14): Date | null {
    if (this.isOpenAt(from)) return new Date(from.getTime());
    const start = new Date(from.getTime());
    start.setUTCSeconds(0, 0);
    const limit = start.getTime() + horizonDays * 24 * 60 * 60 * 1000;
    for (let t = start.getTime() + 60000; t <= limit; t += 60000) {
      const d = new Date(t);
      if (this.isOpenAt(d)) return d;
    }
    return null;
  }

  /** The full weekly schedule as plain data (for display). */
  weeklySchedule(): Array<{ weekday: Weekday; windows: Window[] }> {
    const out: Array<{ weekday: Weekday; windows: Window[] }> = [];
    for (let wd = 0 as Weekday; wd <= 6; wd = (wd + 1) as Weekday) {
      const wins = this.weekly.get(wd) ?? [];
      out.push({ weekday: wd, windows: wins.map((w) => ({ open: fmt(w.openMin), close: fmt(w.closeMin) })) });
    }
    return out;
  }
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const availability = new AvailabilityService();
`;

export const AVAILABILITY_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { availability } from './availabilityService';

// REST endpoints for opening hours. Mount with: app.use('/api/availability', availabilityRouter).
export const availabilityRouter = Router();

// The weekly schedule.
availabilityRouter.get('/', (_req: Request, res: Response) => {
  return res.status(200).json({ weekly: availability.weeklySchedule() });
});

// Set a weekday's recurring windows. { weekday, windows:[{open,close}] } (empty windows = closed that day).
availabilityRouter.put('/weekly/:weekday', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { windows?: unknown };
  try {
    const weekday = Number(req.params.weekday);
    const windows = Array.isArray(body.windows) ? (body.windows as Array<{ open: string; close: string }>) : [];
    availability.setWeekly(weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, windows);
    return res.status(200).json({ weekly: availability.weeklySchedule() });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Set a date-specific exception. { date: 'YYYY-MM-DD', windows:[{open,close}] } (empty = closed that date).
availabilityRouter.put('/exceptions', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { date?: unknown; windows?: unknown };
  try {
    const windows = Array.isArray(body.windows) ? (body.windows as Array<{ open: string; close: string }>) : [];
    availability.setException(String(body.date ?? ''), windows);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Is it open at a given time? ?at=<ISO> (defaults to now). Returns { open, at, nextOpen }.
availabilityRouter.get('/open', (req: Request, res: Response) => {
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'at must be an ISO date-time' });
  const open = availability.isOpenAt(at);
  const nextOpen = open ? null : availability.nextOpenFrom(at);
  return res.status(200).json({ open, at: at.toISOString(), nextOpen: nextOpen ? nextOpen.toISOString() : null });
});
`;

const AVAILABILITY_README = `# Availability / opening hours

A real business-hours engine — for a shop, clinic, restaurant, support desk, anything with "are you open right
now?". The core guarantee is **correct open/closed resolution**: weekly recurring windows per weekday, multiple
windows a day, **overnight windows** that cross midnight (close ≤ open ⇒ the window runs into the next day), and
date-specific **exceptions** that override the weekly schedule for one date (closed, or special hours). Files:

- \`availabilityService.ts\` — the domain logic (\`AvailabilityService\` + an \`availability\` singleton).
  Dependency-free, times in minutes-from-midnight. In-memory; swap the Maps for your DB. All times are UTC.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { availabilityRouter } from './server/availability/routes';
app.use('/api/availability', availabilityRouter);
\`\`\`

Endpoints:
- \`GET /api/availability\` → the weekly schedule.
- \`PUT /api/availability/weekly/:weekday\` \`{ windows:[{open,close}] }\` → set a weekday (0=Sun..6=Sat; empty = closed).
- \`PUT /api/availability/exceptions\` \`{ date:'YYYY-MM-DD', windows:[{open,close}] }\` → a date override (empty = closed).
- \`GET /api/availability/open?at=<ISO>\` → \`{ open, at, nextOpen }\` (defaults to now).

An overnight window is written as \`{ open:'22:00', close:'02:00' }\` — it is open from 22:00 until 02:00 the
next day. Distinct from \`generate_booking\` (reserves discrete slots) and \`generate_scheduler\` (runs cron jobs).
`;

export interface AvailabilityConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Availability / opening-hours starter wired under server/availability/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is CORRECT OPEN/CLOSED RESOLUTION: setWeekly(weekday, windows) sets ' +
  'recurring per-weekday windows (multiple allowed; empty = closed); setException(date, windows) overrides one ' +
  'date (empty = closed); isOpenAt(date) resolves exceptions first then the weekly schedule and correctly ' +
  'handles OVERNIGHT windows that cross midnight (close <= open ⇒ spills into the next day, checked via the ' +
  'previous day too); nextOpenFrom(date) finds the next opening. Times are minutes-from-midnight (UTC) so ' +
  'comparisons never drift. routes.ts exposes GET /api/availability, PUT /api/availability/weekly/:weekday ' +
  '({windows}), PUT /api/availability/exceptions ({date, windows}) and GET /api/availability/open (?at=ISO → ' +
  '{open, at, nextOpen}). Mount at app.use("/api/availability", availabilityRouter). Distinct from ' +
  'generate_booking (reserves slots) and generate_scheduler (cron jobs). In-memory by default — swap the Maps for your DB.';

export function generateAvailabilityIntegration(): AvailabilityConfig {
  return {
    files: {
      'server/availability/availabilityService.ts': AVAILABILITY_SERVICE_SOURCE,
      'server/availability/routes.ts': AVAILABILITY_ROUTES_SOURCE,
      'server/availability/README.md': AVAILABILITY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

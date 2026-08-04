// Roadmap breadth — time-tracking / timesheet starter (a packaged domain vertical).
//
// A high-demand vertical for freelancing, agencies, attendance and any billable-hours app. The real feature is
// SESSION INTEGRITY: a user has AT MOST ONE open (running) time entry — clocking in while already clocked in is
// rejected, clocking out with nothing running is rejected, and clocking out computes an exact duration
// (endedAt − startedAt, never negative). Totals per user/project are summed from the closed entries. This emits
// a dependency-free Timesheet + an Express router + a README. Real logic, not a stub — the single-open-session +
// duration rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const TIMESHEET_SERVICE_SOURCE = `// Time-tracking domain logic. The core guarantees: (1) a user has AT MOST ONE open entry — clockIn while an
// entry is running throws, clockOut with nothing running throws, and (2) clockOut computes an exact duration
// (endedAt − startedAt, clamped to >= 0). Totals are summed from CLOSED entries. In-memory here; swap the Map
// for your database, keeping the same method contracts.

export interface TimeEntry {
  id: string;
  user: string;
  project: string;       // '' if not project-scoped
  note: string;
  startedAt: string;
  endedAt: string | null; // null while running
  durationMs: number;     // 0 while running; set on clockOut
}

export class Timesheet {
  private entries = new Map<string, TimeEntry>();
  private seq = 0;

  private forUser(user: string): TimeEntry[] {
    const who = String(user).trim();
    return [...this.entries.values()].filter((e) => e.user === who);
  }

  /** The user's currently-running entry, if any. */
  openEntry(user: string): TimeEntry | undefined {
    return this.forUser(user).find((e) => e.endedAt === null);
  }

  /** Start a timer. Rejected if the user already has a running entry (at most one open). */
  clockIn(user: string, input: { project?: string; note?: string } = {}, now: Date = new Date()): TimeEntry {
    const who = String(user).trim();
    if (!who) throw new Error('user is required');
    if (this.openEntry(who)) throw new Error('user already has a running time entry');
    const entry: TimeEntry = {
      id: String(++this.seq),
      user: who,
      project: String(input?.project ?? '').trim(),
      note: String(input?.note ?? ''),
      startedAt: now.toISOString(),
      endedAt: null,
      durationMs: 0,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Stop the user's running timer. Rejected if nothing is running. Computes the duration. */
  clockOut(user: string, now: Date = new Date()): TimeEntry {
    const who = String(user).trim();
    const open = this.openEntry(who);
    if (!open) throw new Error('no running time entry to clock out');
    open.endedAt = now.toISOString();
    open.durationMs = Math.max(0, new Date(open.endedAt).getTime() - new Date(open.startedAt).getTime());
    return open;
  }

  get(id: string): TimeEntry | undefined {
    return this.entries.get(id);
  }

  /** Add a completed entry directly (manual timesheet edit), computing/validating the duration. */
  addManual(user: string, input: { project?: string; note?: string; startedAt: string; endedAt: string }): TimeEntry {
    const who = String(user).trim();
    if (!who) throw new Error('user is required');
    const start = new Date(input.startedAt).getTime();
    const end = new Date(input.endedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('startedAt and endedAt must be valid dates');
    if (end < start) throw new Error('endedAt cannot be before startedAt');
    const entry: TimeEntry = {
      id: String(++this.seq),
      user: who,
      project: String(input?.project ?? '').trim(),
      note: String(input?.note ?? ''),
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(end).toISOString(),
      durationMs: end - start,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Remove an entry. */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /** A user's entries (optionally filtered by project), newest first. */
  list(user: string, filter: { project?: string } = {}): TimeEntry[] {
    let out = this.forUser(user);
    if (filter.project) out = out.filter((e) => e.project === String(filter.project).trim());
    return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  /** Total tracked milliseconds for a user (CLOSED entries only), optionally scoped to a project. */
  totalMs(user: string, filter: { project?: string } = {}): number {
    return this.list(user, filter)
      .filter((e) => e.endedAt !== null)
      .reduce((sum, e) => sum + e.durationMs, 0);
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const timesheet = new Timesheet();
`;

export const TIMESHEET_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { timesheet } from './timesheetService';

// REST endpoints for the timesheet service. Mount with: app.use('/api', timesheetRouter).
export const timesheetRouter = Router();

// Start a timer. { user, project?, note? } — 409 if the user already has a running entry.
timesheetRouter.post('/time/clock-in', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown; project?: unknown; note?: unknown };
  try {
    return res.status(201).json(timesheet.clockIn(String(body.user ?? ''), { project: String(body.project ?? ''), note: String(body.note ?? '') }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message.includes('already has a running') ? 409 : 400).json({ error: message });
  }
});

// Stop the user's running timer. { user } — 409 if nothing is running.
timesheetRouter.post('/time/clock-out', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown };
  try {
    return res.status(200).json(timesheet.clockOut(String(body.user ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message.includes('no running') ? 409 : 400).json({ error: message });
  }
});

// The user's currently-running entry (or null).
timesheetRouter.get('/time/:user/open', (req: Request, res: Response) => {
  return res.status(200).json(timesheet.openEntry(req.params.user) ?? null);
});

// Add a completed entry manually. { user, project?, note?, startedAt, endedAt }.
timesheetRouter.post('/time/manual', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    return res.status(201).json(timesheet.addManual(String(body.user ?? ''), {
      project: String(body.project ?? ''), note: String(body.note ?? ''),
      startedAt: String(body.startedAt ?? ''), endedAt: String(body.endedAt ?? ''),
    }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A user's entries (?project=) + their total tracked ms.
timesheetRouter.get('/time/:user', (req: Request, res: Response) => {
  const q = req.query as { project?: string };
  return res.status(200).json({
    entries: timesheet.list(req.params.user, { project: q.project }),
    totalMs: timesheet.totalMs(req.params.user, { project: q.project }),
  });
});

// Delete an entry.
timesheetRouter.delete('/time/:id', (req: Request, res: Response) => {
  if (!timesheet.remove(req.params.id)) return res.status(404).json({ error: 'entry not found' });
  return res.status(204).send();
});
`;

const TIMESHEET_README = `# Time tracking / timesheets

A real time-tracking backend. The core guarantees: a user has **at most one open (running) entry** — clocking
in while already clocked in is rejected, clocking out with nothing running is rejected — and clocking out
computes an **exact duration** (\`endedAt − startedAt\`, never negative). Totals sum the **closed** entries. Files:

- \`timesheetService.ts\` — the domain logic (\`Timesheet\` + a \`timesheet\` singleton). In-memory; swap the Map for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { timesheetRouter } from './server/timesheet/routes';
app.use('/api', timesheetRouter);
\`\`\`

Endpoints:
- \`POST /api/time/clock-in\` \`{ user, project?, note? }\` → **409** if the user already has a running entry.
- \`POST /api/time/clock-out\` \`{ user }\` → **409** if nothing is running; returns the entry with its duration.
- \`GET  /api/time/:user/open\` → the running entry or \`null\`.
- \`POST /api/time/manual\` \`{ user, project?, note?, startedAt, endedAt }\` → add a completed entry (endedAt >= startedAt).
- \`GET  /api/time/:user\` (\`?project=\`) → \`{ entries, totalMs }\`.
- \`DELETE /api/time/:id\`.

Take \`user\` from the auth session in production. Multiply \`totalMs\` by your rate for billing (pairs with the coupons / payment recipes).
`;

export interface TimesheetConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Time-tracking / timesheet starter wired under server/timesheet/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is SESSION INTEGRITY: a user has AT MOST ONE open entry — clockIn() throws if one ' +
  'is already running, clockOut() throws if nothing is running, and clockOut() computes an exact duration ' +
  '(endedAt − startedAt, clamped >= 0). addManual() adds a completed entry (rejects endedAt < startedAt); ' +
  'totalMs() sums CLOSED entries (optionally per project). routes.ts exposes POST /time/clock-in (409 if already ' +
  'running), POST /time/clock-out (409 if nothing running), GET /time/:user/open, POST /time/manual, GET ' +
  '/time/:user (?project=, returns entries + totalMs) and DELETE /time/:id. Mount with app.use("/api", ' +
  'timesheetRouter). Take user from the auth session in production. In-memory by default — swap the Map for your DB.';

export function generateTimesheetIntegration(): TimesheetConfig {
  return {
    files: {
      'server/timesheet/timesheetService.ts': TIMESHEET_SERVICE_SOURCE,
      'server/timesheet/routes.ts': TIMESHEET_ROUTES_SOURCE,
      'server/timesheet/README.md': TIMESHEET_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}

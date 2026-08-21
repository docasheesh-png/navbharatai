import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * NO TWO ROUTE MODULES MAY CLAIM THE SAME PATH.
 *
 * Found 2026-08-21 while hunting siblings of the publish rate-limit bug. `GET /api/notifications` was
 * registered TWICE — by `routes/notifications.ts` (the admin's broadcast inbox) and by
 * `routes/teamLibrary.ts` (the per-user @mention inbox) — with INCOMPATIBLE response shapes:
 * `{ notifications, unread }` versus `{ items, unread }`.
 *
 * Express does not warn about this. It matches the FIRST registration and the second becomes
 * unreachable code, so the failure is completely silent on the server. `server.ts` registers
 * notifications before teamLibrary, so the @mention inbox lost — and what shipped was worse than an
 * empty popover: `MentionInbox` read `json.items` (always absent → empty list) while trusting
 * `json.unread` from the admin handler, so the badge showed a number that opened onto nothing.
 * Mentions were being stored correctly the whole time by `/api/team/:teamId/mentions/notify`; no
 * reader could reach them, and "mark all read" wrote into the wrong store.
 *
 * A collision is invisible in review — the two registrations live in different files, and neither
 * looks wrong on its own. So it gets a test rather than a convention.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.includes('.test.')) out.push(full);
  }
  return out;
}

/**
 * A REGISTRATION is a statement — `app.post('/x', …)` at the start of a line. That anchor is what
 * separates real routes from Express code quoted inside documentation and inside the scaffold
 * INSTRUCTIONS strings we hand to generated apps (`app.post("/pay", idempotency(store), …)`), which
 * are prose about Express, not calls to it.
 */
const ROUTE_RE = /^[ \t]*app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gm;

/** Comments first, so an example route inside a `//` or block comment cannot be read as a route. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Only the files that really register routes on the live server. Excluded deliberately:
 * `AgentV3/` and `AppMakerLab/` hold GENERATED-app templates and analyser fixtures — Express code as
 * DATA, never mounted here — so a `GET /` in a scaffold template is not a collision with anything.
 */
function serverRouteFiles(): string[] {
  const files = [join(process.cwd(), 'server.ts')];
  for (const dir of ['src/server/routes', 'src/server/lib']) {
    try { files.push(...walk(join(process.cwd(), dir))); } catch { /* directory may not exist */ }
  }
  return files;
}

function registrations(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of serverRouteFiles()) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of [...src.matchAll(ROUTE_RE)]) {
      // `app.get('name')` is Express's SETTINGS getter, not a route. A real route path starts with '/'.
      if (!m[2].startsWith('/')) continue;
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      const line = src.slice(0, m.index).split('\n').length;
      const where = `${file.replace(process.cwd() + '/', '')}:${line}`;
      map.set(key, [...(map.get(key) ?? []), where]);
    }
  }
  return map;
}

describe('two modules never claim the same route', () => {
  const routes = registrations();

  it('actually parses the server (a guard that matches nothing guards nothing)', () => {
    expect(routes.size).toBeGreaterThan(100);
    expect(routes.has('POST /api/agentv3/publish')).toBe(true);
  });

  it('no method+path is registered more than once outside the SPA catch-all', () => {
    const collisions = [...routes.entries()]
      // `GET *` is the deliberate SPA fallback, registered per-mode in server.ts — the one place where
      // a repeated registration is the design rather than an accident.
      .filter(([key, where]) => where.length > 1 && key !== 'GET *')
      .map(([key, where]) => `${key} → ${where.join(' AND ')}`);
    expect(collisions).toEqual([]);
  });

  it('the two notification inboxes stay on separate paths, each with its own shape', () => {
    // The regression itself: admin broadcasts answer `{ notifications }`, mentions answer `{ items }`.
    // Putting them back on one path silently deletes whichever registers second.
    expect(routes.get('GET /api/notifications')).toHaveLength(1);
    expect(routes.get('GET /api/mentions')).toHaveLength(1);
    expect(routes.get('POST /api/notifications/read')).toHaveLength(1);
    expect(routes.get('POST /api/mentions/read')).toHaveLength(1);

    const inbox = readFileSync(join(process.cwd(), 'src/components/ide/MentionInbox.tsx'), 'utf8');
    expect(inbox).toContain("fetch('/api/mentions'");
    expect(inbox).toContain("'/api/mentions/read'");
    // The client reads `items`, so it must never be pointed at the handler that answers `notifications`.
    expect(inbox).toContain('json.items');
  });
});

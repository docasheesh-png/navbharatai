import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_RATE, WORKSPACE_POLL_RATE, DEPLOY_OPS_RATE, pollBudgetPerHour } from '../src/server/lib/authMiddleware';
import { RUNTIME_LOG_POLL_MS } from '../src/hooks/useRuntimeLogs';
import { APP_SERVICES_POLL_MS } from '../src/hooks/useAppServices';

/**
 * THE RATE-LIMIT CLASS, closed.
 *
 * ADMIN 2026-08-21, with a screenshot of the Publish sheet: "1 publish kiya isi me rate limit. total
 * navbharat ai user = 12 active = 1" — one publish, on a platform with one active user, answered
 * "Rate limit exceeded: max 60 requests per hour."
 *
 * The publish was not the 61st publish. It was the first request after a TIMER had eaten the hour:
 * the App Logs pane polls `/runtime-logs` every 2.5s and `/services` every 6s, both on the bucket
 * that ~54 workspace routes share, so about 35 seconds with that tab open spent the entire hourly
 * budget for the whole workspace surface — publish included.
 *
 * That exact shape has now been fixed five times (zip chunks, terminal keystrokes, domain ops,
 * preview polling, and this). Fixing it a sixth time is not the goal; making it impossible is. The
 * first test below is the one that matters: it reads the CLIENT, finds every endpoint reachable from
 * a `setInterval`, and fails if any of them sits on a bucket meant for user actions. The second holds
 * the arithmetic — a poller's own hourly rate must fit inside its own bucket — so shortening an
 * interval without resizing the budget fails CI instead of failing a user's publish an hour later.
 */

// ── Reading the client: which endpoints does a timer hit? ────────────────────

/** The balanced `(...)` or `{...}` span starting at `start`. Cheap, and enough for this shape. */
function balanced(text: string, start: number, open: string, close: string): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

const API_PATH = /\/api\/[a-zA-Z0-9/_.-]*/g;
/** Bare calls only — `Date.now()` must not resolve to some unrelated `const now` in the file. */
const BARE_CALL = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
const NOT_A_POLLER = new Set(['setInterval', 'if', 'for', 'while', 'switch', 'catch', 'return', 'void', 'typeof', 'await', 'function', 'Number', 'String', 'Boolean']);

/**
 * Endpoints reachable from a `setInterval` in this file: those fetched inside the callback itself,
 * plus those inside a function the callback calls by name (the `setInterval(() => void poll())`
 * shape every polling hook here uses). One level of indirection covers the real code; a poller
 * hidden two hops deep would escape this, which the test says rather than pretends otherwise.
 */
function polledEndpoints(source: string): Set<string> {
  const found = new Set<string>();
  for (const start of [...source.matchAll(/\bsetInterval\s*\(/g)]) {
    const body = balanced(source, start.index! + start[0].length - 1, '(', ')');
    for (const p of body.match(API_PATH) ?? []) found.add(p);
    for (const call of [...body.matchAll(BARE_CALL)]) {
      const name = call[1];
      if (NOT_A_POLLER.has(name)) continue;
      const decl = new RegExp(`(?:const|let|var|function)\\s+${name}\\b`, 'g');
      for (const d of [...source.matchAll(decl)]) {
        const brace = source.indexOf('{', d.index! + d[0].length);
        if (brace < 0) continue;
        for (const p of balanced(source, brace, '{', '}').match(API_PATH) ?? []) found.add(p);
      }
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

const CLIENT_ROOTS = ['src/hooks', 'src/components', 'src/lib', 'src/pages'].filter((d) => {
  try { return statSync(join(process.cwd(), d)).isDirectory(); } catch { return false; }
});

// ── Reading the server: which limiter guards each endpoint? ──────────────────

const ROUTE_RE = /app\.(get|post|put|delete|patch)\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*\(/g;

function limiterByPath(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of walk(join(process.cwd(), 'src/server/routes'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of [...src.matchAll(ROUTE_RE)]) map.set(m[2], m[3]);
  }
  return map;
}

describe('a timer never spends the bucket a button needs', () => {
  const limiters = limiterByPath();

  it('reads the server routes at all (the guard is worthless if this regex stops matching)', () => {
    expect(limiters.get('/api/agentv3/publish')).toBeTruthy();
    expect(limiters.size).toBeGreaterThan(30);
  });

  it('no endpoint a client timer polls is on the shared workspace bucket', () => {
    const offenders: string[] = [];
    for (const root of CLIENT_ROOTS) {
      for (const file of walk(join(process.cwd(), root))) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('setInterval(')) continue;
        for (const path of polledEndpoints(src)) {
          if (limiters.get(path) === 'workspaceRateLimiter') {
            offenders.push(`${file.replace(process.cwd() + '/', '')} polls ${path}`);
          }
        }
      }
    }
    // A poll on this bucket is not a slow leak — it drains an hour of EVERY workspace route,
    // and the user meets it as an unrelated button that stopped working.
    expect(offenders).toEqual([]);
  });

  it('the App Logs pollers are on the poll bucket, by name', () => {
    expect(limiters.get('/api/agentv3/runtime-logs')).toBe('workspacePollRateLimiter');
    expect(limiters.get('/api/agentv3/services')).toBe('workspacePollRateLimiter');
  });

  it('publishing has a budget nothing else can spend', () => {
    expect(limiters.get('/api/agentv3/publish')).toBe('deployOpsRateLimiter');
    expect(limiters.get('/api/agentv3/deploy-backend')).toBe('deployOpsRateLimiter');
  });
});

describe('every bucket is at least as big as the traffic the product itself makes', () => {
  it('the App Logs pane fits inside its own hourly budget', () => {
    // Both pollers are gated on the SAME tab, so a user watching their logs generates both at once.
    const generated = pollBudgetPerHour(RUNTIME_LOG_POLL_MS) + pollBudgetPerHour(APP_SERVICES_POLL_MS);
    expect(generated).toBeLessThanOrEqual(WORKSPACE_POLL_RATE.authed);
    // Headroom for a remount mid-hour (a tab closed and reopened restarts both polls immediately).
    expect(WORKSPACE_POLL_RATE.authed).toBeGreaterThanOrEqual(Math.ceil(generated * 1.25));
  });

  it('the old 60/hr ceiling could not have survived even one minute of that pane', () => {
    // The regression this whole file exists for, stated as arithmetic rather than as a memory.
    const perMinute = (pollBudgetPerHour(RUNTIME_LOG_POLL_MS) + pollBudgetPerHour(APP_SERVICES_POLL_MS)) / 60;
    expect(perMinute).toBeGreaterThan(60 / 60);
    expect(WORKSPACE_RATE.authed).toBeGreaterThan(60);
  });

  it('a poll bucket is in-memory and a deploy bucket is durable — the write cost matches the value', () => {
    // A Firestore write every 2.5 seconds buys nothing; one per publish is worth enforcing across
    // instances, because a publish is a real build and a real deploy.
    expect(WORKSPACE_POLL_RATE.durable).toBe(false);
    expect(DEPLOY_OPS_RATE.durable).not.toBe(false);
  });

  it('anonymous budgets stay below authenticated ones on every bucket touched here', () => {
    for (const r of [WORKSPACE_RATE, WORKSPACE_POLL_RATE, DEPLOY_OPS_RATE]) {
      expect(r.anon).toBeLessThan(r.authed);
      expect(r.anon).toBeGreaterThan(0);
    }
  });
});

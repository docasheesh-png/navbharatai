import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SHELL_INPUT_RATE } from '../src/server/lib/authMiddleware';

/**
 * TERMINAL RATE BUDGET (admin 2026-08-05: "terminal bahut slow hai — rocksolid banao").
 *
 * The zip-chunk lesson, repeated on the shell: `/shell/input` sat on workspaceRateLimiter — 60
 * requests/hour shared with ~44 workspace routes — and a keystroke is one request, so the terminal
 * died 429 after about a minute of typing. A ceiling that makes the advertised feature impossible is
 * fiction, not protection. These tests pin the shell's input and resize to their own honest bucket,
 * so no future route shuffle can quietly put keystrokes back on a 60/hour budget.
 */
const routes = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('shell rate-limit budget', () => {
  it('shell input and resize ride their own generous bucket, never the shared 60/hr one', () => {
    expect(routes).toContain("app.post('/api/agentv3/shell/input', shellInputRateLimiter()");
    expect(routes).toContain("app.post('/api/agentv3/shell/resize', shellInputRateLimiter()");
    expect(routes).not.toContain("app.post('/api/agentv3/shell/input', workspaceRateLimiter()");
    expect(routes).not.toContain("app.post('/api/agentv3/shell/resize', workspaceRateLimiter()");
  });

  it('the budget sustains real typing: at least 2 batched requests per second for an hour', () => {
    expect(SHELL_INPUT_RATE.authed).toBeGreaterThanOrEqual(7200);
    // Anonymous workspaces are a legitimate capability (unguessable sid) — their terminal must type.
    expect(SHELL_INPUT_RATE.anon).toBeGreaterThanOrEqual(1200);
  });

  it('open and close stay on the strict shared bucket — 60 terminals/hour is plenty, keystrokes are not', () => {
    expect(routes).toContain("app.post('/api/agentv3/shell/open', workspaceRateLimiter()");
    expect(routes).toContain("app.post('/api/agentv3/shell/close', workspaceRateLimiter()");
  });

  it('the wake seeds project files in parallel batches, not one round-trip at a time', () => {
    const wake = routes.slice(routes.indexOf('function startTerminalWake'));
    expect(wake.slice(0, 3600)).toContain('Promise.all(entries.slice(i, i + 8)');
  });

  it('the wake-progress poll rides the generous bucket — a 2.5s poll on 60/hr would 429 mid-wake', () => {
    expect(routes).toContain("app.get('/api/agentv3/shell/wake', shellInputRateLimiter()");
  });
});

/**
 * BACKGROUND WAKE WITH POLLABLE PROGRESS (admin 2026-08-06: "start hone me bahut time laga, fir bhi
 * start nahi hua"). The wake ran inline in /shell/open, so a cold sandbox create outlived the
 * client's 90s deadline and a SUCCEEDING wake was reported as failure. The preview watchdog lesson,
 * applied to the wake: judge progress, never the clock.
 */
describe('background terminal wake', () => {
  it('one wake per workspace at a time — but a FINISHED wake never blocks "Try again"', () => {
    const fn = routes.slice(routes.indexOf('function startTerminalWake'), routes.indexOf('function startTerminalWake') + 1200);
    expect(fn).toContain('!existing.finishedAt');
    expect(fn).toContain('WAKE_STALE_MS');
  });

  it('progress is REAL: phase transitions plus a seeded/total counter the user watches', () => {
    const fn = routes.slice(routes.indexOf('function startTerminalWake'));
    for (const m of ["phase = 'seeding'", "phase = 'finishing'", "phase = 'ready'", "phase = 'failed'", 'state.seeded = Math.min(i + 8, entries.length)']) {
      expect(fn.slice(0, 3600)).toContain(m);
    }
  });

  it('a ready-per-record wake with no live session restarts honestly (instance recycle)', () => {
    const open = routes.slice(routes.indexOf("app.post('/api/agentv3/shell/open'"), routes.indexOf("app.get('/api/agentv3/shell/stream'"));
    expect(open).toContain('terminalWakes.delete(workspaceId)');
  });
});

describe('wake state helpers', () => {
  it('wakePublicState exposes only progress fields (+ error when present)', async () => {
    const { wakePublicState } = await import('../src/server/AgentV3/terminalWake');
    expect(wakePublicState({ phase: 'seeding', seeded: 8, total: 40 })).toEqual({ phase: 'seeding', seeded: 8, total: 40 });
    expect(wakePublicState({ phase: 'failed', seeded: 0, total: 0, error: 'x' })).toEqual({ phase: 'failed', seeded: 0, total: 0, error: 'x' });
  });

  it('sanitizeWakeError neutralizes infra branding and bounds the message', async () => {
    const { sanitizeWakeError } = await import('../src/server/AgentV3/terminalWake');
    expect(sanitizeWakeError(new Error('E2B sandbox quota exceeded on E2B'))).toBe('sandbox sandbox quota exceeded on sandbox');
    expect(sanitizeWakeError(new Error('x'.repeat(500))).length).toBe(300);
    expect(sanitizeWakeError(undefined)).toBe('unknown error');
  });
});

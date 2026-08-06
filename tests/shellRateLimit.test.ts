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
    const wake = routes.slice(routes.indexOf('async function wakeWorkspaceForTerminal'));
    expect(wake.slice(0, 3000)).toContain('Promise.all(entries.slice(i, i + 8)');
  });
});

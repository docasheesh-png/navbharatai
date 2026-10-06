// A SLEEPING DATABASE IS SEEN, AND IS WOKEN ONLY BY ITS OWNER'S TAP (admin 2026-10-06).
//
// Supabase pauses a free project after about a week without use. Every one-click database NavBharatAI makes
// is a free project, and nothing read a project's state after the day it was created — so a live app's data
// went dark and nobody was told. The class: "a provider-side state that silently breaks the user's app and
// no code ever reads". These lock the reading (one vocabulary), the telling (once per episode), the fixing
// (the owner's tap, never automatic), and the honest words at every place the user meets the database.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import {
  classifyProjectStatus, getProjectState, restoreProject, projectStateMessage, canWake, stateNeedsOwner,
} from '../src/server/lib/supabaseProjectState';
import { waitUntilReady } from '../src/server/lib/supabaseProvision';
import {
  decidePauseNotice, runSupabasePauseWatch, projectRefsInVault, type PauseNotice,
} from '../src/server/lib/supabasePauseWatch';
import { databaseReadyNarration, type ProvisionSuccess } from '../src/server/lib/supabaseProvisionFlow';
import { NOTIFICATION_ACTIONS } from '../src/server/lib/AdminNotificationStore';
import { USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';
import { isDatabaseHealthList, isWakeAnswer } from '../src/components/settings/SupabaseConnectCard';

const root = join(__dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');

function fakeFetch(queue: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 200, json: {} };
    const status = next.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => next.json, text: async () => next.text ?? '' } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { impl, calls };
}

describe('one reading of Supabase\'s status words', () => {
  it('INACTIVE is asleep, ACTIVE_HEALTHY is ready, and a word we never saw is unknown — never a guess', () => {
    expect(classifyProjectStatus('INACTIVE')).toBe('paused');
    expect(classifyProjectStatus('ACTIVE_HEALTHY')).toBe('ready');
    expect(classifyProjectStatus('RESTORING')).toBe('waking');
    expect(classifyProjectStatus('INIT_FAILED')).toBe('failed');
    expect(classifyProjectStatus('REMOVED')).toBe('removed');
    expect(classifyProjectStatus('SOMETHING_NEW')).toBe('unknown');
    expect(classifyProjectStatus(undefined)).toBe('unknown');
  });

  it('only a paused project can be woken; paused, failed and removed are the ones the owner must hear about', () => {
    expect(canWake('paused')).toBe(true);
    expect(canWake('waking')).toBe(false);
    expect(canWake('failed')).toBe(false);
    expect(['paused', 'failed', 'removed'].every((s) => stateNeedsOwner(s as never))).toBe(true);
    expect(['ready', 'waking', 'busy', 'unhealthy', 'unknown'].some((s) => stateNeedsOwner(s as never))).toBe(false);
  });

  it('🔒 no file reads a status word itself — every reader goes through classifyProjectStatus', () => {
    const offenders = globSync('src/**/*.ts', { cwd: root })
      .filter((f) => !/\.test\.ts$/.test(f) && f !== 'src/server/lib/supabaseProvision.ts')
      .filter((f) => /['"](INACTIVE|ACTIVE_HEALTHY|INIT_FAILED|RESTORE_FAILED)['"]/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('reading a project, and waking it', () => {
  it('reads the state and the name the user sees in Supabase', async () => {
    const f = fakeFetch([{ json: { status: 'INACTIVE', name: 'shop-db' } }]);
    const r = await getProjectState('tok', 'abcdefghijklmnopqrst', f.impl);
    expect(r).toMatchObject({ ok: true, state: 'paused', name: 'shop-db' });
    expect(f.calls[0].url).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst');
  });

  it('a lapsed grant is a failure with the fix in it, never a state', async () => {
    const r = await getProjectState('tok', 'abcdefghijklmnopqrst', fakeFetch([{ status: 401 }]).impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe('unauthorized');
  });

  it('waking POSTs Supabase\'s restore call; the free plan\'s awake-projects limit is named as that', async () => {
    const ok = fakeFetch([{ status: 200 }]);
    expect(await restoreProject('tok', 'abcdefghijklmnopqrst', ok.impl)).toEqual({ ok: true });
    expect(ok.calls[0].url).toMatch(/\/v1\/projects\/abcdefghijklmnopqrst\/restore$/);
    expect(ok.calls[0].init?.method).toBe('POST');
    const full = await restoreProject('tok', 'abcdefghijklmnopqrst', fakeFetch([{ status: 402, text: '{"message":"limit"}' }]).impl);
    expect(full.ok).toBe(false);
    if (!full.ok) { expect(full.failure).toBe('plan-limit'); expect(full.message).toContain('2 active projects'); }
  });

  it('the words: asleep says the data is kept and where to wake it; ready says nothing', () => {
    expect(projectStateMessage('paused', 'shop-db')).toContain('"shop-db" is asleep');
    expect(projectStateMessage('paused')).toContain('Settings → App Settings → Database');
    expect(projectStateMessage('paused')).toContain('data is kept');
    expect(projectStateMessage('ready')).toBe('');
  });

  it('a NEW project that failed to come up is reported at once, not after a 3-minute "still starting"', async () => {
    let slept = 0;
    const r = await waitUntilReady('tok', 'abcdefghijklmnopqrst', { sleep: async () => { slept += 1; } },
      fakeFetch([{ json: { status: 'INIT_FAILED' } }]).impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('failed');
    expect(slept).toBe(0);
  });
});

describe('the daily watch tells the owner once per episode', () => {
  const asleep: PauseNotice = { userId: 'u1', projectRef: 'r', noticedState: 'paused', noticedAt: 1 };

  it('the episode rule', () => {
    expect(decidePauseNotice(null, 'paused')).toMatchObject({ notify: true, noticedState: 'paused', changed: true });
    expect(decidePauseNotice(asleep, 'paused')).toMatchObject({ notify: false, changed: false });
    expect(decidePauseNotice(asleep, 'failed')).toMatchObject({ notify: true, noticedState: 'failed' });
    expect(decidePauseNotice(asleep, 'ready')).toMatchObject({ notify: false, noticedState: null, changed: true });
    expect(decidePauseNotice(asleep, 'waking')).toMatchObject({ notify: false, changed: false });
    expect(decidePauseNotice(null, 'unknown')).toMatchObject({ notify: false, changed: false });
  });

  it('every project the apps are wired to, once each', () => {
    const row = (name: string, value: string, workspaceId: string | null) => ({ name, value, workspaceId, createdAt: 1 });
    const url = 'https://abcdefghijklmnopqrst.supabase.co';
    expect(projectRefsInVault([
      row('VITE_SUPABASE_URL', url, 'w1'), row('VITE_SUPABASE_ANON_KEY', 'k', 'w1'),
      row('VITE_SUPABASE_URL', url, 'w2'), row('VITE_SUPABASE_ANON_KEY', 'k', 'w2'),
    ])).toEqual(['abcdefghijklmnopqrst']);
  });

  function deps(state: string, store: Record<string, PauseNotice>, told: string[], sendOk = true) {
    return {
      accounts: async () => ['u1'],
      rows: async () => [
        { name: 'VITE_SUPABASE_URL', value: 'https://abcdefghijklmnopqrst.supabase.co', workspaceId: 'w1', createdAt: 1 },
        { name: 'VITE_SUPABASE_ANON_KEY', value: 'k', workspaceId: 'w1', createdAt: 1 },
      ],
      token: async () => 'tok',
      state: async () => ({ state: classifyProjectStatus(state), name: 'shop-db' }),
      load: async (u: string, r: string) => store[`${u}_${r}`] ?? null,
      save: async (n: PauseNotice) => { store[`${n.userId}_${n.projectRef}`] = n; },
      notify: async (_u: string, m: string) => { told.push(m); return sendOk; },
      email: async () => false,
      now: () => 5,
      env: {} as NodeJS.ProcessEnv,
    };
  }

  it('asleep → told once; asleep again tomorrow → silent; awake → forgotten; asleep later → told again', async () => {
    const store: Record<string, PauseNotice> = {};
    const told: string[] = [];
    expect((await runSupabasePauseWatch(deps('INACTIVE', store, told))).notified).toBe(1);
    expect((await runSupabasePauseWatch(deps('INACTIVE', store, told))).notified).toBe(0);
    await runSupabasePauseWatch(deps('ACTIVE_HEALTHY', store, told));
    expect((await runSupabasePauseWatch(deps('INACTIVE', store, told))).notified).toBe(1);
    expect(told).toHaveLength(2);
    expect(told[0]).toContain('"shop-db" is asleep');
  });

  it('a notice that failed to SAVE is not remembered — tomorrow repeats it rather than staying silent', async () => {
    const store: Record<string, PauseNotice> = {};
    await runSupabasePauseWatch(deps('INACTIVE', store, [], false));
    expect(store).toEqual({});
  });

  it('a lapsed grant is counted, never guessed; the kill switch stops the whole sweep', async () => {
    const store: Record<string, PauseNotice> = {};
    const lapsed = { ...deps('INACTIVE', store, []), token: async () => null };
    expect(await runSupabasePauseWatch(lapsed)).toMatchObject({ unreadable: 1, notified: 0 });
    const off = { ...deps('INACTIVE', store, []), env: { SUPABASE_PAUSE_WATCH: 'off' } as NodeJS.ProcessEnv };
    expect((await runSupabasePauseWatch(off)).skipped).toBe('disabled');
  });
});

describe('the build says what really happened to the database', () => {
  const base: ProvisionSuccess = {
    ok: true, projectRef: 'r', projectName: 'n', url: 'u', env: {}, schemaApplied: null, serverConnection: 'pooled',
  };

  it('an attached database is never narrated as "created", and an asleep one says so', () => {
    const reused = databaseReadyNarration({ ...base, reused: true }, 'start');
    expect(reused).toContain('no new project was created');
    expect(reused).not.toContain('Database created');
    expect(databaseReadyNarration({ ...base, reused: true, asleepNote: 'Your database is asleep.' }, 'mid-build')).toContain('asleep');
    expect(databaseReadyNarration(base, 'start')).toContain('Database created');
  });
});

describe('the wiring', () => {
  const routes = read('src/server/routes/supabaseIntegration.ts');
  const agentv3 = read('src/server/routes/agentv3.ts');

  it('🔒 nothing wakes a database except the owner\'s Wake button — the only caller of restoreProject is that route', () => {
    const callers = globSync('src/**/*.ts', { cwd: root })
      .filter((f) => !/\.test\.ts$/.test(f) && f !== 'src/server/lib/supabaseProjectState.ts')
      .filter((f) => /\brestoreProject\(/.test(read(f)));
    expect(callers).toEqual(['src/server/routes/supabaseIntegration.ts']);
    const wake = routes.slice(routes.indexOf("app.post('/api/integrations/supabase/wake'"));
    expect(wake.indexOf('verifyFirebaseToken(req)')).toBeGreaterThan(0);
    expect(wake.indexOf('access.refs.includes(projectRef)')).toBeLessThan(wake.indexOf('restoreProject('));
    expect(wake.indexOf('if (!canWake(seen.state))')).toBeLessThan(wake.indexOf('restoreProject('));
  });

  it('Database Studio names a sleeping database instead of passing on Supabase\'s raw error', () => {
    expect(routes).toContain("failure: 'database-asleep'");
    expect(routes).toContain("err.failure === 'database-asleep' ? 409");
  });

  it('a build on a sleeping database says so at the start, and both build narrations use the one wording', () => {
    expect(agentv3).toContain('connectedDatabaseAsleepNote(userId, vaultSecrets.VITE_SUPABASE_URL)');
    expect(agentv3).toContain("code: 'DATABASE_ASLEEP'");
    expect(agentv3).toContain("databaseReadyNarration(made, 'start')");
    expect(agentv3).toContain("databaseReadyNarration(result, 'mid-build')");
    expect(agentv3).not.toContain('✅ Database created in your Supabase account');
  });

  it('the daily watch is registered, exclusive; its notice is tappable into Settings → Database', () => {
    const server = read('server.ts');
    const at = server.indexOf("id: 'supabase-pause-watch'");
    expect(at).toBeGreaterThan(0);
    expect(server.slice(at, at + 120)).toContain('exclusive: true');
    expect(NOTIFICATION_ACTIONS).toContain('open-database');
    const bell = read('src/components/NotificationBell.tsx');
    expect(bell).toContain("n.action === 'open-database'");
    expect(bell).toContain("settingsScreen: 'database'");
  });

  it('the screen checks both answers before they become state', () => {
    expect(isDatabaseHealthList({ connected: true, projects: [{ projectRef: 'r', state: 'paused', name: '', canWake: true, message: 'm' }] })).toBe(true);
    expect(isDatabaseHealthList({ error: 'Please sign in first.' })).toBe(false);
    expect(isWakeAnswer({ ok: true, state: 'waking', message: 'm' })).toBe(true);
    expect(isWakeAnswer({ error: 'no' })).toBe(false);
  });

  it('a deleted account takes its Supabase grant and its notices with it', () => {
    const erased = USER_SCOPED_COLLECTIONS.map((c) => c.collection);
    expect(erased).toContain('supabase_connections');
    expect(erased).toContain('supabase_pause_notices');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isSandboxLocalValue, requiredBackendEnvNames, planBackendEnv, backendEnvNote, DB_PROVIDER_MARKER,
} from '../src/server/AgentV3/backendEnvVars';
import { parseEnvVarKeys, buildCreateServiceRequest } from '../src/server/AgentV3/renderCreateService';
import { managedDeployOutcome } from '../src/lib/backendDeployWiring';

/**
 * THE DEPLOYED BACKEND'S ENVIRONMENT (admin 2026-09-05, found by audit rather than by a report).
 *
 * The PREVIEW app is handed the user's saved keys before it runs. The DEPLOYED service was handed
 * NONE — the create request had no `envVars` field at all. So an app reading DATABASE_URL worked on
 * screen, built on Render, crashed on boot, and our UI said "deployed": the second absolute rule's
 * exact failure mode.
 */
describe('isSandboxLocalValue — a value test, never a name test', () => {
  it('withholds addresses that only resolve inside the sandbox', () => {
    for (const v of [
      'postgres://u:p@localhost:5432/app',
      'postgresql://user:pw@127.0.0.1/db',
      'http://0.0.0.0:3000',
      'redis://host.docker.internal:6379',
      'https://3000-abc123.e2b.app',
      'http://[::1]:8080/api',
    ]) expect(isSandboxLocalValue(v), v).toBe(true);
  });

  it('🔒 a real hosted database keeps its value — refusing by NAME would break the app it protects', () => {
    // The user's own Postgres is also called DATABASE_URL. Withholding it would remove the one
    // credential the app needs most, to prevent a problem this value does not have.
    for (const v of [
      'postgres://u:p@db.abcdefgh.supabase.co:5432/postgres',
      'https://api.stripe.com',
      'postgres://u:p@my-localhost-db.example.com/app',   // "localhost" inside a real hostname
    ]) expect(isSandboxLocalValue(v), v).toBe(false);
  });

  it('🔒 a credential is never an address — a key containing "local" is still a key', () => {
    for (const v of ['sk_live_local_abc123', 'localkey', 'AKIAIOSFODNN7EXAMPLE', '', '   ']) {
      expect(isSandboxLocalValue(v), v).toBe(false);
    }
  });
});

describe('requiredBackendEnvNames — a fallback is not a requirement', () => {
  it('a bare read is required; a defaulted read is not', () => {
    const files = {
      'server.js': "const db = process.env.DATABASE_URL;\nconst port = process.env.PORT || 3000;\nconst n = process.env.WORKERS ?? 4;",
    };
    expect(requiredBackendEnvNames(files)).toEqual(['DATABASE_URL']);
  });

  it('🔒 one undefended read makes it required, even when another site defaults it', () => {
    // The undefended read is the one that breaks; a default elsewhere does not protect it.
    const files = {
      'a.js': "const k = process.env.API_KEY || '';",
      'b.js': 'connect(process.env.API_KEY);',
    };
    expect(requiredBackendEnvNames(files)).toContain('API_KEY');
  });

  it('🔒 host-provided names are never asked of the user', () => {
    // Asking for PORT sends someone hunting for a value they must NOT set.
    const files = { 'server.js': 'app.listen(process.env.PORT);\nif (process.env.NODE_ENV) {}' };
    expect(requiredBackendEnvNames(files)).toEqual([]);
  });

  it('🔒 import.meta.env is NOT a backend requirement — it is inlined at build time', () => {
    // Counting one would report a variable the running server neither needs nor can use.
    const files = { 'src/App.tsx': 'const u = import.meta.env.VITE_API_URL;' };
    expect(requiredBackendEnvNames(files)).toEqual([]);
  });

  it('tests and node_modules are not the app', () => {
    const files = {
      'server.test.js': 'process.env.SECRET_FIXTURE;',
      'node_modules/x/i.js': 'process.env.VENDOR_KEY;',
    };
    expect(requiredBackendEnvNames(files)).toEqual([]);
  });

  it('the bracket form counts too', () => {
    expect(requiredBackendEnvNames({ 'a.js': "process.env['STRIPE_SECRET_KEY']" })).toEqual(['STRIPE_SECRET_KEY']);
  });
});

describe('planBackendEnv — what the service boots with, and the honest gaps', () => {
  const files = { 'server.js': 'connect(process.env.DATABASE_URL); pay(process.env.STRIPE_SECRET_KEY);' };

  it('ships real credentials, withholds sandbox-only ones, and names both outcomes', () => {
    const plan = planBackendEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/app',
      STRIPE_SECRET_KEY: 'sk_live_abc',
    }, files);
    expect(plan.envVars).toEqual([{ key: 'STRIPE_SECRET_KEY', value: 'sk_live_abc' }]);
    expect(plan.sandboxOnly).toEqual(['DATABASE_URL']);
    // Withheld is NOT supplied — it must still be reported as missing, or the user is told nothing.
    expect(plan.missing).toEqual(['DATABASE_URL']);
  });

  it('🔒 the internal database marker never reaches a deployed service', () => {
    // It records WHICH database the user connected; it is not an app secret. The build strips it from
    // the sandbox .env for the same reason.
    const plan = planBackendEnv({ [DB_PROVIDER_MARKER]: 'supabase', REAL_KEY: 'v' }, {});
    expect(plan.envVars.map((e) => e.key)).toEqual(['REAL_KEY']);
  });

  it('an empty vault yields nothing to send and says what is required', () => {
    const plan = planBackendEnv(null, files);
    expect(plan.envVars).toEqual([]);
    expect(plan.missing).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
  });

  it('nothing to say is the ordinary case, and it says nothing', () => {
    const plan = planBackendEnv({ STRIPE_SECRET_KEY: 'sk_live_abc' }, { 'server.js': 'pay(process.env.STRIPE_SECRET_KEY);' });
    expect(plan.missing).toEqual([]);
    expect(plan.sandboxOnly).toEqual([]);
    expect(backendEnvNote(plan)).toBe('');
  });

  it('a name the vault could never hold is skipped rather than sent', () => {
    const plan = planBackendEnv({ 'not-a-name': 'v', GOOD: 'v' } as Record<string, string>, {});
    expect(plan.envVars.map((e) => e.key)).toEqual(['GOOD']);
  });
});

describe('backendEnvNote — honest about what we sent, never a verdict on the app', () => {
  it('🔒 never claims the app will fail — the value may already be set in the host', () => {
    const note = backendEnvNote({ envVars: [], sandboxOnly: [], missing: ['DATABASE_URL'] });
    expect(note).toContain('DATABASE_URL');
    expect(note).toContain('Settings → Secrets & API Keys');
    expect(note.toLowerCase()).not.toContain('will not work');
    expect(note.toLowerCase()).not.toContain('will fail');
  });

  it('a withheld sandbox address explains WHY it could not come along', () => {
    const note = backendEnvNote({ envVars: [], sandboxOnly: ['DATABASE_URL'], missing: [] });
    expect(note).toContain('preview machine');
  });
});

describe('parseEnvVarKeys — names only, and an unreadable answer is not an empty one', () => {
  it('reads both wrapper shapes and ignores junk rows', () => {
    expect(parseEnvVarKeys([{ envVar: { key: 'A', value: 'x' } }, { key: 'B' }, { key: '  ' }, null, 'nope']))
      .toEqual(['A', 'B']);
    expect(parseEnvVarKeys(null)).toEqual([]);
  });
});

describe('🔒 the create request carries the environment', () => {
  const base = {
    ownerId: 'o', name: 'n', repoUrl: 'https://github.com/a/b', branch: 'main',
    commands: { buildCommand: 'npm install', startCommand: 'npm start' },
  };

  it('sends envVars when there are any', () => {
    const body = JSON.parse(buildCreateServiceRequest('k', { ...base, envVars: [{ key: 'A', value: '1' }] }).body!);
    expect(body.envVars).toEqual([{ key: 'A', value: '1' }]);
  });

  it('sends no envVars key at all when there is nothing to send', () => {
    // An empty array is not the same as absent, and Render should be asked to set nothing.
    expect(JSON.parse(buildCreateServiceRequest('k', { ...base, envVars: [] }).body!)).not.toHaveProperty('envVars');
    expect(JSON.parse(buildCreateServiceRequest('k', base).body!)).not.toHaveProperty('envVars');
  });
});

/**
 * 🔴 THE FIELDS THE SERVER SENT AND NOBODY RENDERED (found in the same audit).
 *
 * The deploy route already returned `domainPointed` / `domainNote` — the entire point of the
 * custom-domain work — and the client's outcome parser did not mention them, so every one of those
 * sentences was parsed and discarded. A user whose domain could NOT be pointed saw "Deploy triggered"
 * and nothing else: the silent success that work existed to end, reappearing one layer up.
 */
describe('🔒 managedDeployOutcome surfaces every honest field the route returns', () => {
  const ok = { ok: true, url: 'https://x.onrender.com', serviceName: 'x' };

  it('a pointed domain is told to the user', () => {
    const { lines } = managedDeployOutcome(200, { ...ok, domainPointed: { domain: 'mitrify.com', records: 1 } });
    expect(lines.join(' ')).toContain('mitrify.com');
  });

  it('a domain that could NOT be pointed is told too — that is the whole point', () => {
    const { lines } = managedDeployOutcome(200, { ...ok, domainNote: 'Point mitrify.com at it by adding a CNAME.' });
    expect(lines.join(' ')).toContain('adding a CNAME');
  });

  it('the environment warning travels, and comes LAST', () => {
    // It is about settings, not about whether the deploy happened — leading with it would read as a
    // failure of the thing the user just pressed.
    const { lines } = managedDeployOutcome(200, { ...ok, envNote: 'Your app reads DATABASE_URL.' });
    expect(lines[lines.length - 1]).toContain('DATABASE_URL');
  });

  it('a plain success is unchanged — no empty bullets appear', () => {
    const { lines } = managedDeployOutcome(200, ok);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.trim().length > 2)).toBe(true);
  });
});

describe('🔒 the wiring — the route plans the environment and never overwrites an existing one', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('creation passes the planned environment', () => {
    expect(handler).toContain('planBackendEnv(renderVault');
    expect(handler).toContain('envVars: envPlan.envVars');
  });

  it('🔒 an EXISTING service is only READ — Render replaces the whole set, so writing would delete', () => {
    // Writing our keys into a service the user already runs would remove everything they configured
    // in Render's own dashboard: a destructive fix for a reporting problem.
    expect(handler).toContain('fetchServiceEnvKeys(');
    expect(handler).not.toContain('buildUpdateEnvVarsRequest');
  });

  it('🔒 an unreadable answer is reported as unknown, never as clean', () => {
    expect(handler).toContain('if (have === null)');
    expect(handler).toContain('could not check');
  });

  it('the note reaches the response, or it was never communicated at all', () => {
    expect(handler).toContain('...(envNote ? { envNote } : {})');
  });
});

import { describe, it, expect } from 'vitest';
import { braceBlock } from './helpers/sourceSlice';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * THE USER'S DATABASE, END TO END (admin question 2026-08-06).
 *
 * Two designed options existed on paper — "NavBharatAI provides a database" and "the user brings their
 * own" — and both were broken in the same direction: the user's real database never actually won.
 *
 *   1. A user who connected their own database in Settings got their `DATABASE_URL` injected into the
 *      app's `.env`, and then `ensureSandboxPostgres` merged the sandbox-local
 *      `postgresql://postgres@localhost:5432/myapp` straight over it. Their explicit choice was
 *      discarded silently.
 *   2. The one-tap Supabase database stored ONLY `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` —
 *      values that work only through supabase-js, in a browser. Every server-side app got a real
 *      database in the user's own account that its own code could not connect to, because the password
 *      was generated and thrown away and Supabase never hands it back.
 *   3. The one-tap card was mounted without a `workspaceId`, so the provisioner's schema step was
 *      unreachable and every database was created EMPTY.
 *
 * These are source-level locks on the wiring: the pure logic is unit-tested in postgresProvision,
 * appSecretsEnv and supabaseProvision. What can silently regress is the WIRING between them.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
const route = read('src/server/routes/supabaseIntegration.ts');
const dbSettings = read('src/components/settings/DatabaseSettings.tsx');
const flowSrc = read('src/server/lib/supabaseProvisionFlow.ts');
const settingsPanel = read('src/components/panels/SettingsPanel.tsx');

describe('A connected database is never replaced by the sandbox one', () => {
  it('ensureSandboxPostgres asks whether the app already has the user\'s own DATABASE_URL', () => {
    const at = dispatcher.indexOf('private async ensureSandboxPostgres');
    expect(at).toBeGreaterThan(-1);
    const fn = dispatcher.slice(at, at + 3000);
    expect(fn).toContain('isUserOwnedDatabaseUrl');
    expect(fn).toContain("dotEnvValue(envNow, 'DATABASE_URL')");
  });

  it('the check reads the .env FILE, not just this dispatcher\'s in-memory secrets', () => {
    // Only the composition root calls setUserSecrets; the second dispatcher and every sub-agent share
    // the workspace but not that field. The file is the one source of truth all of them agree on.
    const at = dispatcher.indexOf('private async ensureSandboxPostgres');
    const fn = dispatcher.slice(at, at + 3000);
    const fileRead = fn.indexOf("readFile(this.workspaceId, '.env')");
    const decision = fn.indexOf('isUserOwnedDatabaseUrl');
    expect(fileRead).toBeGreaterThan(-1);
    expect(fileRead).toBeLessThan(decision); // read first, then decide
  });

  it('it returns BEFORE provisioning, and says so instead of going quiet', () => {
    const at = dispatcher.indexOf('isUserOwnedDatabaseUrl(connectedUrl)');
    expect(at).toBeGreaterThan(-1);
    const branch = dispatcher.slice(at, at + 800);
    expect(branch).toContain('Using the database you connected in Settings');
    expect(branch).toContain('return;');
    // The provisioning call must come AFTER this branch, never before it.
    expect(dispatcher.indexOf('sandbox-postgres-provision')).toBeGreaterThan(at);
  });

  it('the app is still locked to Postgres, so nothing downgrades it to SQLite behind the user\'s back', () => {
    const at = dispatcher.indexOf('private async ensureSandboxPostgres');
    const fn = dispatcher.slice(at, at + 3000);
    expect(fn.indexOf('this.postgresIntended = true')).toBeLessThan(fn.indexOf('isUserOwnedDatabaseUrl'));
  });
});

describe('The one-tap database is usable by a SERVER-side app', () => {
  it('the generated password is kept so a connection string can be composed at all', () => {
    expect(flowSrc).toContain('const dbPass = crypto.randomBytes(24).toString(\'base64url\')');
    expect(flowSrc).toContain('dbPass,');
    // The old comment promised the opposite; if it comes back, the feature is broken again.
    expect(flowSrc).not.toContain('never shown or stored by us');
  });

  it('a real DATABASE_URL is saved alongside the browser keys', () => {
    expect(flowSrc).toContain('databaseEnvFor(created.project.id, dbPass, pooler)');
    expect(flowSrc).toContain('fetchPoolerConnection(accessToken, created.project.id)');
  });

  it('the response says which connection the app actually got', () => {
    // `direct` is IPv6-only on new projects, so the client must be able to tell the user honestly
    // rather than letting them discover it as a connection error later.
    expect(flowSrc).toContain("serverConnection: pooler ? 'pooled' : 'direct'");
    expect(route).toContain('serverConnection: result.serverConnection,');
  });
});

describe('The one-tap database is not created empty', () => {
  it('the settings screen passes the workspace through to the card', () => {
    expect(settingsPanel).toContain('<DatabaseSettings userId={user.uid} workspaceId={getAgentV3WorkspaceId(user.uid)} />');
    expect(dbSettings).toContain('<SupabaseConnectCard workspaceId={workspaceId}');
  });
});

describe('KB — the one-tap entry describes what it now really does', () => {
  it('says a backend app gets a Postgres connection string, and that tables are created', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'settings_database_oneclick');
    expect(e).toBeTruthy();
    expect(e!.description).toContain('DATABASE_URL');
    expect(e!.description.toLowerCase()).toContain('not empty');
  });
});

/**
 * ASKING FOR A DATABASE (admin 2026-08-06: "user se puchona chahiye na!").
 *
 * The sandbox's own Postgres is free and instant, so it is tried FIRST and nothing is asked when it
 * works. When it does not, the build used to write a DATABASE_URL pointing at a database that was never
 * running and carry on toward a certain ECONNREFUSED — which is how an app ends up serving
 * "Cannot GET /" with no explanation. Now it offers the real alternative.
 */
const flow = flowSrc;
const agentv3Src = read('src/server/routes/agentv3.ts');

describe('The provision sequence is callable from outside a request handler', () => {
  it('lives in one shared module, and the route is a thin adapter over it', () => {
    expect(flow).toContain('export async function provisionDatabaseForUser');
    expect(route).toContain('const result = await provisionDatabaseForUser(uid, {');
    // The route must no longer own the sequence, or the two copies drift.
    expect(route).not.toContain('await createProject({');
    expect(route).not.toContain('await waitUntilReady(');
  });

  it('the shared sequence keeps every honesty property the route had', () => {
    expect(flow).toContain('await waitUntilReady(');                 // "created" is not "usable"
    expect(flow).toContain('could not save its keys');               // created-but-unrecorded says EXISTS
    expect(flow).toContain('schemaApplied');                         // schema reported separately
    expect(flow).toContain("status: created.failure === 'plan-limit' ? 409 : 502");
  });

  it('it refuses when there is no grant instead of pretending it asked', () => {
    // Consent needs a browser popup; provisioning cannot start one.
    expect(flow).toContain('Connect your Supabase account first');
  });
});

describe('The build asks — but only when it can honour a yes', () => {
  it('the offer is wired only for a user whose Supabase account is already connected', () => {
    expect(agentv3Src).toContain('const connected = await getConnection(userId).catch(() => null);');
    expect(agentv3Src).toContain('if (connected?.orgId) {');
    expect(agentv3Src).toContain('dispatcher.setDatabaseFallback(');
  });

  it('it is a real blocking ask, not a narration', () => {
    const at = agentv3Src.indexOf('dispatcher.setDatabaseFallback(');
    const block = agentv3Src.slice(at, at + 3000);
    expect(block).toContain("type: 'permission_request'");
    expect(block).toContain('await awaitApproval(requestId)');
    // Denial is a real outcome that continues the build, never a silent retry.
    expect(block).toContain('return null;');
  });

  it('it asks at most ONCE per build', () => {
    const at = agentv3Src.indexOf('dispatcher.setDatabaseFallback(');
    const block = agentv3Src.slice(at, at + 3000);
    expect(block).toContain('if (asked) return null;');
  });

  it('the offer names the real cost to the user, not just the benefit', () => {
    const at = agentv3Src.indexOf('dispatcher.setDatabaseFallback(');
    const block = agentv3Src.slice(at, at + 3000);
    expect(block).toContain('2 projects a free Supabase plan allows');
    expect(block).toContain('billing stay yours');
  });

  it('a provisioning failure passes Supabase\'s own words through, never a generic line', () => {
    const at = agentv3Src.indexOf('dispatcher.setDatabaseFallback(');
    const block = agentv3Src.slice(at, at + 3000);
    expect(block).toContain('result.error');
  });
});

describe('An accepted database reaches the build that is still running', () => {
  it('the sandbox database is tried first, and only its FAILURE triggers the ask', () => {
    // The real method body, not a guessed 5000 characters. The fixed window stopped containing
    // rescueDatabase() the moment the method grew, so indexOf returned -1 and the ordering assertion
    // failed while the ordering itself was correct. The explicit `toContain` below now makes a missing
    // call fail as a MISSING CALL rather than as a confusing ordering error. See helpers/sourceSlice.
    const fn = braceBlock(dispatcher, 'private async ensureSandboxPostgres');
    expect(fn).toContain('this.rescueDatabase()');
    expect(fn.indexOf('sandbox-postgres-provision')).toBeLessThan(fn.indexOf('this.rescueDatabase()'));
    expect(fn).toContain("if (prov?.dbVerified === false) {");
  });

  it('the rescue writes the connection into the app\'s .env, because the vault is only read at build start', () => {
    const at = dispatcher.indexOf('private async rescueDatabase');
    expect(at).toBeGreaterThan(-1);
    const fn = dispatcher.slice(at, at + 2000);
    expect(fn).toContain('mergeDotEnv(existing, env)');
    expect(fn).toContain("writeFile(this.workspaceId, '.env', merged)");
    expect(fn).toContain('gitignoreWithEnv'); // real keys must never reach the user's git repo
  });

  it('a rescue with no DATABASE_URL is NOT reported as a rescue', () => {
    const at = dispatcher.indexOf('private async rescueDatabase');
    const fn = dispatcher.slice(at, at + 2000);
    expect(fn).toContain('if (!env || !env.DATABASE_URL) return false;');
  });

  it('the old "will retry it" warning only prints when the rescue did NOT happen', () => {
    const at = dispatcher.indexOf('const rescued = await this.rescueDatabase();');
    expect(at).toBeGreaterThan(-1);
    expect(dispatcher.slice(at, at + 400)).toContain('if (!rescued) {');
  });
});

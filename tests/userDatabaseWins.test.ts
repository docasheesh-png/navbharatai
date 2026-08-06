import { describe, it, expect } from 'vitest';
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
    expect(route).toContain('const dbPass = crypto.randomBytes(24).toString(\'base64url\')');
    expect(route).toContain('dbPass,');
    // The old comment promised the opposite; if it comes back, the feature is broken again.
    expect(route).not.toContain('never shown or stored by us');
  });

  it('a real DATABASE_URL is saved alongside the browser keys', () => {
    expect(route).toContain('databaseEnvFor(created.project.id, dbPass, pooler)');
    expect(route).toContain('fetchPoolerConnection(accessToken, created.project.id)');
  });

  it('the response says which connection the app actually got', () => {
    // `direct` is IPv6-only on new projects, so the client must be able to tell the user honestly
    // rather than letting them discover it as a connection error later.
    expect(route).toContain("serverConnection: pooler ? 'pooled' : 'direct'");
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

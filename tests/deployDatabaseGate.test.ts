import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { appNeedsDatabase, databaseReadiness } from '../src/server/AgentV3/databaseNeed';
import { ALL_DB_ENV_VARS } from '../src/lib/dbProviders';

/**
 * THE ONE DATABASE QUESTION, ASKED AT THE ONE MOMENT IT MATTERS (admin 2026-08-06).
 *
 * Never at preview — a preview database is a throwaway, and asking a user to open a database account
 * before they have even seen their app is friction with nothing behind it. Publishing is the opposite:
 * the sandbox does not come along, so an app that saves data and has no database becomes a LIVE site
 * where every signup, order and booking fails while the page itself loads fine. That is the one moment
 * worth interrupting for, and worth interrupting for exactly once.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('appNeedsDatabase — evidence from the app\'s own files', () => {
  it('a driver in package.json is the strongest signal — nobody installs one by accident', () => {
    expect(appNeedsDatabase({ 'package.json': pkg({ pg: '^8' }) }).needed).toBe(true);
    expect(appNeedsDatabase({ 'package.json': pkg({ mongoose: '^8' }) }).needed).toBe(true);
    expect(appNeedsDatabase({ 'package.json': pkg({ 'drizzle-orm': '^0.3' }) }).needed).toBe(true);
    expect(appNeedsDatabase({ 'package.json': pkg({ '@upstash/redis': '^1' }) }).needed).toBe(true);
  });

  it('a schema or migrations mean there is data to store somewhere', () => {
    expect(appNeedsDatabase({ 'prisma/schema.prisma': 'datasource db {}' }).needed).toBe(true);
    expect(appNeedsDatabase({ 'migrations/001_init.sql': 'CREATE TABLE x();' }).needed).toBe(true);
    expect(appNeedsDatabase({ 'drizzle.config.ts': 'export default {}' }).needed).toBe(true);
  });

  it('falls back to code that reads a database connection', () => {
    expect(appNeedsDatabase({ 'server/db.ts': 'const url = process.env.DATABASE_URL;' }).needed).toBe(true);
    expect(appNeedsDatabase({ 'server/db.ts': 'process.env.TURSO_DATABASE_URL' }).needed).toBe(true);
  });

  it('is conservative in ONE direction — a static site is never interrupted', () => {
    // Being wrong here means nagging someone about a database they do not have; we would rather miss
    // an exotic setup than do that.
    expect(appNeedsDatabase({ 'index.html': '<h1>hi</h1>', 'package.json': pkg({ vite: '^5', react: '^18' }) }).needed).toBe(false);
    expect(appNeedsDatabase({}).needed).toBe(false);
    expect(appNeedsDatabase(null).needed).toBe(false);
  });

  it('a lockfile mentioning a driver is not evidence the APP uses one', () => {
    expect(appNeedsDatabase({ 'package-lock.json': '{"packages":{"node_modules/pg":{}}}' }).needed).toBe(false);
    expect(appNeedsDatabase({ 'node_modules/pg/index.js': 'process.env.DATABASE_URL' }).needed).toBe(false);
  });

  it('a malformed package.json does not throw and does not erase the other signals', () => {
    const r = appNeedsDatabase({ 'package.json': '{ broken', 'prisma/schema.prisma': 'x' });
    expect(r.needed).toBe(true);
    expect(r.signals).toContain('a Prisma schema');
  });

  it('always carries WHY — the user is about to be interrupted about their own app', () => {
    const r = appNeedsDatabase({ 'package.json': pkg({ '@prisma/client': '^5' }) });
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals).toContain('Prisma');
  });
});

describe('databaseReadiness — connected means connected, however they did it', () => {
  const files = { 'package.json': pkg({ pg: '^8' }) };

  it('the explicit provider marker counts', () => {
    const r = databaseReadiness({
      files, vaultSecrets: { ENGINEER_DB_PROVIDER: 'neon' }, dbEnvNames: ALL_DB_ENV_VARS,
      providerLabel: () => 'Neon (Serverless Postgres)', supabaseConnected: false,
    });
    expect(r.needsDatabase).toBe(true);
    expect(r.connected).toBe(true);
    expect(r.provider).toBe('Neon (Serverless Postgres)');
  });

  it('a credential pasted by hand ALSO counts — they never opened the Database screen', () => {
    // Telling a user with a working DATABASE_URL that they have no database would be simply false.
    const r = databaseReadiness({
      files, vaultSecrets: { DATABASE_URL: 'postgresql://u:p@host:5432/db' }, dbEnvNames: ALL_DB_ENV_VARS,
      supabaseConnected: false,
    });
    expect(r.connected).toBe(true);
  });

  it('an empty vault is honestly not connected', () => {
    const r = databaseReadiness({ files, vaultSecrets: {}, dbEnvNames: ALL_DB_ENV_VARS, supabaseConnected: false });
    expect(r.connected).toBe(false);
    expect(r.canProvision).toBe(false); // we cannot create one → do not offer to
  });

  it('canProvision is true only when we could really create one right now', () => {
    // Consent needs a browser popup; an offer we cannot fulfil is worse than none.
    const r = databaseReadiness({ files, vaultSecrets: {}, dbEnvNames: ALL_DB_ENV_VARS, supabaseConnected: true });
    expect(r.canProvision).toBe(true);
  });

  it('a blank-valued secret is not a credential', () => {
    const r = databaseReadiness({ files, vaultSecrets: { DATABASE_URL: '   ' }, dbEnvNames: ALL_DB_ENV_VARS, supabaseConnected: false });
    expect(r.connected).toBe(false);
  });
});

describe('The route answers facts and never acts', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('is owner-gated and read-only', () => {
    const at = route.indexOf("app.get('/api/agentv3/database-readiness'");
    expect(at).toBeGreaterThan(-1);
    const fn = route.slice(at, at + 2000);
    expect(fn).toContain('assertVerifiedWorkspaceOwner(req, workspaceId)');
    expect(fn).toContain('databaseReadiness({');
    // It reports; the acting is the user's next click.
    expect(fn).not.toContain('provisionDatabaseForUser');
  });

  it('a signed-out caller gets an honest "not connected, cannot create" rather than an error', () => {
    const at = route.indexOf("app.get('/api/agentv3/database-readiness'");
    const fn = route.slice(at, at + 2000);
    expect(fn).toMatch(/uid \? await loadUserVaultSecrets\(uid/);
    expect(fn).toContain('supabaseConnected');
    // The readiness answer must be about the SAME app the build is. Read unscoped, this reported a
    // database connected for a DIFFERENT app as ready here, and it was then absent at build time —
    // not merely over-broad, but a wrong answer to the question the screen is asking.
    expect(fn).toMatch(/loadUserVaultSecrets\(uid, workspaceId\)/);
  });
});

describe('The Publish screen asks once, says why, and takes no for an answer', () => {
  const ui = read('src/components/agentv3/HostingChooser.tsx');
  const panel = read('src/components/agentv3/AgentV3Panel.tsx');

  it('the gate only appears when the app really stores data and really has nowhere to put it', () => {
    expect(ui).toContain('dataGate?.needsDatabase && !dataGate.connected');
  });

  it('it says WHY, from the app\'s own signals — not a generic warning', () => {
    expect(ui).toContain('dataGate.signals.join');
    expect(ui).toContain('signups, orders,');
  });

  it('the user can always say no — a wall is not a question', () => {
    expect(ui).toContain('Publish without a database');
    expect(ui).toContain('setProceedAnyway(true)');
    expect(ui).toContain('!proceedAnyway');
  });

  it('"create one" is offered ONLY when we could really do it', () => {
    expect(ui).toContain('dataGate.canProvision && (');
  });

  it('a readiness check that cannot run never blocks a publish', () => {
    // A user whose app is fine must not be stuck behind our own outage.
    expect(ui).toContain('.catch(() => { /* stays null → no gate */ })');
  });

  it('"connect my own" lands on the database FORM, not the settings root', () => {
    expect(panel).toContain("settingsScreen: 'database'");
    const app = read('src/App.tsx');
    expect(app).toContain('if (detail?.settingsScreen) setSettingsScreen(');
  });

  it('a provisioning failure passes the server\'s own words through', () => {
    expect(ui).toContain("data?.error || 'Your database could not be created just now.'");
  });
});

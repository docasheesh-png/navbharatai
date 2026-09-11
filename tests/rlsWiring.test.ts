import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateMigration } from '../src/server/AppMakerLab/generator/MigrationGenerator';
import { auditRlsInSql } from '../src/server/AppMakerLab/generator/RlsPolicy';

/**
 * ⚠️ THE LAYER NAVBHARATAI DID NOT HAVE (audit 2026-09-11, against the admin's own 12-layer diagram).
 *
 * `MigrationGenerator` emitted CREATE TABLE and nothing else. In Postgres that leaves a table readable
 * and writable by every role that can reach it — and a NavBharatAI app on Supabase ships its public key
 * INSIDE the browser bundle of every published copy. So every generated app with a database handed its
 * whole database to every visitor.
 *
 * The risk was not unknown: `supabaseStorageBucket.ts` writes real policies for STORAGE and explains
 * why, and `supabaseProvision.ts` refuses to fetch the service-role key *because* it "bypasses RLS".
 * The security model assumed RLS was on. Nothing turned it on — five searches, by filename and three
 * vocabularies across the whole repo, found no `enable row level security` anywhere.
 *
 * These assertions pin all THREE layers, because any one alone is half a fix: the generator closes the
 * migrations we write, the prompt makes the builder close the ones IT writes (most of them on a real
 * app), and the build audit is the net under both.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('layer 1 — a generated migration closes its own tables', () => {
  const entities = [{ name: 'Todo', fields: [{ name: 'id' }, { name: 'title' }, { name: 'user_id' }] }];

  it('turns RLS on for Postgres by default, with no flag to remember', () => {
    const sql = generateMigration(entities, { dialect: 'sql' }).files[0].content;
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('its own output passes its own audit — generator and net cannot drift apart', () => {
    const sql = generateMigration(entities, { dialect: 'sql', supabase: true }).files[0].content;
    expect(auditRlsInSql(sql, { supabase: true }).findings).toHaveLength(0);
  });

  it('the security block is INSIDE the transaction, so a bad policy rolls the tables back too', () => {
    // Half a migration — tables created, security not applied — is the exact state this prevents.
    const sql = generateMigration(entities, { dialect: 'sql', supabase: true }).files[0].content;
    expect(sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeGreaterThan(sql.indexOf('BEGIN;'));
    expect(sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
  });

  it('writes Supabase policies ONLY for a Supabase app', () => {
    // auth.uid() does not exist on a plain Postgres server: the migration would fail and the app would
    // not start, which is a worse outcome than the one being fixed.
    const plain = generateMigration(entities, { dialect: 'sql' }).files[0].content;
    const supa = generateMigration(entities, { dialect: 'sql', supabase: true }).files[0].content;
    expect(plain).not.toContain('CREATE POLICY');
    expect(supa).toContain('CREATE POLICY');
    expect(plain).toContain('ENABLE ROW LEVEL SECURITY'); // the safe half still applies everywhere
  });

  it('emits no RLS for engines that do not have it', () => {
    for (const provider of ['mysql', 'sqlite'] as const) {
      const sql = generateMigration(entities, { dialect: 'sql', provider }).files[0].content;
      expect(sql).not.toContain('ROW LEVEL SECURITY');
    }
  });
});

describe('layer 2 — the builder is TOLD to close the tables it writes itself', () => {
  const prompt = read('src/server/AgentV3/systemPrompt.ts');

  it('states the rule, not just the risk', () => {
    expect(prompt).toContain('ENABLE ROW LEVEL SECURITY');
    expect(prompt).toContain('auth.uid()');
  });

  it('warns that RLS with no policy shuts the app out', () => {
    // The opposite failure, and the one that looks like a broken app rather than a leak.
    expect(prompt).toContain('RLS with no policy lets NOBODY in');
  });

  it('warns that auth.uid() is Supabase-only, so a plain Postgres app is not broken by it', () => {
    expect(prompt).toContain('exist ONLY on Supabase');
  });

  it('refuses the fake fix — an allow-everyone policy is the hole with extra steps', () => {
    expect(prompt).toContain('the hole with extra steps');
  });
});

describe('layer 3 — every build audits the SQL that actually shipped', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('runs the audit over the workspace SQL and records a finding', () => {
    expect(route).toContain('auditRlsInSql(');
    expect(route).toContain("code: 'DATABASE_RLS'");
  });

  it('an open table is an ERROR, an empty-reading one only a warning', () => {
    // They are different problems: one leaks data, the other shows none. Collapsing them would make
    // the loud one easy to miss among the quiet ones.
    expect(route).toContain("severity: finding.kind === 'no-rls' ? 'error' : 'warning'");
  });

  it('records a CLEAN result too — a check only visible when it complains looks like one that never ran', () => {
    expect(route).toContain('rlsAuditSummary(rls)');
  });

  it('can never fail a build — it is evidence, not a gate', () => {
    const at = route.indexOf('auditRlsInSql(');
    const block = route.slice(route.lastIndexOf('try {', at), at + 1400);
    expect(block).toContain('catch');
    expect(block).toContain('advisory');
  });
});

describe('the Supabase decision is made from evidence, never from a guess', () => {
  const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');

  it('reads the project rather than trusting a model-supplied hint', () => {
    expect(dispatcher).toContain('detectDatabaseProvider(');
    expect(dispatcher).toContain("=== 'Supabase'");
  });

  it('reuses the repo\'s existing detector instead of adding a second answer to one question', () => {
    expect(dispatcher).toContain("from './ImportPreview'");
  });

  it('fails CLOSED — an unreadable project means no policies, but RLS still on', () => {
    const at = dispatcher.indexOf('let supabase = false;');
    expect(at).toBeGreaterThan(-1);
    expect(dispatcher.slice(at, at + 400)).toContain('catch');
  });
});

import { describe, it, expect } from 'vitest';
import {
  ownerColumnFor, planTable, policySqlFor, generateRlsSql, auditRlsInSql, rlsAuditSummary,
} from './RlsPolicy';

describe('ownerColumnFor', () => {
  it('finds the owner column whatever the spelling', () => {
    for (const c of ['user_id', 'userId', 'USER_ID', 'owner_id', 'createdBy', 'author_id', 'uid']) {
      expect(ownerColumnFor(['id', 'title', c])).toBe(c);
    }
  });

  it('returns the column AS WRITTEN, so the policy names the real column', () => {
    // Emitting `user_id` for a column actually called `userId` would create a policy that fails.
    expect(ownerColumnFor(['id', 'userId'])).toBe('userId');
  });

  it('is null when a table has no owner — that is a different access shape, not a failure', () => {
    expect(ownerColumnFor(['id', 'name', 'price'])).toBeNull();
    expect(ownerColumnFor([])).toBeNull();
  });

  it('does not mistake a foreign key to something else for ownership', () => {
    expect(ownerColumnFor(['id', 'product_id', 'order_id'])).toBeNull();
  });
});

describe('planTable', () => {
  it('a table with an owner column is owner-scoped', () => {
    const p = planTable('todos', ['id', 'title', 'user_id']);
    expect(p.access).toBe('owner');
    expect(p.ownerColumn).toBe('user_id');
    expect(p.explanation).toContain('only the signed-in user');
  });

  it('a table without one is public-read, authenticated-write', () => {
    const p = planTable('products', ['id', 'name']);
    expect(p.access).toBe('public-read');
    expect(p.explanation).toContain('anyone can read');
  });
});

describe('policySqlFor', () => {
  it('owner tables get all four operations locked to the owner', () => {
    const sql = policySqlFor(planTable('todos', ['id', 'user_id'])).join('\n');
    for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(sql).toContain(`FOR ${op}`);
    expect(sql).toContain('auth.uid()::text = "user_id"::text');
  });

  it('casts BOTH sides — a uuid-vs-text mismatch would make the policy fail to create', () => {
    // And a table with RLS on and no working policy reads as empty, which looks like a broken app.
    const sql = policySqlFor(planTable('todos', ['id', 'user_id'])).join('\n');
    expect(sql).not.toMatch(/auth\.uid\(\)\s*=/);
    expect(sql).toContain('::text');
  });

  it('is idempotent — every create is preceded by a drop-if-exists', () => {
    // A migration gets re-applied; a second build of the same app must not fail on a duplicate policy.
    const lines = policySqlFor(planTable('todos', ['id', 'user_id']));
    const creates = lines.filter((l) => l.startsWith('CREATE POLICY'));
    const drops = lines.filter((l) => l.startsWith('DROP POLICY IF EXISTS'));
    expect(creates).toHaveLength(4);
    expect(drops).toHaveLength(4);
    lines.forEach((l, i) => { if (l.startsWith('CREATE POLICY')) expect(lines[i - 1]).toContain('DROP POLICY IF EXISTS'); });
  });

  it('public-read keeps reads open and closes writes to signed-in users', () => {
    const sql = policySqlFor(planTable('products', ['id', 'name'])).join('\n');
    expect(sql).toContain('FOR SELECT USING (true)');
    expect(sql).toContain('FOR INSERT TO authenticated');
    expect(sql).toContain('FOR DELETE TO authenticated');
  });
});

describe('generateRlsSql', () => {
  const tables = [{ table: 'todos', columns: ['id', 'title', 'user_id'] }];

  it('always turns RLS ON for Postgres, even with no Supabase policies', () => {
    // This half is safe everywhere: the table OWNER bypasses RLS, so an owner-connected server is
    // unaffected — which is exactly why it can be a default.
    const sql = generateRlsSql(tables, 'postgresql');
    expect(sql).toContain('ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;');
    expect(sql).not.toContain('CREATE POLICY');
    // Nothing EXECUTABLE may name auth.uid() here — the explanation above it may, and does.
    const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--'));
    expect(statements.join('\n')).not.toContain('auth.uid()');
  });

  it('writes the Supabase policies only when told the app really is Supabase', () => {
    // auth.uid() and the `authenticated` role do not exist on a plain Postgres server: emitting them
    // there would fail the migration, which breaks the app — the rule that outranks this one.
    const sql = generateRlsSql(tables, 'postgresql', { supabase: true });
    expect(sql).toContain('auth.uid()::text = "user_id"::text');
    expect(sql).toContain('CREATE POLICY');
  });

  it('says plainly why no policies were written, instead of leaving silence', () => {
    expect(generateRlsSql(tables, 'postgresql')).toContain('not Supabase');
  });

  it('emits NOTHING for engines that have no row level security', () => {
    for (const p of ['mysql', 'sqlite'] as const) {
      expect(generateRlsSql(tables, p, { supabase: true })).toBe('');
    }
  });

  it('emits nothing for no tables rather than a comment pretending work was done', () => {
    expect(generateRlsSql([], 'postgresql')).toBe('');
  });
});

describe('auditRlsInSql — the net over SQL we did not write', () => {
  it('flags a table created and left open', () => {
    const a = auditRlsInSql('CREATE TABLE "todos" (id uuid PRIMARY KEY);');
    expect(a.ok).toBe(false);
    expect(a.findings[0].kind).toBe('no-rls');
    expect(a.findings[0].message).toContain('anyone holding the app');
  });

  it('passes a table that is secured', () => {
    const a = auditRlsInSql(`
      CREATE TABLE "todos" (id uuid PRIMARY KEY);
      ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;
    `);
    expect(a.ok).toBe(true);
    expect(a.findings).toHaveLength(0);
  });

  it('reads unquoted, schema-qualified and IF NOT EXISTS spellings as the same table', () => {
    const a = auditRlsInSql(`
      CREATE TABLE IF NOT EXISTS public.Todos (id uuid);
      ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;
    `);
    expect(a.ok).toBe(true);
  });

  it('never counts a table named only in a COMMENT — that is how a scan lies', () => {
    const a = auditRlsInSql('-- CREATE TABLE "ghost" (id uuid);\nCREATE TABLE "real" (id uuid);\nALTER TABLE "real" ENABLE ROW LEVEL SECURITY;');
    expect(a.tables).toEqual(['real']);
    expect(a.ok).toBe(true);
  });

  it('ignores a table name inside a string literal', () => {
    const a = auditRlsInSql(`INSERT INTO log VALUES ('create table "fake" (x)');\nCREATE TABLE "t" (id uuid);\nALTER TABLE "t" ENABLE ROW LEVEL SECURITY;`);
    expect(a.tables).toEqual(['t']);
  });

  it('on Supabase, RLS with NO policy is reported — the app would read an empty table', () => {
    const a = auditRlsInSql('CREATE TABLE "t" (id uuid); ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;', { supabase: true });
    expect(a.findings.map((f) => f.kind)).toEqual(['no-policy']);
    // Not a security hole, so `ok` stays true — the two must not be collapsed.
    expect(a.ok).toBe(true);
  });

  it('on plain Postgres the same shape is fine — the owner bypasses RLS, so no false alarm', () => {
    const a = auditRlsInSql('CREATE TABLE "t" (id uuid); ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;');
    expect(a.findings).toHaveLength(0);
  });

  it('a policy satisfies the Supabase check', () => {
    const a = auditRlsInSql(`
      CREATE TABLE "t" (id uuid, user_id uuid);
      ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "t_select" ON "t" FOR SELECT USING (auth.uid()::text = "user_id"::text);
    `, { supabase: true });
    expect(a.findings).toHaveLength(0);
  });

  it('its own generated SQL passes its own audit — the two halves cannot drift', () => {
    const ddl = 'CREATE TABLE "todos" (id uuid, user_id uuid);\n'
      + generateRlsSql([{ table: 'todos', columns: ['id', 'user_id'] }], 'postgresql', { supabase: true });
    expect(auditRlsInSql(ddl, { supabase: true }).findings).toHaveLength(0);
  });

  it('empty SQL is "nothing to check", never a silent pass over real tables', () => {
    const a = auditRlsInSql('');
    expect(a.tables).toHaveLength(0);
    expect(rlsAuditSummary(a)).toContain('nothing to secure');
  });
});

describe('rlsAuditSummary', () => {
  it('names the open tables rather than only counting them', () => {
    const a = auditRlsInSql('CREATE TABLE "a" (id uuid); CREATE TABLE "b" (id uuid); ALTER TABLE "b" ENABLE ROW LEVEL SECURITY;');
    expect(rlsAuditSummary(a)).toBe('1 of 2 table(s) are open to anyone with the app\'s public key: a.');
  });

  it('reports a clean result too — a check only visible when it complains looks like one that never ran', () => {
    const a = auditRlsInSql('CREATE TABLE "a" (id uuid); ALTER TABLE "a" ENABLE ROW LEVEL SECURITY;');
    expect(rlsAuditSummary(a)).toBe('All 1 table(s) have row level security on.');
  });
});

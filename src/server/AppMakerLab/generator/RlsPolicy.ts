// Row Level Security for every generated database — the layer NavBharatAI was missing.
//
// ── WHAT WAS WRONG (audit 2026-09-11, against the admin's 12-layer diagram) ─────────────────────
// `MigrationGenerator` emitted `CREATE TABLE` and stopped there. In Postgres, a table created that way
// has RLS **disabled**, and a NavBharatAI app that uses Supabase ships its **anon key inside the
// browser bundle** — so every visitor of every published app held a working credential against tables
// that refused nobody. Read and write, the whole table.
//
// It was not that the risk was unknown. `supabaseStorageBucket.ts` writes real policies for storage
// and says why ("a bucket with no RLS policy accepts…"), and `supabaseProvision.ts` deliberately never
// fetches the service-role key *because* that key "bypasses RLS". **The security model assumed RLS was
// on. Nothing turned it on.** Five searches — by filename and by three vocabularies, across the whole
// repo — found no `enable row level security` anywhere.
//
// ── WHY THIS CANNOT BREAK AN APP, WHICH IS THE WHOLE REASON IT CAN BE A DEFAULT ─────────────────
// 🔒 **In Postgres the table OWNER bypasses RLS** (unless FORCE is also set, which we never emit). The
// two kinds of app divide cleanly on that one fact:
//
//   • **Plain Postgres / Prisma / Neon app** — its server connects as the role that created the tables,
//     i.e. the owner. Enabling RLS changes *nothing at all* for it. Zero risk, and the table is now
//     protected the day someone points a non-owner role at it.
//   • **Supabase app** — tables are owned by `postgres` while the browser holds `anon`, which is NOT the
//     owner. RLS bites exactly where the exposure is, which is why the policies below matter there.
//
// So `ENABLE ROW LEVEL SECURITY` is emitted for every Postgres table unconditionally, and the
// Supabase-flavoured POLICIES are emitted only when the app really is Supabase. That split is not
// tidiness: `auth.uid()` and the `authenticated` role do not exist on a plain Postgres server, so
// emitting them there would fail the migration and break the app — the one rule that outranks this one.
//
// MySQL and SQLite have no RLS at all, so they get nothing rather than a statement that cannot run.

export type RlsProvider = 'postgresql' | 'mysql' | 'sqlite';

/** How a table is reachable once RLS is on. Chosen from the table's own columns — never guessed. */
export type RlsAccess =
  /** A row belongs to one user, and only that user may touch it. The real fix for personal data. */
  | 'owner'
  /** No owner column exists: anyone may READ, only a signed-in user may write. */
  | 'public-read';

/** Column names that mean "the user this row belongs to", in the order they are preferred. */
const OWNER_COLUMNS = ['user_id', 'userid', 'owner_id', 'ownerid', 'created_by', 'createdby', 'author_id', 'authorid', 'uid'];

export interface RlsTablePlan {
  table: string;
  access: RlsAccess;
  /** The column that carries ownership, when `access` is 'owner'. */
  ownerColumn?: string;
  /** One plain sentence for the build report and the migration's own comment. */
  explanation: string;
}

/**
 * The owner column of a table, or null when it has none. Pure, and deliberately NAME-based: the
 * generator has column names and nothing else, and a name is the only evidence available. Matching is
 * case- and underscore-insensitive so `userId`, `user_id` and `USERID` are one column to this rule.
 */
export function ownerColumnFor(columns: readonly string[]): string | null {
  const norm = (s: string) => String(s || '').toLowerCase().replace(/_/g, '');
  for (const wanted of OWNER_COLUMNS) {
    const target = norm(wanted);
    const hit = (columns || []).find((c) => norm(c) === target);
    if (hit) return hit;
  }
  return null;
}

/** Decide one table's access shape from its columns. Pure. */
export function planTable(table: string, columns: readonly string[]): RlsTablePlan {
  const owner = ownerColumnFor(columns);
  if (owner) {
    return {
      table,
      access: 'owner',
      ownerColumn: owner,
      explanation: `only the signed-in user whose id is in "${owner}" can read or change these rows`,
    };
  }
  return {
    table,
    access: 'public-read',
    explanation: 'anyone can read these rows; only a signed-in user can add or change them',
  };
}

const quote = (s: string) => `"${String(s).replace(/"/g, '')}"`;

/**
 * The SQL for ONE table. Idempotent by construction — `drop policy if exists` before every
 * `create policy` — so re-running a migration, or a second build of the same app, is safe. That is the
 * same discipline `supabaseStorageBucket.ts` already uses, and it is what makes this survive the
 * re-apply that a real project does constantly.
 *
 * 🔒 `auth.uid()::text = "col"::text` rather than a bare comparison: `auth.uid()` is a uuid while the
 * generated column may be text, and a type mismatch would make the policy fail to create — which, on a
 * table that now has RLS on, means the app silently reads nothing. Casting both sides always compares.
 */
export function policySqlFor(plan: RlsTablePlan): string[] {
  const t = quote(plan.table);
  const lines: string[] = [];
  const policy = (suffix: string) => quote(`${plan.table}_${suffix}`);
  const replace = (suffix: string, body: string) => {
    lines.push(`DROP POLICY IF EXISTS ${policy(suffix)} ON ${t};`);
    lines.push(`CREATE POLICY ${policy(suffix)} ON ${t} ${body};`);
  };

  if (plan.access === 'owner') {
    const col = quote(plan.ownerColumn as string);
    const mine = `auth.uid()::text = ${col}::text`;
    replace('select', `FOR SELECT USING (${mine})`);
    replace('insert', `FOR INSERT WITH CHECK (${mine})`);
    replace('update', `FOR UPDATE USING (${mine}) WITH CHECK (${mine})`);
    replace('delete', `FOR DELETE USING (${mine})`);
    return lines;
  }

  // public-read: reads stay exactly as open as they are today, so nothing that works stops working.
  // Writes are the half that changes — an anonymous visitor could insert and delete rows before this.
  replace('select', 'FOR SELECT USING (true)');
  replace('insert', 'FOR INSERT TO authenticated WITH CHECK (true)');
  replace('update', 'FOR UPDATE TO authenticated USING (true) WITH CHECK (true)');
  replace('delete', 'FOR DELETE TO authenticated USING (true)');
  return lines;
}

export interface RlsSqlOptions {
  /**
   * Emit the Supabase-flavoured policies (`auth.uid()`, the `authenticated` role).
   *
   * OFF by default, and the default is the safe one: on a plain Postgres server those do not exist and
   * the migration would fail. The caller decides from real evidence — the project depending on
   * `@supabase/supabase-js`, or a connected Supabase project — never from a guess.
   */
  supabase?: boolean;
}

/**
 * The RLS block appended to a generated migration. Returns '' when there is nothing honest to emit
 * (no tables, or an engine with no RLS) rather than a comment pretending work was done.
 */
export function generateRlsSql(
  tables: ReadonlyArray<{ table: string; columns: readonly string[] }>,
  provider: RlsProvider = 'postgresql',
  opts: RlsSqlOptions = {},
): string {
  const list = (tables || []).filter((t) => t && t.table);
  if (list.length === 0) return '';
  // MySQL and SQLite have no row-level security. Emitting anything here would be a statement that
  // cannot run, which is worse than the honest nothing.
  if (provider !== 'postgresql') return '';

  const out: string[] = [
    '-- Row Level Security — every table is closed by default.',
    '--',
    '-- In Postgres a table without RLS is readable and writable by every role that can reach it. An app',
    '-- that talks to its database from the browser hands that reach to every visitor, so RLS is what',
    '-- stands between one user\'s rows and everybody else. The table OWNER still bypasses RLS, so a',
    '-- server that connects as the owner is completely unaffected by this block.',
    '',
  ];

  for (const { table, columns } of list) {
    const plan = planTable(table, columns);
    out.push(`-- ${plan.table}: ${plan.explanation}`);
    out.push(`ALTER TABLE ${quote(plan.table)} ENABLE ROW LEVEL SECURITY;`);
    if (opts.supabase) out.push(...policySqlFor(plan));
    out.push('');
  }

  if (!opts.supabase) {
    out.push(
      '-- No policies were written because this database is not Supabase: `auth.uid()` and the',
      '-- `authenticated` role exist only there, and a policy naming them would fail to apply here.',
      '-- RLS is still ON, which costs an owner-connected server nothing and protects the tables the',
      '-- day any non-owner role is pointed at them.',
      '',
    );
  }
  return out.join('\n');
}

// ── THE NET ─────────────────────────────────────────────────────────────────────────────────────
// Generating correct SQL fixes the migrations WE write. It does nothing about the ones the builder
// writes itself, which is most of them on a real app — so the generator is only half the fix, and the
// half that cannot be relied on alone (the 50/50 law). This reads whatever SQL the workspace actually
// contains and answers one question per table: is it closed?
//
// Deterministic and free: string analysis, no model call, so a clean build pays nothing for it.

/** Strip SQL comments and string literals so a table named in a comment is never counted as real. */
function stripNoise(sql: string): string {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // /* block */
    .replace(/--[^\n]*/g, ' ')            // -- line
    .replace(/'(?:[^']|'')*'/g, "''");   // 'literals', doubled-quote escapes included
}

/** Normalise a table name: drop quotes, a schema prefix, and case. `"public"."Todos"` → `todos`. */
function tableKey(raw: string): string {
  const last = String(raw || '').split('.').pop() ?? '';
  return last.replace(/["`\[\]]/g, '').trim().toLowerCase();
}

const IDENT = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

export interface RlsAuditFinding {
  table: string;
  /** 'no-rls' — created and left open. 'no-policy' — closed with no way in (reads return nothing). */
  kind: 'no-rls' | 'no-policy';
  message: string;
}

export interface RlsAudit {
  /** Every table the SQL creates. */
  tables: string[];
  /** Tables with `enable row level security`. */
  secured: string[];
  /** Tables carrying at least one policy. */
  withPolicy: string[];
  findings: RlsAuditFinding[];
  /** True when every created table is secured. Says nothing about tables this SQL never mentions. */
  ok: boolean;
}

/**
 * Audit the RLS posture of a body of SQL.
 *
 * `supabase` matters for the SECOND finding only. On Supabase, RLS on with no policy means the browser
 * reads an empty table — a broken-looking app, and worth saying out loud. On a plain Postgres server the
 * owner bypasses RLS, so the same shape is completely fine and reporting it would be a false alarm.
 */
export function auditRlsInSql(sql: string, opts: { supabase?: boolean } = {}): RlsAudit {
  const text = stripNoise(sql);
  const created = new Map<string, string>();   // key → the name as written
  const secured = new Set<string>();
  const withPolicy = new Set<string>();

  const createRe = new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})`, 'gi');
  for (const m of text.matchAll(createRe)) {
    const key = tableKey(m[1]);
    // A table created inside another schema (auth.*, storage.*) is not this app's to secure.
    if (key && !created.has(key)) created.set(key, key);
  }
  const rlsRe = new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})[\\s\\S]{0,80}?enable\\s+row\\s+level\\s+security`, 'gi');
  for (const m of text.matchAll(rlsRe)) secured.add(tableKey(m[1]));

  const policyRe = new RegExp(`\\bcreate\\s+policy\\b[\\s\\S]{0,200}?\\bon\\s+(${QUALIFIED})`, 'gi');
  for (const m of text.matchAll(policyRe)) withPolicy.add(tableKey(m[1]));

  const findings: RlsAuditFinding[] = [];
  for (const key of created.keys()) {
    if (!secured.has(key)) {
      findings.push({
        table: key,
        kind: 'no-rls',
        message: `"${key}" has no row level security, so anyone holding the app's public key can read and change every row in it. Add: ALTER TABLE "${key}" ENABLE ROW LEVEL SECURITY;`,
      });
    } else if (opts.supabase && !withPolicy.has(key)) {
      findings.push({
        table: key,
        kind: 'no-policy',
        message: `"${key}" has row level security on but no policy, so the app will read nothing from it. Add a policy saying who may see these rows.`,
      });
    }
  }

  return {
    tables: [...created.keys()],
    secured: [...secured],
    withPolicy: [...withPolicy],
    findings,
    // NO TABLES IS NOT A PASS AND NOT A FAILURE — it is "nothing to check", which `ok` reports as true
    // because there is no open table. The caller distinguishes the two by reading `tables.length`.
    ok: findings.every((f) => f.kind !== 'no-rls'),
  };
}

/** One honest sentence for the build report. Never claims a check ran over tables it never saw. */
export function rlsAuditSummary(audit: RlsAudit): string {
  if (audit.tables.length === 0) return 'No SQL tables found in this app — nothing to secure.';
  const open = audit.findings.filter((f) => f.kind === 'no-rls').map((f) => f.table);
  if (open.length === 0) {
    return `All ${audit.tables.length} table(s) have row level security on.`;
  }
  return `${open.length} of ${audit.tables.length} table(s) are open to anyone with the app's public key: ${open.join(', ')}.`;
}

/**
 * Running the user's OWN SQL, safely (ROADMAP #1 Phase 2.4).
 *
 * A query runner is the feature most likely to become an accidental "delete everything" button, so
 * the read-only guarantee here is NOT a keyword check. Keyword checks lose:
 *
 *     WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone
 *
 * That starts with `WITH`, passes any "must begin with SELECT" test, and empties a table.
 *
 * So read-only is enforced STRUCTURALLY, by Postgres, in two layers:
 *
 *   1. ONE STATEMENT. `splitStatements` is a real tokenizer — it understands single quotes, doubled
 *      quotes, dollar-quoting, identifiers and both comment forms — so a `;` hidden inside a string
 *      or a `--` comment cannot smuggle a second statement past it. More than one statement is
 *      refused outright.
 *
 *   2. WRAPPED AS A SUBQUERY. The statement is executed as `select * from ( … ) as q limit N`.
 *      Postgres does not allow INSERT/UPDATE/DELETE in that position at all, and a data-modifying CTE
 *      raises "WITH clause containing a data-modifying statement must be at the top level". The
 *      database refuses the write; we never had to recognise it.
 *
 * Writing SQL is still possible — deliberately, because a data GUI that cannot run a migration is
 * half a tool — but only on the explicit write path, which the UI gates behind its own confirmation.
 */

/** Rows a runner will return. Bounded so one careless `select *` cannot pull a whole table. */
export const QUERY_ROW_CAP = 500;

/**
 * Split SQL into statements, ignoring separators inside strings, comments and quoted identifiers.
 *
 * Written as a scanner rather than a split on `;` because every interesting bypass lives exactly in
 * the cases a naive split gets wrong: `'a;b'`, `--x;`, `/* ; *\/`, `$$ ; $$`, `"od;d"`.
 */
export function splitStatements(sql: string): string[] {
  const text = String(sql ?? '');
  const out: string[] = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    // Line comment — everything to end of line, separators included, is not code.
    if (ch === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      current += text.slice(i, stop);
      i = stop;
      continue;
    }
    // Block comment. Postgres nests these, so track depth rather than finding the first close.
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; continue; }
        if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      current += text.slice(i, j);
      i = j;
      continue;
    }
    // Dollar-quoted body: $$…$$ or $tag$…$tag$. Everything inside is literal text.
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (tag) {
        const marker = tag[0];
        const close = text.indexOf(marker, i + marker.length);
        const stop = close === -1 ? text.length : close + marker.length;
        current += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    // String literal. A doubled quote is an escaped quote, not the end.
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") { j++; break; }
        j++;
      }
      current += text.slice(i, j);
      i = j;
      continue;
    }
    // Quoted identifier — same doubling rule.
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      current += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ';') {
      out.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  out.push(current);
  // A trailing `;` is normal punctuation, not an empty second statement.
  return out.map((s) => s.trim()).filter((s) => s.length > 0 && !isOnlyComments(s));
}

/** Is this fragment nothing but comments and whitespace? Then it is not a statement. */
export function isOnlyComments(fragment: string): boolean {
  const stripped = String(fragment ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  return stripped.length === 0;
}

export interface SqlRefusal { ok: false; message: string }

/**
 * The read-only form of the user's query.
 *
 * Returns the statement wrapped so Postgres itself refuses any write, or a refusal explaining why —
 * and the explanation is specific, because "invalid query" teaches nobody anything.
 */
export function readOnlyQuery(sql: string, rowCap: number = QUERY_ROW_CAP): { ok: true; sql: string } | SqlRefusal {
  const statements = splitStatements(sql);
  if (statements.length === 0) return { ok: false, message: 'Write a query first.' };
  if (statements.length > 1) {
    return { ok: false, message: `Run one statement at a time — NavBharatAI found ${statements.length}.` };
  }
  const one = statements[0];
  // The wrapper is the guarantee: Postgres rejects a write in this position, and rejects a
  // data-modifying CTE that is not at the top level. We never have to recognise a write ourselves.
  return { ok: true, sql: `select * from (\n${one}\n) as nbai_q limit ${Math.max(1, Math.floor(rowCap))}` };
}

/**
 * The write form — the statement as the user wrote it, still one statement.
 *
 * Deliberately NOT wrapped: an UPDATE is not a subquery. The single-statement rule stays, because a
 * confirmed "update one table" must not carry a second, unreviewed statement along with it — the
 * user confirmed what they read, and they only read the first one.
 */
export function writeQuery(sql: string): { ok: true; sql: string } | SqlRefusal {
  const statements = splitStatements(sql);
  if (statements.length === 0) return { ok: false, message: 'Write a query first.' };
  if (statements.length > 1) {
    return { ok: false, message: `Run one statement at a time — NavBharatAI found ${statements.length}. You confirmed the first one; the rest were never shown to you.` };
  }
  return { ok: true, sql: statements[0] };
}

/**
 * A short, plain description of what a statement will do — for the confirmation prompt.
 *
 * This is presentation only and is NEVER a security control: the guarantee is the wrapper above, so
 * a misread verb here changes the wording of a prompt, not what the database permits.
 */
export function describeStatement(sql: string): string {
  const head = String(sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .slice(0, 40)
    .toLowerCase();
  if (/^insert\b/.test(head)) return 'add rows to';
  if (/^update\b/.test(head)) return 'change rows in';
  if (/^delete\b/.test(head)) return 'delete rows from';
  if (/^drop\b/.test(head)) return 'permanently remove part of';
  if (/^truncate\b/.test(head)) return 'empty a table in';
  if (/^alter\b/.test(head)) return 'change the structure of';
  if (/^create\b/.test(head)) return 'add something to';
  return 'change';
}

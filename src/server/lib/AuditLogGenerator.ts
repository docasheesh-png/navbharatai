// U-4 (verified recipe modules) — tamper-evident audit log (dependency-free, hash-chained, node:crypto).
//
// Any serious app — money, orders, admin actions, user-data changes — needs an audit trail: WHO did WHAT,
// WHEN. Two things are always gotten wrong. (1) A plain log table is silently editable: an insider (or an
// attacker with DB access) can delete or rewrite a row and nobody can tell. The fix is a HASH CHAIN — each
// entry stores the hash of the previous entry, so altering or removing any past entry breaks every hash after
// it, and a single verify pass detects it. (2) Ad-hoc audit rows drift in shape, so you can never actually
// query "everything user X did". The fix is one typed append() + a verify().
// This recipe ships an AuditLog you back with your own store (a callback pair): append(entry) computes the
// chained hash and persists it; verifyChain(entries) returns the first index where the chain is broken (or -1
// if intact). Dependency-free (node:crypto), no env keys, storage-agnostic (works with Postgres, Mongo, a
// file, anything). PURE builder; correct and complete — no TODO stubs. Unit-tested.

export interface AuditLogConfig {
  files: Record<string, string>;
  instructions: string;
}

const AUDIT_SERVER = `import crypto from 'node:crypto';

// One audit entry. \`prevHash\`/\`hash\` form the tamper-evident chain; you provide \`actor\`, \`action\`, and
// optional \`target\`/\`meta\`. \`seq\` and \`at\` are assigned on append.
export interface AuditEntry {
  seq: number;
  at: string;          // ISO timestamp
  actor: string;       // who (user id / email / 'system')
  action: string;      // what (e.g. 'order.refund', 'user.role.change')
  target?: string;     // the thing acted on (e.g. an order id)
  meta?: Record<string, unknown>;
  prevHash: string;    // hash of the previous entry ('' for the first)
  hash: string;        // hash of THIS entry incl. prevHash — the chain link
}

// Deterministic hash of an entry's content + the previous hash. Stable key order so the same content always
// hashes the same (JSON key order can vary otherwise).
function hashEntry(e: Omit<AuditEntry, 'hash'>): string {
  const canonical = JSON.stringify({
    seq: e.seq, at: e.at, actor: e.actor, action: e.action,
    target: e.target ?? null, meta: e.meta ?? null, prevHash: e.prevHash,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface AuditStore {
  // Return the most recently appended entry (or null if the log is empty) — used to chain onto it.
  last(): Promise<AuditEntry | null> | AuditEntry | null;
  // Persist a fully-formed entry.
  save(entry: AuditEntry): Promise<void> | void;
}

/**
 * Append a tamper-evident audit entry. The new entry's \`prevHash\` is the previous entry's \`hash\`, and its own
 * \`hash\` covers its content + that prevHash — so rewriting or deleting any past entry breaks the chain from
 * that point on. Back it with any store (DB table, collection, file). Returns the persisted entry.
 */
export async function appendAudit(
  store: AuditStore,
  input: { actor: string; action: string; target?: string; meta?: Record<string, unknown> },
): Promise<AuditEntry> {
  if (!input.actor) throw new Error('audit: actor is required (who performed the action)');
  if (!input.action) throw new Error('audit: action is required (what was done)');
  const prev = await store.last();
  const base: Omit<AuditEntry, 'hash'> = {
    seq: prev ? prev.seq + 1 : 0,
    at: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    target: input.target,
    meta: input.meta,
    prevHash: prev ? prev.hash : '',
  };
  const entry: AuditEntry = { ...base, hash: hashEntry(base) };
  await store.save(entry);
  return entry;
}

/**
 * Verify an ordered list of audit entries (oldest first). Returns the seq of the FIRST tampered/broken entry,
 * or -1 if the whole chain is intact. A broken link means that entry (or one before it) was altered or a
 * predecessor was deleted. Run this on a schedule or before trusting the trail.
 */
export function verifyAuditChain(entries: AuditEntry[]): number {
  let prevHash = '';
  for (const e of entries) {
    const expected = hashEntry({
      seq: e.seq, at: e.at, actor: e.actor, action: e.action,
      target: e.target, meta: e.meta, prevHash: e.prevHash,
    });
    if (e.prevHash !== prevHash || e.hash !== expected) return e.seq;
    prevHash = e.hash;
  }
  return -1;
}
`;

const AUDIT_TEST = `import { describe, it, expect } from 'vitest';
import { appendAudit, verifyAuditChain, type AuditEntry, type AuditStore } from './audit';

function memStore(): AuditStore & { rows: AuditEntry[] } {
  const rows: AuditEntry[] = [];
  return {
    rows,
    last: () => (rows.length ? rows[rows.length - 1] : null),
    save: (e) => { rows.push(e); },
  };
}

describe('audit', () => {
  it('chains entries: each prevHash is the previous entry hash, and the chain verifies', async () => {
    const s = memStore();
    await appendAudit(s, { actor: 'admin@x', action: 'user.create', target: 'u1' });
    await appendAudit(s, { actor: 'admin@x', action: 'order.refund', target: 'o9', meta: { amount: 500 } });
    await appendAudit(s, { actor: 'system', action: 'job.run' });
    expect(s.rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(s.rows[0].prevHash).toBe('');
    expect(s.rows[1].prevHash).toBe(s.rows[0].hash);
    expect(s.rows[2].prevHash).toBe(s.rows[1].hash);
    expect(verifyAuditChain(s.rows)).toBe(-1);
  });

  it('detects tampering: editing a past entry breaks the chain at that entry', async () => {
    const s = memStore();
    await appendAudit(s, { actor: 'admin@x', action: 'user.create', target: 'u1' });
    await appendAudit(s, { actor: 'admin@x', action: 'order.refund', target: 'o9', meta: { amount: 500 } });
    // an insider quietly changes the refund amount
    s.rows[1].meta = { amount: 5 };
    expect(verifyAuditChain(s.rows)).toBe(1);
  });

  it('detects deletion: removing a middle entry breaks the chain', async () => {
    const s = memStore();
    await appendAudit(s, { actor: 'a', action: 'x' });
    await appendAudit(s, { actor: 'a', action: 'y' });
    await appendAudit(s, { actor: 'a', action: 'z' });
    const tampered = [s.rows[0], s.rows[2]]; // entry 1 deleted
    expect(verifyAuditChain(tampered)).toBe(s.rows[2].seq);
  });

  it('requires actor and action', async () => {
    const s = memStore();
    await expect(appendAudit(s, { actor: '', action: 'x' })).rejects.toThrow(/actor/);
    await expect(appendAudit(s, { actor: 'a', action: '' })).rejects.toThrow(/action/);
  });
});
`;

const INSTRUCTIONS =
  'Tamper-evident audit log wired at server/lib/audit.ts (no dependency — node:crypto). Record every ' +
  "sensitive action with await appendAudit(store, { actor: userId, action: 'order.refund', target: orderId, " +
  'meta: { amount } }). Each entry stores the SHA-256 hash of the previous entry, so if anyone later edits or ' +
  'deletes a past row the chain breaks — call verifyAuditChain(entries) (oldest first) to get the seq of the ' +
  'first tampered entry, or -1 if the trail is intact. You supply a tiny store { last(), save(entry) } backed ' +
  'by your DB (Postgres/Mongo/a table) — the recipe is storage-agnostic. Use it for admin actions, money ' +
  'movements, role changes and data edits. No API key needed.';

export function generateAuditLogIntegration(): AuditLogConfig {
  return {
    files: {
      'server/lib/audit.ts': AUDIT_SERVER,
      'server/lib/audit.test.ts': AUDIT_TEST,
    },
    instructions: INSTRUCTIONS,
  };
}

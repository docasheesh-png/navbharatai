// CHANGE ENGINE — one record per change to an app, and the document that holds the app's whole memory.
//
// WHY (Change Intelligence Engine, slice 1, 2026-10-04). The Time Machine keeps every version's FILES and
// a commit message; the checkpoint store keeps a git sha. Neither says what kind of change it was, which
// requirements it touched, what the checks found, or whether it ended well — so "what happened to this
// app over the last ten edits?" had no answer short of reading ten build reports by hand.
//
// A ChangeRecord is that answer, linking request → classification → requirements → files → verification:
//
//   CHG-0007 · cross-cutting/deep · touched REQ-002, REQ-005 · 6 files · gate YELLOW · REQ-003 regressed
//
// It deliberately stores CODES and ids, not prose, with one exception (`summary`, a redacted ≤160-char
// digest of the user's request) — see the security note in engineeringMemoryStore.ts.
//
// PURE.

import type { ChangeKind, ChangeRisk, ChangeDepth } from './changeClassifier';
import { parseAppSpec, type AppSpec } from './appSpec';
import { parseIssueQueue, type IssueQueue } from './issueQueue';

export type ChangeStatus = 'completed' | 'partial' | 'failed' | 'stopped';

export interface ChangeRecord {
  /** Stable id: CHG-0001. */
  id: string;
  ts: number;
  /** Redacted digest of the request, ≤ 160 chars. */
  summary: string;
  kind: ChangeKind;
  risk: ChangeRisk;
  depth: ChangeDepth;
  /** REQ ids this change asked for, verified, or regressed. */
  requirements: string[];
  /** ISS ids opened, fixed or verified by this change. */
  issues: string[];
  /** Paths written, ≤ 40. */
  files: string[];
  status: ChangeStatus;
  /** Release-gate state, when the build reached it. */
  gate?: 'green' | 'yellow' | 'red' | 'unknown';
  /** Requirements that were working before this change and are not after it. */
  regressed: string[];
}

export interface EngineeringMemory {
  version: 1;
  spec: AppSpec;
  queue: IssueQueue;
  changes: ChangeRecord[];
  nextChg: number;
  updatedAt: number;
}

export const MAX_CHANGES = 60;

export function chgId(n: number): string {
  return `CHG-${String(n).padStart(4, '0')}`;
}

export function emptyMemory(): EngineeringMemory {
  return { version: 1, spec: { items: [], nextReq: 1 }, queue: { issues: [], nextIss: 1 }, changes: [], nextChg: 1, updatedAt: 0 };
}

const KINDS = new Set<ChangeKind>(['micro-ui', 'local', 'feature', 'bug', 'refactor', 'cross-cutting', 'data', 'integration', 'security', 'architectural', 'large']);

function strArr(v: unknown, cap: number): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, cap) : [];
}

export function parseEngineeringMemory(raw: unknown): EngineeringMemory {
  if (!raw || typeof raw !== 'object') return emptyMemory();
  const r = raw as Record<string, unknown>;
  const changes: ChangeRecord[] = [];
  for (const x of Array.isArray(r.changes) ? r.changes : []) {
    if (!x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    if (typeof c.id !== 'string' || !KINDS.has(c.kind as ChangeKind)) continue;
    changes.push({
      id: c.id, ts: Number(c.ts) || 0, summary: typeof c.summary === 'string' ? c.summary.slice(0, 160) : '',
      kind: c.kind as ChangeKind,
      risk: c.risk === 'low' || c.risk === 'high' ? c.risk : 'medium',
      depth: c.depth === 'light' || c.depth === 'deep' ? c.depth : 'standard',
      requirements: strArr(c.requirements, 40), issues: strArr(c.issues, 40), files: strArr(c.files, 40),
      status: c.status === 'completed' || c.status === 'failed' || c.status === 'stopped' ? c.status : 'partial',
      ...(c.gate === 'green' || c.gate === 'yellow' || c.gate === 'red' || c.gate === 'unknown' ? { gate: c.gate } : {}),
      regressed: strArr(c.regressed, 40),
    });
  }
  const maxSeen = changes.reduce((m, c) => Math.max(m, Number(c.id.replace(/^CHG-/, '')) || 0), 0);
  const nextChg = typeof r.nextChg === 'number' && r.nextChg > maxSeen ? Math.floor(r.nextChg) : maxSeen + 1;
  return {
    version: 1,
    spec: parseAppSpec(r.spec),
    queue: parseIssueQueue(r.queue),
    changes: changes.slice(-MAX_CHANGES),
    nextChg,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

/** Append a change record (bounded). Pure. */
export function appendChange(mem: EngineeringMemory, record: Omit<ChangeRecord, 'id'>, id: string): EngineeringMemory {
  return { ...mem, changes: [...mem.changes, { ...record, id }].slice(-MAX_CHANGES) };
}

/** One admin-report line for a change. */
export function describeChange(c: ChangeRecord): string {
  const parts = [`${c.id} ${c.kind}/${c.depth}`, `${c.files.length} file(s)`, `status ${c.status}`];
  if (c.gate) parts.push(`gate ${c.gate.toUpperCase()}`);
  if (c.requirements.length) parts.push(`requirements ${c.requirements.join(', ')}`);
  if (c.regressed.length) parts.push(`REGRESSED ${c.regressed.join(', ')}`);
  if (c.issues.length) parts.push(`issues ${c.issues.join(', ')}`);
  return parts.join(' · ');
}

import { describe, it, expect, beforeEach } from 'vitest';
import { trimReportForStorage, compactReportForRecord, saveDiagnostics, loadDiagnostics, saveDiagnosticsHistory, upsertDiagnosticsHistoryProgress, listDiagnosticsHistory, getDiagnosticsHistoryItem, saveLatestForUser, loadLatestForUser, perUserDiagnosticsDocId, persistWithRetry, emergencyStash, emergencyRecall, emergencyClearForTest, redactReportSecrets } from './DiagnosticsStore';
import type { BuildDiagnosticsReport } from './BuildDiagnostics';

function baseReport(over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1000,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    problems: [],
    ...over,
  };
}

describe('trimReportForStorage', () => {
  it('keeps a small report intact and stays well under the 1 MB Firestore limit', () => {
    const r = baseReport({
      issues: [{ ts: 1, phase: 'build', severity: 'error', code: 'X', message: 'boom', autoResolved: false }],
      commands: [{ ts: 1, command: 'npm i', exitCode: 0, stdout: 'ok', stderr: '' }],
    });
    const trimmed = trimReportForStorage(r);
    expect(trimmed.issues).toHaveLength(1);
    expect(trimmed.commands).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(trimmed), 'utf8')).toBeLessThan(900 * 1024);
  });

  it('caps a huge report to fit Firestore — keeps the NEWEST detail, trims heavy channels', () => {
    const bigIssues = Array.from({ length: 2000 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: 'info' as const, code: 'STEP', message: `step ${i} ${'x'.repeat(300)}`, autoResolved: true }));
    const bigCmds = Array.from({ length: 300 }, (_, i) => ({ ts: i, command: `cmd ${i}`, exitCode: 0, stdout: 'y'.repeat(4000), stderr: 'z'.repeat(4000) }));
    const bigLlm = Array.from({ length: 300 }, (_, i) => ({ ts: i, ok: true, promptPreview: 'p'.repeat(2000), responsePreview: 'r'.repeat(2000) }));
    const trimmed = trimReportForStorage(baseReport({ issues: bigIssues, commands: bigCmds, llmCalls: bigLlm }));
    expect(trimmed.issues!.length).toBeLessThanOrEqual(500);
    expect(trimmed.commands!.length).toBeLessThanOrEqual(40);
    expect(trimmed.llmCalls!.length).toBeLessThanOrEqual(40);
    // newest items are retained (issues end at step 1999)
    expect(trimmed.issues![trimmed.issues!.length - 1].message).toContain('step 1999');
    // heavy strings shrunk + total fits the doc limit
    expect(trimmed.commands![0].stdout.length).toBeLessThan(1600);
    expect(Buffer.byteLength(JSON.stringify(trimmed), 'utf8')).toBeLessThan(900 * 1024);
  });

  it('leaves the offending generatedFiles channel untouched (it is the bug evidence)', () => {
    const r = baseReport({ generatedFiles: [{ ts: 1, path: 'src/App.tsx', content: 'const x = 1;', note: 'referenced by a compile error' }] });
    expect(trimReportForStorage(r).generatedFiles).toEqual(r.generatedFiles);
  });

  it('RECOMPUTES problems from the trimmed issues, not a pass-through of the original problems field — a problem entry that fell out of the trimmed issues window is not left dangling in problems', () => {
    // 501 old info-only issues, then ONE old error that gets trimmed away by the -500 slice, then a
    // fresh error that survives. If `problems` were a naive pass-through of the ORIGINAL report.problems
    // (computed before trimming), it would still list the now-vanished old error.
    const oldNoise = Array.from({ length: 500 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: 'info' as const, code: 'STEP', message: `step ${i}`, autoResolved: true }));
    const oldError = { ts: 500, phase: 'build' as const, severity: 'error' as const, code: 'OLD_ERR', message: 'old error that will be trimmed', autoResolved: false };
    const freshError = { ts: 501, phase: 'build' as const, severity: 'error' as const, code: 'NEW_ERR', message: 'fresh error that survives', autoResolved: false };
    const issues = [oldError, ...oldNoise, freshError]; // oldError sits OUTSIDE the last-500 window
    const r = baseReport({ issues, problems: [oldError, freshError] }); // original (pre-trim) problems
    const trimmed = trimReportForStorage(r);
    expect(trimmed.issues!.some((i) => i.code === 'OLD_ERR')).toBe(false); // trimmed out of issues
    expect(trimmed.problems!.some((i) => i.code === 'OLD_ERR')).toBe(false); // must ALSO be gone from problems
    expect(trimmed.problems!.some((i) => i.code === 'NEW_ERR')).toBe(true); // the surviving one is kept
  });

  it('bounds problems to MAX_PROBLEMS even when the trimmed issues contain more real problems than that', () => {
    const manyErrors = Array.from({ length: 400 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: 'error' as const, code: 'E', message: `error ${i}`, autoResolved: false }));
    const trimmed = trimReportForStorage(baseReport({ issues: manyErrors, problems: manyErrors }));
    expect(trimmed.problems!.length).toBeLessThanOrEqual(300);
    // keeps the NEWEST (highest-index) errors, same "keep the tail" policy as issues/commands/llmCalls.
    expect(trimmed.problems![trimmed.problems!.length - 1].message).toContain('error 399');
  });
});

// The compact report EMBEDDED in the durable conversation record (admin, 2026-07-05: "build report
// hamesa ke liye wahin save honi chahiye jahan chat text save hota hai"). Keeps the user-facing
// essentials, DROPS the heavy forensic channels, and stays small enough to ride in the conversation doc.
describe('compactReportForRecord — the report saved WITH the chat (reopen never 404s)', () => {
  it('keeps the user-facing essentials (readiness/root-cause/summary/counts/problems)', () => {
    const r = baseReport({
      endedAt: 2000, ok: false, summary: 'Built with 1 blocker', rootCause: 'unresolved import ./Missing',
      counts: { total: 3, errors: 1, warnings: 1, autoResolved: 1, unresolved: 1 },
      issues: [{ ts: 1, phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: '1 unresolved import(s) — the build will fail', autoResolved: false }],
      problems: [{ ts: 1, phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: '1 unresolved import(s) — the build will fail', autoResolved: false }],
    });
    const c = compactReportForRecord(r);
    expect(c.ok).toBe(false);
    expect(c.summary).toBe('Built with 1 blocker');
    expect(c.rootCause).toContain('unresolved import');
    expect(c.counts).toEqual(r.counts);
    expect(c.problems.some((p) => p.code === 'READINESS_BLOCKER')).toBe(true);
    expect(c.schema).toBe('navbharatai.v3.build-diagnostics/1');
  });

  it('DROPS the heavy forensic channels (commands / llmCalls / errors / generatedFiles) — they stay in the workspace doc', () => {
    const r = baseReport({
      commands: [{ ts: 1, command: 'npm i', exitCode: 0, stdout: 'x'.repeat(5000), stderr: '' }],
      llmCalls: [{ ts: 1, ok: true, promptPreview: 'p'.repeat(5000), responsePreview: 'r'.repeat(5000) }],
      errors: [{ ts: 1, message: 'e'.repeat(5000), stack: 's'.repeat(5000) }],
      generatedFiles: [{ ts: 1, path: 'src/App.tsx', content: 'z'.repeat(6000), note: 'compile error' }],
    });
    const c = compactReportForRecord(r);
    expect(c.commands).toBeUndefined();
    expect(c.llmCalls).toBeUndefined();
    expect(c.errors).toBeUndefined();
    expect(c.generatedFiles).toBeUndefined();
  });

  it('bounds the issues tail and recomputes problems from the trimmed issues (stays small in the conversation doc)', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: (i % 3 === 0 ? 'error' : 'info') as 'error' | 'info', code: 'E', message: `line ${i} ${'y'.repeat(500)}`, autoResolved: i % 3 !== 0 }));
    const c = compactReportForRecord(baseReport({ issues: many, problems: many.filter((i) => i.severity === 'error') }));
    expect(c.issues.length).toBeLessThanOrEqual(120);           // bounded tail
    expect(c.issues[c.issues.length - 1].message).toContain('line 999'); // newest kept
    expect(c.issues[0].message.length).toBeLessThan(500);       // per-line message capped
    expect(c.problems.every((p) => p.severity !== 'info')).toBe(true);   // problems = non-info only
    // Small enough to embed in the conversation record alongside the chat.
    expect(Buffer.byteLength(JSON.stringify(c), 'utf8')).toBeLessThan(120 * 1024);
  });

  it('a huge report compacts to a fraction of its trimReportForStorage size (the whole point of embedding)', () => {
    const bigCmds = Array.from({ length: 300 }, (_, i) => ({ ts: i, command: `cmd ${i}`, exitCode: 0, stdout: 'y'.repeat(4000), stderr: 'z'.repeat(4000) }));
    const bigLlm = Array.from({ length: 300 }, (_, i) => ({ ts: i, ok: true, promptPreview: 'p'.repeat(2000), responsePreview: 'r'.repeat(2000) }));
    const big = baseReport({ endedAt: 2000, commands: bigCmds, llmCalls: bigLlm });
    const compactBytes = Buffer.byteLength(JSON.stringify(compactReportForRecord(big)), 'utf8');
    const storageBytes = Buffer.byteLength(JSON.stringify(trimReportForStorage(big)), 'utf8');
    expect(compactBytes).toBeLessThan(storageBytes); // the embedded copy is materially lighter
  });
});

// P-REPORT.4 — history. Firestore is unreachable under VITEST (VITEST-skip, same contract as
// saveDiagnostics/loadDiagnostics above) — these confirm the best-effort, never-throws contract
// rather than real persistence (that is verified against real Firestore, like FirestoreConversationStore).
describe('saveDiagnosticsHistory / listDiagnosticsHistory / getDiagnosticsHistoryItem (VITEST-skip, best-effort)', () => {
  it('saveDiagnosticsHistory never throws, even for a settled report, with no reachable Firestore', async () => {
    const settled = baseReport({ endedAt: 2000, ok: true });
    await expect(saveDiagnosticsHistory('ws-1', settled)).resolves.toBeUndefined();
  });

  it('saveDiagnosticsHistory is a no-op for a report that has not settled yet (endedAt unset)', async () => {
    const unsettled = baseReport(); // no endedAt
    await expect(saveDiagnosticsHistory('ws-1', unsettled)).resolves.toBeUndefined();
  });

  it('listDiagnosticsHistory resolves to [] (never throws) when Firestore is unreachable', async () => {
    await expect(listDiagnosticsHistory('ws-1')).resolves.toEqual([]);
  });

  it('getDiagnosticsHistoryItem resolves to null (never throws) when Firestore is unreachable', async () => {
    await expect(getDiagnosticsHistoryItem('ws-1', '2000')).resolves.toBeNull();
  });

  // CrewHub 2026-07-20 ("puri build report save nahi ho rahi"): unlike saveDiagnosticsHistory, the
  // progress upsert must ACCEPT an in-progress report (endedAt unset) so a turn that never settles still
  // lands in the whole-session download. Both never throw under the VITEST/no-Firestore contract.
  it('upsertDiagnosticsHistoryProgress never throws for an IN-PROGRESS report (endedAt unset) — the whole point', async () => {
    const inProgress = baseReport(); // no endedAt — a turn still running
    await expect(upsertDiagnosticsHistoryProgress('ws-1', inProgress)).resolves.toBeUndefined();
  });
  it('upsertDiagnosticsHistoryProgress never throws for a settled report or bad input', async () => {
    await expect(upsertDiagnosticsHistoryProgress('ws-1', baseReport({ endedAt: 2000, ok: true }))).resolves.toBeUndefined();
    // @ts-expect-error — invalid input must be swallowed, never thrown
    await expect(upsertDiagnosticsHistoryProgress('', null)).resolves.toBeUndefined();
  });
});

// P-REPORT.5 — durable per-USER "latest report" (the "Build report gayab na ho" fix). Same VITEST-skip
// best-effort contract: Firestore is unreachable under VITEST, so these confirm never-throws + safe
// nulls (real persistence is verified against real Firestore, like the workspace/history paths above).
describe('saveLatestForUser / loadLatestForUser (VITEST-skip, best-effort)', () => {
  it('saveLatestForUser never throws with no reachable Firestore', async () => {
    await expect(saveLatestForUser('user-1', baseReport({ endedAt: 2000, ok: true }))).resolves.toBeUndefined();
  });

  it('saveLatestForUser tolerates a null userId (no shared "anon" bucket) without throwing', async () => {
    await expect(saveLatestForUser(null, baseReport({ endedAt: 2000 }))).resolves.toBeUndefined();
  });

  it('loadLatestForUser resolves to null (never throws) when Firestore is unreachable', async () => {
    await expect(loadLatestForUser('user-1')).resolves.toBeNull();
    await expect(loadLatestForUser(null)).resolves.toBeNull();
  });
});

// ── NEVER-LOSE-THE-REPORT layer (admin 2026-07-07: "build report gayab nahi honi chahiye chahe
// kuch bhi ho"). The old class: every save swallowed its failure (`catch {}`) — a Firestore write
// error lost the report with no log, no retry, no trace. These tests lock the three replacement
// layers: bounded retry, loud observable failure, and the in-memory emergency fallback the loaders
// consult when the durable read is empty.
describe('persistWithRetry — transient persistence failures self-heal, final failures are reported', () => {
  it('succeeds first try without sleeping', async () => {
    let slept = 0;
    const r = await persistWithRetry(async () => {}, { delaysMs: [1, 1], sleep: async () => { slept++; } });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    expect(slept).toBe(0);
  });
  it('THE CLASS FIX: a write that fails twice then succeeds is retried to success (was: lost silently)', async () => {
    let calls = 0;
    const r = await persistWithRetry(async () => { calls++; if (calls < 3) throw new Error('UNAVAILABLE'); }, { delaysMs: [1, 1], sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, attempts: 3 });
  });
  it('exhausted retries return ok:false WITH the real error (never swallowed)', async () => {
    const boom = new Error('quota exceeded');
    const r = await persistWithRetry(async () => { throw boom; }, { delaysMs: [1], sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(boom);
    expect(r.attempts).toBe(2);
  });
});

describe('emergency cache — the report survives even a total Firestore outage', () => {
  beforeEach(() => emergencyClearForTest());
  const rep = (id: string) => baseReport({ sessionId: id, endedAt: 2000 });

  it('stash → recall roundtrip, per kind, no cross-kind bleed', () => {
    emergencyStash('workspace', 'ws-1', rep('a'));
    expect(emergencyRecall('workspace', 'ws-1')?.sessionId).toBe('a');
    expect(emergencyRecall('user', 'ws-1')).toBeNull();
    expect(emergencyRecall('workspace', 'ws-other')).toBeNull();
  });
  it('bounded LRU: the 11th entry evicts the OLDEST, refreshed entries survive', () => {
    for (let i = 1; i <= 10; i++) emergencyStash('workspace', `ws-${i}`, rep(String(i)));
    emergencyStash('workspace', 'ws-1', rep('1-refreshed')); // refresh → ws-2 is now oldest
    emergencyStash('workspace', 'ws-11', rep('11'));
    expect(emergencyRecall('workspace', 'ws-2')).toBeNull();               // evicted
    expect(emergencyRecall('workspace', 'ws-1')?.sessionId).toBe('1-refreshed'); // survived
    expect(emergencyRecall('workspace', 'ws-11')?.sessionId).toBe('11');
  });
  it('empty keys are inert', () => {
    emergencyStash('workspace', '', rep('x'));
    expect(emergencyRecall('workspace', '')).toBeNull();
  });
});

describe('loaders fall back to the emergency cache when the durable read is empty', () => {
  beforeEach(() => emergencyClearForTest());

  it('loadDiagnostics serves the emergency copy (Firestore unreachable here, exactly like an outage)', async () => {
    await expect(loadDiagnostics('ws-em')).resolves.toBeNull();
    emergencyStash('workspace', 'ws-em', baseReport({ sessionId: 'em', endedAt: 2000 }));
    await expect(loadDiagnostics('ws-em')).resolves.toMatchObject({ sessionId: 'em' });
  });
  it('loadLatestForUser serves the emergency copy — but NEVER for a null user (privacy unchanged)', async () => {
    emergencyStash('user', 'user-em', baseReport({ sessionId: 'uem', endedAt: 2000 }));
    await expect(loadLatestForUser('user-em')).resolves.toMatchObject({ sessionId: 'uem' });
    await expect(loadLatestForUser(null)).resolves.toBeNull();
  });
  it('locks the VITEST save contract: saves are no-ops (no Firestore, no stash) so loads stay null', async () => {
    await saveDiagnostics('ws-noop', baseReport({ endedAt: 2000 }));
    await saveLatestForUser('user-noop', baseReport({ endedAt: 2000 }));
    await expect(loadDiagnostics('ws-noop')).resolves.toBeNull();
    await expect(loadLatestForUser('user-noop')).resolves.toBeNull();
  });
});

// SECURITY Phase 2.1 — a build report must never carry a secret. A build's stdout/stderr, model
// I/O previews, error stacks, generated-file bodies and the prompt/summary can inline an API key,
// a TOKEN= env line, a JWT or a DB URL with a password. redactReportSecrets masks them in EVERY
// channel; trimReportForStorage (all durable saves) and compactReportForRecord (the embedded copy)
// both run it, so no persisted or downloaded report can leak.
describe('redactReportSecrets — every free-text channel is scrubbed of secrets', () => {
  // Fake secrets are assembled from fragments at RUNTIME so no complete secret literal ever sits in
  // this source file (which would trip GitHub push-protection / secret scanners). redactSecrets sees
  // the fully-joined string at runtime exactly as a real leak would appear.
  const S = {
    openai: 'sk-' + 'abcdef1234567890abcdefghijklmnop',
    pgpw: 'super' + 'secretpw',
    aws: 'wJalr' + 'XUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ghpIssue: 'ghp_' + '0123456789abcdef0123456789abcdef0123',
    apiKeyCmd: 'sk-' + 'secretvalue0000000000000000000000000000',
    ghpStdout: 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789',
    proj: 'sk-proj-' + 'aaaaaaaaaaaaaaaaaaaaaaaa',
    pw: 'hunter2' + 'secretlongvalue',
    secretKey: 'top' + 'secretvalue12345678',
    dbpw: 'pw' + '123456',
    stripe: 'sk_' + 'live_' + '51abcdefghijklmnopqrstuvwx',
  };
  const dirty = baseReport({
    endedAt: 2000,
    prompt: `use OPENAI_API_KEY=${S.openai} for the app`,
    summary: `built ok; connected to postgres://user:${S.pgpw}@db.host:5432/app`,
    rootCause: `AWS_SECRET_ACCESS_KEY=${S.aws} leaked in logs`,
    issues: [{ ts: 1, phase: 'build', severity: 'error', code: 'X', message: `token TOKEN=${S.ghpIssue}`, autoResolved: false }],
    commands: [{ ts: 1, command: `export API_KEY=${S.apiKeyCmd}`, exitCode: 0, stdout: `GITHUB_TOKEN=${S.ghpStdout}`, stderr: '' }],
    llmCalls: [{ ts: 1, ok: true, promptPreview: `here is my key ${S.proj}`, responsePreview: `stored PASSWORD="${S.pw}"` }],
    errors: [{ ts: 1, message: `auth failed with SECRET_KEY=${S.secretKey}`, stack: `at db://admin:${S.dbpw}@host/x` }],
    generatedFiles: [{ ts: 1, path: '.env', content: `STRIPE_SECRET_KEY=${S.stripe}`, note: 'env' }],
  });

  it('masks the secret in prompt / summary / rootCause / issues / commands / llmCalls / errors / generatedFiles', () => {
    const clean = redactReportSecrets(dirty);
    const blob = JSON.stringify(clean);
    // None of the raw secret values survive anywhere in the report.
    for (const secret of Object.values(S)) {
      expect(blob).not.toContain(secret);
    }
  });

  it('is a no-op for a clean report (high precision — ordinary code is untouched)', () => {
    const clean = baseReport({ endedAt: 2000, summary: 'built a todo app with 12 files', commands: [{ ts: 1, command: 'npm run build', exitCode: 0, stdout: 'compiled ok', stderr: '' }] });
    expect(redactReportSecrets(clean).summary).toBe('built a todo app with 12 files');
    expect(redactReportSecrets(clean).commands![0].stdout).toBe('compiled ok');
  });

  it('the SAVE choke points redact too: trimReportForStorage + compactReportForRecord emit no raw secret', () => {
    const stored = JSON.stringify(trimReportForStorage(dirty));
    const embedded = JSON.stringify(compactReportForRecord(dirty));
    expect(stored).not.toContain(S.pgpw);
    expect(stored).not.toContain(S.ghpStdout);
    expect(embedded).not.toContain(S.pgpw); // summary is kept in the compact copy, redacted
  });
});

describe('perUserDiagnosticsDocId — no cross-user "anon" bucket (privacy)', () => {
  it('returns null for a null/empty/whitespace user so anonymous reports are never shared', () => {
    expect(perUserDiagnosticsDocId(null)).toBeNull();
    expect(perUserDiagnosticsDocId(undefined)).toBeNull();
    expect(perUserDiagnosticsDocId('')).toBeNull();
    expect(perUserDiagnosticsDocId('   ')).toBeNull();
  });
  it('returns the real user id (trimmed) for a signed-in user', () => {
    expect(perUserDiagnosticsDocId('user-1')).toBe('user-1');
    expect(perUserDiagnosticsDocId('  user-2  ')).toBe('user-2');
  });
  it('never collapses different anonymous callers onto one shared id', () => {
    // The bug: `userId || 'anon'` gave every anon caller the SAME doc → one anon read another's
    // generated source/errors. A null id now yields null (skip the per-user store entirely).
    expect(perUserDiagnosticsDocId(null)).not.toBe('anon');
  });
});

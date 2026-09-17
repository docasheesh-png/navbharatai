/**
 * 🔴 ADMIN MONITOR CAPTURE, 2026-09-17 — a warning repeated ~15 times over two days, and the one
 * thing that would have ended it was truncated out of every single row.
 *
 * Every `DIAGNOSTICS_READ_FAILED` line in the Server-logs panel read:
 *
 *     error: 9 FAILED_PRECONDITION: The query requires an index. You can create it here:
 *     https://console.firebase.google.com/v1/r/project/gen-lang-client-.../firestore/indexes?create_composite=Clpwcm9qZWN0…
 *
 * …and stopped there, mid-token. Firestore answers a missing-index error with a link that CREATES the
 * index: the whole remedy is one click, and the click was never recorded. TWO independent
 * `slice(0, 300)` calls destroyed it — the store's, writing `meta.error`, and `persistedAuditEntry`'s,
 * building the row's message. Either one alone would have been enough to lose it.
 *
 * The budget for ordinary text is unchanged. Only a URL straddling the cut is carried to its end.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  truncateForAudit, persistedAuditEntry, AUDIT_TEXT_MAX, AUDIT_TEXT_HARD_MAX,
} from '../src/server/lib/audit';

/** The real shape of the error, with an index token the length Firestore actually emits. */
const INDEX_URL =
  'https://console.firebase.google.com/v1/r/project/gen-lang-client-0866594388/firestore/indexes'
  + `?create_composite=${'Clpwcm9qZWN0cy9nZW4tbGFuZy1jbGllbnQtMDg2NjU5NDM4OC9kYXRhYmFzZXMvKGRlZmF1bHQpL2Nv'.repeat(4)}`;
const FIRESTORE_ERROR = `9 FAILED_PRECONDITION: The query requires an index. You can create it here: ${INDEX_URL}`;

describe('truncateForAudit — the link survives, everything else is bounded as before', () => {
  it('🔴 the capture\'s own error keeps its whole index URL', () => {
    expect(FIRESTORE_ERROR.length).toBeGreaterThan(AUDIT_TEXT_MAX); // or this case proves nothing
    const kept = truncateForAudit(FIRESTORE_ERROR);
    expect(kept).toContain(INDEX_URL);
    // REVERSION GUARD: the old behaviour, which ended inside the base64 token.
    expect(kept).not.toBe(FIRESTORE_ERROR.slice(0, AUDIT_TEXT_MAX));
  });

  it('text with no URL is cut at the budget, exactly as before', () => {
    const stack = 'x'.repeat(1000);
    expect(truncateForAudit(stack)).toHaveLength(AUDIT_TEXT_MAX);
  });

  it('short text is returned untouched', () => {
    expect(truncateForAudit('Firestore unavailable (init failed)')).toBe('Firestore unavailable (init failed)');
    expect(truncateForAudit('')).toBe('');
  });

  it('a URL that ENDS before the cut changes nothing — it was never in danger', () => {
    const msg = `see https://example.com/a ${'y'.repeat(1000)}`;
    expect(truncateForAudit(msg)).toHaveLength(AUDIT_TEXT_MAX);
  });

  it('a URL that STARTS after the cut is not dragged in', () => {
    const msg = `${'z'.repeat(1000)} https://example.com/late`;
    const kept = truncateForAudit(msg);
    expect(kept).toHaveLength(AUDIT_TEXT_MAX);
    expect(kept).not.toContain('example.com');
  });

  it('🔒 "keep the URL" can never mean "keep anything" — the hard ceiling holds', () => {
    const monstrous = `boom https://evil.example/${'q'.repeat(50_000)}`;
    expect(truncateForAudit(monstrous).length).toBeLessThanOrEqual(AUDIT_TEXT_HARD_MAX);
  });

  it('a non-string never throws — the honesty layer may not be the thing that breaks', () => {
    expect(truncateForAudit(undefined)).toBe('');
    expect(truncateForAudit(null)).toBe('');
    expect(() => truncateForAudit({ a: 1 } as unknown as string)).not.toThrow();
  });
});

describe('🔒 the row the admin reads carries the link end to end', () => {
  it('persistedAuditEntry no longer re-cuts what the store preserved', () => {
    const entry = persistedAuditEntry('DIAGNOSTICS_READ_FAILED', {
      kind: 'history', key: 'agentv3-abc-def', error: truncateForAudit(FIRESTORE_ERROR),
    });
    expect(entry.message).toContain(INDEX_URL);
    expect(entry.level).toBe('warn'); // unchanged — this is a failure, and the row still says so
  });

  it('🔒 the store records it through the shared helper, not a bare slice', () => {
    // Both halves are needed: preserved at the write and not re-cut at the read. A test of one
    // cannot see the other, so this is the guard for the seam between them.
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');
    expect(src).toContain('truncateForAudit(message)');
    expect(src).not.toContain('error: message.slice(0, 300)');
  });

  it('the other diagnostics failures got the same treatment — this was never one call site', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');
    // Four sites record a provider/Firestore message: three SAVE failures and one READ failure.
    expect(src.match(/truncateForAudit\(message\)/g) ?? []).toHaveLength(4);
  });
});

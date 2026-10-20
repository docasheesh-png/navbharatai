// Legacy workspace attribution is fail closed. Retention and independently verified
// migration remain open; prefix shape must never authorize deleting another owner.
import { describe, it, expect } from 'vitest';
import { planWorkspaceFieldErase } from '../src/server/lib/derivedIdErase';
import { eraseableWorkspaceId, planWorkspaceErase } from '../src/server/lib/workspaceDataErase';
import { USER_SCOPED_COLLECTIONS, RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';

const UID = 'abc123';

describe('build-event deletion requires ownership beyond the legacy workspaceId field', () => {
  it.each(['abc', 'abc-d', UID, 'aB3dEfGhIjKlMnOpQrStUvWxYz01'])(
    'does not sweep a prefix-only field range for %s', (uid) => {
      expect(planWorkspaceFieldErase(uid)).toBeNull();
      expect(planWorkspaceErase(uid).range).toBeNull();
    },
  );

  it('does not misattribute abc-d events to abc', () => {
    expect(eraseableWorkspaceId('abc', 'agentv3-abc-d-session1')).toBe(false);
    expect(eraseableWorkspaceId('abc-d', 'agentv3-abc-d-session1')).toBe(false);
  });

  it('refuses unusable and anonymous identifiers too', () => {
    for (const bad of ['', '   ', null, undefined, 'anon', '../other']) {
      expect(planWorkspaceFieldErase(bad), String(bad)).toBeNull();
    }
  });
});

describe('Q-784 — the wiring is real, not just a planner nobody calls', () => {
  const source = () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return fs.readFileSync(path.resolve(__dirname, '../src/server/lib/derivedIdErase.ts'), 'utf8');
  };

  it('the cascade retains a separately reported, ownership-gated build_events path', () => {
    const src = source();
    expect(src).toMatch(/deleteFieldRange\(\s*\n?\s*store, 'build_events', 'workspaceId', eventRange,/);
    expect(src).toMatch(/collection: 'build_events', documents: eventDocs/);
    // Verified per document, not merely matched by the range.
    expect(src).toMatch(/eraseableWorkspaceId\(uid, workspaceId\)/);
  });

  it('🔒 the page loop cannot spin on documents it refuses to delete', () => {
    // The sweep re-queries from the start of the range each page (deletions shrink the set, and a
    // cursor over a repeated field value can stall). Without the progress guard, a page in which every
    // document failed the verifier would be re-read until MAX_PAGES.
    expect(source()).toMatch(/if \(!progressed\) break;/);
  });

  it('build_events keeps its retention clock while attribution remains unverified', () => {
    // 90 days bounds what any user accumulates; the erase is what keeps §9's 30-day promise for a
    // person who left. Either alone is a half-answer, so neither may quietly replace the other.
    expect(RETENTION_POLICIES.find((p) => p.collection === 'build_events')?.ttlDays).toBe(90);
    // It is erased by the module, deliberately not by the registry — there is no field equal to a uid.
    expect(USER_SCOPED_COLLECTIONS.some((c) => c.collection === 'build_events')).toBe(false);
  });
});

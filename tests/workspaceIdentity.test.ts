/**
 * Audit finding #2 — who owns a workspace, decided in ONE place.
 *
 * `agentv3-{uid}-{sessionId}` is an AUTHORIZATION decision wearing a naming convention. The audit
 * found it re-typed at nine sites plus two private `ownsWorkspace()` copies. Nothing leaked — both
 * copies were read and were equally strict — but the next route to forget the line fails silently and
 * the failure is a data breach. These tests cover the three policies AND the invariant that keeps
 * them the only ones.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import {
  WORKSPACE_PREFIX,
  ANON_WORKSPACE_PREFIX,
  safeWorkspaceUid,
  workspacePrefixFor,
  workspaceIdFor,
  isWorkspaceId,
  workspaceOwnerUid,
  workspaceOwnershipOk,
  verifiedWorkspaceReadOk,
  ownedByVerifiedUid,
} from '../src/server/lib/workspaceIdentity';

const ALICE = 'agentv3-alice-sess123';
const BOB = 'agentv3-bob-sess456';
const ANON = 'agentv3-anon-sess789';

describe('safeWorkspaceUid / workspacePrefixFor', () => {
  it('accepts a plain uid and builds its prefix', () => {
    expect(safeWorkspaceUid('alice')).toBe('alice');
    expect(workspacePrefixFor('alice')).toBe('agentv3-alice-');
  });

  it('refuses anything that could break out of the id scheme', () => {
    for (const bad of ['', '  ', 'a/b', 'a b', 'a.b', '../x', 'x'.repeat(65), null, undefined]) {
      expect(safeWorkspaceUid(bad as string), String(bad)).toBe(null);
      expect(workspacePrefixFor(bad as string), String(bad)).toBe(null);
    }
  });

  it('returns null rather than the dangerous `agentv3--` prefix', () => {
    // A range query on `agentv3--` would sweep rows that are not the caller's. Returning null forces
    // the caller to handle it; returning a string would have handed it a working, wrong query.
    expect(workspacePrefixFor('')).toBe(null);
  });
});

describe('workspaceIdFor', () => {
  it('builds the id from a safe uid', () => {
    expect(workspaceIdFor('alice', 'sess123')).toBe(ALICE);
  });

  it('refuses to build an id for an unusable uid', () => {
    expect(workspaceIdFor('a/b', 'sess')).toBe(null);
    expect(workspaceIdFor(null, 'sess')).toBe(null);
  });
});

describe('workspaceOwnerUid', () => {
  it('reads the owner a workspace id claims', () => {
    expect(workspaceOwnerUid(ALICE)).toBe('alice');
    expect(workspaceOwnerUid(ANON)).toBe('anon');
  });

  it('is null for anything not shaped like a workspace id', () => {
    for (const bad of ['', 'agentv3-', 'agentv3', 'other-alice-1', 'agentv3--x', null, undefined, 42]) {
      expect(workspaceOwnerUid(bad as string), String(bad)).toBe(null);
    }
  });

  it('reads a CLAIM — it is not an authorization decision', () => {
    // Kept separate on purpose: "who does this say it belongs to?" must never be mistaken for
    // "may this caller have it?". A report needs the former; a route needs the latter.
    expect(workspaceOwnerUid(BOB)).toBe('bob');
    expect(ownedByVerifiedUid('alice', BOB)).toBe(false);
  });
});

describe('policy 1 — workspaceOwnershipOk (BUILD path)', () => {
  it('lets a verified owner through', () => {
    expect(workspaceOwnershipOk('alice', null, ALICE)).toBe(true);
  });

  it('keeps a token-blipped user building their OWN app via the claimed uid', () => {
    // The "never break the app" concession this policy exists for.
    expect(workspaceOwnershipOk(null, 'alice', ALICE)).toBe(true);
  });

  it('never lets a claimed uid override a VERIFIED one', () => {
    expect(workspaceOwnershipOk('alice', 'bob', BOB)).toBe(false);
    expect(workspaceOwnershipOk('alice', 'bob', ALICE)).toBe(true);
  });

  it('refuses another user, and anything not a workspace id', () => {
    expect(workspaceOwnershipOk('alice', null, BOB)).toBe(false);
    expect(workspaceOwnershipOk('alice', null, 'nonsense')).toBe(false);
    expect(workspaceOwnershipOk('alice', null, '')).toBe(false);
  });

  it('allows the anon bucket — it has no owner to protect', () => {
    expect(workspaceOwnershipOk(null, null, ANON)).toBe(true);
  });
});

describe('policy 2 — verifiedWorkspaceReadOk (PRIVATE READS)', () => {
  it('demands the VERIFIED uid — a claimed one is not accepted at all', () => {
    // The attack this closes: the uid is IN the id, so anyone who learned `agentv3-victim-{sid}`
    // could claim `userId=victim` and pass policy 1.
    expect(verifiedWorkspaceReadOk('alice', ALICE)).toBe(true);
    expect(verifiedWorkspaceReadOk(null, ALICE)).toBe(false);
    expect(verifiedWorkspaceReadOk('bob', ALICE)).toBe(false);
  });

  it('keeps an anon session able to read its own report by its unguessable sid', () => {
    expect(verifiedWorkspaceReadOk(null, ANON)).toBe(true);
  });
});

describe('policy 3 — ownedByVerifiedUid (STRICTEST)', () => {
  it('requires a verified owner', () => {
    expect(ownedByVerifiedUid('alice', ALICE)).toBe(true);
    expect(ownedByVerifiedUid(null, ALICE)).toBe(false);
    expect(ownedByVerifiedUid('bob', ALICE)).toBe(false);
  });

  it('does NOT exempt anon — an anon workspace has nobody to own a domain or a debug run', () => {
    // This is the one real difference from policy 2, and it is why three policies exist.
    expect(verifiedWorkspaceReadOk(null, ANON)).toBe(true);
    expect(ownedByVerifiedUid(null, ANON)).toBe(false);
    expect(ownedByVerifiedUid('alice', ANON)).toBe(false);
  });

  it('rejects non-string input without throwing (it is used as a type guard)', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(ownedByVerifiedUid('alice', bad), String(bad)).toBe(false);
    }
  });
});

describe('the invariant has ONE home', () => {
  const files = execSync(
    "find src/server -name '*.ts' | grep -v '\\.test\\.' | grep -v goldenScaffolds | grep -v 'generator/templates'",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  it('no file outside lib/workspaceIdentity re-types the ownership template literal', () => {
    // This is the whole point: a new route cannot re-derive the rule by hand. If this fails, the fix
    // is to import a policy from lib/workspaceIdentity — not to add the file to an allowlist.
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('src/server/lib/workspaceIdentity.ts')) continue;
      if (/\/\._/.test(f)) continue; // sibling generator tests emit scratch files into src/server/lib
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      src.split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comments explain the rule on purpose
        if (/`agentv3-\$\{/.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the two routes that used to carry a private copy now import the shared policy', () => {
    for (const f of ['src/server/routes/appDebug.ts', 'src/server/routes/nbaiDomains.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain("from '../lib/workspaceIdentity'");
      expect(src, f).toContain('ownedByVerifiedUid');
    }
  });

  it('the STORE layer shares the route layer\'s definition', () => {
    // The reason this module imports nothing: a Firestore store could not have imported an Express
    // route, which is exactly why the prefix got re-typed there in the first place.
    const store = readFileSync('src/server/AgentV3/WorkspaceFileStore.ts', 'utf8');
    expect(store).toContain('workspacePrefixFor');
    const mod = readFileSync('src/server/lib/workspaceIdentity.ts', 'utf8');
    expect(mod).not.toMatch(/^import /m);
  });

  it('re-exports keep every existing importer working', () => {
    const policy = readFileSync('src/server/lib/identityPolicy.ts', 'utf8');
    expect(policy).toContain("export { ANON_WORKSPACE_PREFIX } from './workspaceIdentity'");
    expect(ANON_WORKSPACE_PREFIX.startsWith(WORKSPACE_PREFIX)).toBe(true);
    expect(isWorkspaceId(ANON_WORKSPACE_PREFIX + 'x')).toBe(true);
  });
});

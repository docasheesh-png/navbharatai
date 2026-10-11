/**
 * A VERSION HISTORY IS NOT PUBLIC, AND THE SESSION ID WAS NEVER A SECRET.
 *
 * 🔴 WHAT THIS CLOSES (Q-780). Three routes had NO authentication at all:
 *
 *     GET  /api/build-history/:sessionId              → the list of versions
 *     GET  /api/build-history/:sessionId/:versionId   → the app's whole `files` map
 *     POST /api/build-history/:sessionId/checkpoint   → writes a version into that history
 *
 * The stated model, written in both `routes/build.ts` and `CodeVersioning.tsx`, was that "the
 * sessionId is the unguessable capability". For a signed-in web user it is `pro-${Date.now()}`
 * (`App.tsx`) — a millisecond timestamp, kept in localStorage for ever. The chain is short: that id
 * goes to the build, the workspace is `agentv3-{uid}-{sessionId}`, and `restorePointKey` strips the
 * prefix back off, so the history document id is the bare `pro-<ts>`.
 *
 * ⚠️ AND THE ANON CASE IS A DELIBERATE EXCEPTION, kept exactly as it was. `workspaceIdentity.ts` says
 * an `agentv3-anon-…` workspace has "no real owner to protect — they are scoped only by their
 * unguessable random sessionId (a capability, like a secret URL)". A signed-out person has no token to
 * present, so demanding one would delete a working feature. These tests pin that it still works.
 *
 * The neighbouring route in the same file carries the comment "SECURITY (audit IDOR): scope to the
 * verified token uid" — so this class was audited here before, and these three were missed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  mayTouchBuildHistory, refusalStatus, refusalMessage, type CountWorkspaceFiles,
} from '../src/server/lib/buildHistoryAccess';

const root = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

/** Victim owns `agentv3-victim-pro-1700000000000`. Nobody else owns anything. */
const countFiles: CountWorkspaceFiles = async (ws) => (ws === 'agentv3-victim-pro-1700000000000' ? 7 : 0);
const VICTIM_SESSION = 'pro-1700000000000';

describe('the attack this exists for', () => {
  it('🔒 a signed-in stranger who GUESSES the timestamp is refused', async () => {
    // The whole finding in one assertion: attacker knows the id, has a valid account, and still cannot
    // read it — because they own no workspace with that session id.
    const access = await mayTouchBuildHistory('attacker', VICTIM_SESSION, countFiles);
    expect(access.allowed).toBe(false);
    expect(access.allowed === false && access.reason).toBe('not-yours');
  });

  it('🔒 an anonymous caller is refused a signed-in user\'s history', async () => {
    const access = await mayTouchBuildHistory(null, VICTIM_SESSION, countFiles);
    expect(access.allowed).toBe(false);
    expect(access.allowed === false && access.reason).toBe('sign-in-required');
  });

  it('🔒 passing the victim\'s FULL workspace id does not help either', async () => {
    const access = await mayTouchBuildHistory('attacker', 'agentv3-victim-pro-1700000000000', countFiles);
    expect(access.allowed).toBe(false);
    expect(access.allowed === false && access.reason).toBe('not-yours');
  });

  it('the refusal does not say whether the history EXISTS — that would be an oracle', async () => {
    const guessed = await mayTouchBuildHistory('attacker', VICTIM_SESSION, countFiles);
    const nonsense = await mayTouchBuildHistory('attacker', 'pro-0000000000000', countFiles);
    expect(guessed.allowed).toBe(false);
    expect(nonsense.allowed).toBe(false);
    // Same reason, same status, same sentence: an attacker learns nothing by comparing them.
    expect(guessed.allowed === false && nonsense.allowed === false
      && guessed.reason === nonsense.reason).toBe(true);
    expect(refusalMessage('not-yours')).not.toMatch(/not found|exist/i);
  });
});

describe('and the owner still gets their own history', () => {
  it('the bare session id the picker hands out is accepted', async () => {
    const access = await mayTouchBuildHistory('victim', VICTIM_SESSION, countFiles);
    expect(access.allowed).toBe(true);
    expect(access.allowed && access.workspaceId).toBe('agentv3-victim-pro-1700000000000');
  });

  it('their own FULL workspace id is accepted too — some callers pass that', async () => {
    const access = await mayTouchBuildHistory('victim', 'agentv3-victim-pro-1700000000000', countFiles);
    expect(access.allowed).toBe(true);
    expect(access.allowed && access.as).toBe('owner');
  });

  it('a session id they have no app for is refused, even though it is their own prefix', async () => {
    // This is the assertion that makes the existence probe load-bearing: `ownedByVerifiedUid` alone is
    // TRUE for any string, because the id is built by prefixing the caller's own uid.
    const access = await mayTouchBuildHistory('victim', 'pro-9999999999999', countFiles);
    expect(access.allowed).toBe(false);
  });
});

describe('the anon capability is untouched, because it has no owner to check', () => {
  it('an anon history opens with no token at all', async () => {
    const access = await mayTouchBuildHistory(null, 'agentv3-anon-abc123', countFiles);
    expect(access.allowed).toBe(true);
    expect(access.allowed && access.as).toBe('anon-capability');
  });

  it('a signed-in person may open an anon history too — it is a secret URL, not a account', async () => {
    const access = await mayTouchBuildHistory('someone', 'agentv3-anon-abc123', countFiles);
    expect(access.allowed).toBe(true);
  });

  it('it does not need the workspace to exist — nothing is probed for an anon id', async () => {
    let probes = 0;
    await mayTouchBuildHistory(null, 'agentv3-anon-xyz', async () => { probes++; return 0; });
    expect(probes).toBe(0);
  });
});

describe('the refusal statuses are the useful ones', () => {
  it('401 when a token would help, 403 when it would not, 400 for no id', () => {
    expect(refusalStatus('sign-in-required')).toBe(401);
    expect(refusalStatus('not-yours')).toBe(403);
    expect(refusalStatus('no-session')).toBe(400);
  });
  it('an empty session id is refused before anything is probed', async () => {
    let probes = 0;
    const access = await mayTouchBuildHistory('victim', '   ', async () => { probes++; return 1; });
    expect(access.allowed).toBe(false);
    expect(probes).toBe(0);
  });
});

describe('all three routes are guarded, and every client call carries the token', () => {
  const route = read('src/server/routes/build.ts');

  it('🔒 each of the three handlers calls the rule', () => {
    // Counted rather than merely "mentioned once": the GET-list, the GET-version and the POST were
    // three separate handlers, and guarding two of them would have read as done.
    const calls = route.match(/mayTouchBuildHistory\(/g) ?? [];
    expect(calls.length, 'one per handler: list, version, checkpoint').toBeGreaterThanOrEqual(3);
  });

  it('🔒 the version route — the one that returns the files — is guarded BEFORE it reads them', () => {
    const i = route.indexOf("app.get('/api/build-history/:sessionId/:versionId'");
    expect(i).toBeGreaterThan(0);
    const handler = route.slice(i, i + 1400);
    const guard = handler.indexOf('mayTouchBuildHistory(');
    const load = handler.indexOf('buildHistoryStore.get(');
    expect(guard).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(guard);
  });

  it('🔒 no client call reaches these routes without a token', () => {
    // The window, not the line: a `fetch(url, { … })` spreads its options over several lines, so a
    // line-only check would call the authed checkpoint POST a failure and teach the next reader to
    // loosen the test instead of reading it.
    for (const rel of ['src/services/buildService.ts', 'src/components/ide/CodeVersioning.tsx']) {
      const lines = read(rel).split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('fetch(`/api/build-history/')) return;
        const call = lines.slice(i, i + 6).join('\n');
        expect(call, `${rel}:${i + 1} sends no token, so the owner's own history would read empty`)
          .toMatch(/authedHeaders\(/);
      });
    }
  });

  it('the stale "unguessable" justification is gone from both places that claimed it', () => {
    // It is the reason nobody looked: a security model stated as settled fact.
    expect(read('src/server/routes/build.ts')).not.toMatch(/sessionId is the unguessable\s*\n?\s*\/\/\s*capability, mirroring/);
    expect(read('src/components/ide/CodeVersioning.tsx'))
      .not.toMatch(/the session id is unguessable\) so it does not require one today/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FetchTimeoutError, LONG_REQUEST_TIMEOUT_MS, fetchFailureLine, isFetchTimeout } from '../src/lib/longRequest';
import {
  DEPLOY_BACKEND_FAILURE, PROVISION_DB_FAILURE, PUSH_APP_FAILURE, PUSH_APP_UNCONFIRMED_LINE,
  pushSavedLine, repoFactOf,
} from '../src/components/agentv3/pushAppFeedback';

/**
 * "COULD NOT REACH NAVBHARATAI — NOTHING WAS CHANGED" (admin 2026-09-07, screenshot) — shown after
 * 20 seconds under a button whose server work takes minutes and had, in fact, gone on to complete.
 *
 * The class: `authedFetch`'s 20-second default silently applied to every long Publish action, and
 * every catch then invented "nothing happened". The fix is a matching timeout per action AND a
 * failure line that distinguishes "we stopped waiting" from "the request never arrived".
 */
describe('isFetchTimeout / FetchTimeoutError', () => {
  it('recognises the error by class and by name, and nothing else', () => {
    expect(isFetchTimeout(new FetchTimeoutError())).toBe(true);
    expect(isFetchTimeout({ name: 'FetchTimeoutError' })).toBe(true);
    const abort = new Error('aborted'); abort.name = 'AbortError';
    expect(isFetchTimeout(abort)).toBe(false);
    expect(isFetchTimeout(new Error('offline'))).toBe(false);
    expect(isFetchTimeout(null)).toBe(false);
    expect(isFetchTimeout('FetchTimeoutError')).toBe(false);
  });

  it('keeps the readable message callers already show as-is', () => {
    expect(new FetchTimeoutError().message).toMatch(/took too long/i);
    expect(new FetchTimeoutError().name).toBe('FetchTimeoutError');
  });
});

describe('🔒 fetchFailureLine — a timeout NEVER says "nothing was changed"', () => {
  const wording = { notStarted: 'nothing happened', stillRunning: 'still running' };
  it('our own timer ⇒ still running (the server is still working)', () => {
    expect(fetchFailureLine(new FetchTimeoutError(), wording)).toBe('still running');
  });
  it('a request that never reached the server ⇒ nothing happened (the one case it is true)', () => {
    expect(fetchFailureLine(new TypeError('Failed to fetch'), wording)).toBe('nothing happened');
  });
  it('every Publish-screen wording keeps the two apart, and the still-running text never claims nothing changed', () => {
    for (const w of [PUSH_APP_FAILURE, DEPLOY_BACKEND_FAILURE, PROVISION_DB_FAILURE]) {
      expect(w.notStarted).not.toBe(w.stillRunning);
      expect(w.stillRunning).not.toMatch(/nothing was (changed|deployed|published)/i);
    }
    expect(PUSH_APP_UNCONFIRMED_LINE).toMatch(/could not confirm/i);
  });
});

describe('LONG_REQUEST_TIMEOUT_MS — every ceiling exceeds the 20 s default and stays under the server\'s 3600 s', () => {
  it('matches the real work, not a feeling of responsiveness', () => {
    for (const [name, ms] of Object.entries(LONG_REQUEST_TIMEOUT_MS)) {
      expect(ms, name).toBeGreaterThan(20_000);
      expect(ms, name).toBeLessThan(3600_000);
    }
    // A sandbox resume plus a full git push is the longest of them.
    expect(LONG_REQUEST_TIMEOUT_MS.pushAppToGitHub).toBeGreaterThanOrEqual(LONG_REQUEST_TIMEOUT_MS.deployBackend);
  });
});

describe('pushSavedLine — says which branch when the user\'s own branch was left alone', () => {
  it('a created or mirror repository is simply saved', () => {
    expect(pushSavedLine({ fullName: 'a/app', mode: 'created', pushedBranch: 'main', defaultBranch: 'main' }))
      .toBe('Saved to a/app. You can deploy the backend now.');
    expect(pushSavedLine({ owner: 'a', repo: 'app' })).toBe('Saved to a/app. You can deploy the backend now.');
  });
  it('🔒 a foreign repository names the pushed branch AND says the default branch was untouched', () => {
    const line = pushSavedLine({ fullName: 'a/real', mode: 'foreign-repo', pushedBranch: 'navbharatai/work', defaultBranch: 'main' });
    expect(line).toContain('"navbharatai/work"');
    expect(line).toMatch(/"main" branch was not touched/);
    expect(line).toMatch(/deploys build from "navbharatai\/work"/i);
  });
});

describe('repoFactOf — the durable record is the proof a push landed', () => {
  it('reads the same three fields the server requires', () => {
    expect(repoFactOf({ conversation: { repoOwnedByUser: true, repoOwner: ' a ', repoName: 'app' } })).toEqual({ owner: 'a', repo: 'app' });
  });
  it('🔒 an incomplete or not-owned record is not a fact', () => {
    expect(repoFactOf({ conversation: { repoOwnedByUser: false, repoOwner: 'a', repoName: 'app' } })).toBeNull();
    expect(repoFactOf({ conversation: { repoOwnedByUser: true, repoOwner: 'a' } })).toBeNull();
    expect(repoFactOf({ conversation: { repoOwnedByUser: true, repoOwner: '', repoName: 'app' } })).toBeNull();
    expect(repoFactOf({ conversation: null })).toBeNull();
    expect(repoFactOf(null)).toBeNull();
    expect(repoFactOf('nope')).toBeNull();
  });
});

describe('🔒 the wiring — the long actions pass their ceiling, and no caller builds its own controller', () => {
  const chooser = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');
  const fetchSrc = readFileSync(join(__dirname, '..', 'src/lib/authedFetch.ts'), 'utf8');

  it('each long request names its own ceiling at the call', () => {
    expect(chooser).toContain('}, LONG_REQUEST_TIMEOUT_MS.pushAppToGitHub);');
    expect(chooser).toContain('}, LONG_REQUEST_TIMEOUT_MS.deployBackend);');
    expect(chooser).toContain('}, LONG_REQUEST_TIMEOUT_MS.provisionDatabase);');
    expect(chooser).toContain('}, LONG_REQUEST_TIMEOUT_MS.storePublish);');
  });

  it('🔒 the store publish no longer builds a controller authedFetch would have overwritten', () => {
    // The 2026-08-27 "90 seconds" fix passed `signal: ac.signal`; authedFetch replaced it with its
    // own 20-second controller, so the 90 seconds never applied. A private controller here is the
    // exact shape of that regression.
    expect(chooser).not.toContain('new AbortController()');
    expect(chooser).toContain('const timedOut = isFetchTimeout(e);');
  });

  it('every long-action catch reports through fetchFailureLine — no catch invents "nothing happened" on its own', () => {
    expect(chooser).toContain('fetchFailureLine(e, PUSH_APP_FAILURE)');
    expect(chooser).toContain('fetchFailureLine(e, DEPLOY_BACKEND_FAILURE)');
    expect(chooser).toContain('fetchFailureLine(e, PROVISION_DB_FAILURE)');
    expect(chooser).not.toContain("setBackendLines(['Could not reach NavBharatAI — nothing was changed.'])");
    expect(chooser).not.toContain("setBackendLines(['Could not reach NavBharatAI — nothing was deployed.'])");
  });

  it('🔒 a push that outlived its request is followed up from the durable record, not assumed either way', () => {
    expect(chooser).toContain('if (isFetchTimeout(e)) void awaitRepoFact();');
    expect(chooser).toContain('/api/agentv3/conversations/${encodeURIComponent(workspaceId)}');
    expect(chooser).toContain('repoFactOf(');
  });

  it('🔒 authedFetch honours a caller\'s own signal instead of replacing it, and throws its typed timeout', () => {
    expect(fetchSrc).toContain("outer.addEventListener('abort', onOuterAbort, { once: true })");
    expect(fetchSrc).toContain('if (outer?.aborted) throw err;');
    expect(fetchSrc).toContain('throw new FetchTimeoutError();');
    expect(fetchSrc).not.toContain("throw new Error('That took too long to respond.");
  });
});

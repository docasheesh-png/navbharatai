import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE OVERLAY MUST HAVE A WAY BACK TO NULL (admin report 2026-08-17: "github login ho jata hai theek se
 * par, yaha aa kar atak jata hai").
 *
 * `githubRedirectingMessage` drives the full-screen "Opening GitHub… Please wait." panel. It was SET
 * when the flow started and, across the entire codebase, CLEARED in exactly one place: its own Dismiss
 * button. On the web that was invisible, because the flow ends in a full-page redirect that destroys the
 * state. On native there is no navigation — the in-app browser opens over the app and closes again — so
 * a login that had ALREADY SUCCEEDED left the user staring at "please wait" indefinitely.
 *
 * The handshake was never broken. The success path simply had nothing to say. These tests exist because
 * that is an easy thing to undo by accident: any refactor of the listener that drops one line puts the
 * app straight back into the same trap, and the trap looks like an OAuth failure rather than a UI bug.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const app = read('src/App.tsx');
const modals = read('src/components/panels/AppModals.tsx');
const hook = read('src/hooks/useGitHubConnect.ts');

/** The native deep-link listener, sliced from its registration to the end of its callback. */
const urlOpenListener = (() => {
  const at = app.indexOf("addListener('appUrlOpen'");
  expect(at, 'the native OAuth deep-link listener is gone').toBeGreaterThan(-1);
  return app.slice(at, at + 1600);
})();

describe('a successful native sign-in clears the waiting overlay', () => {
  it('the deep-link handler sets the message back to null', () => {
    // THE reported bug, in one line. Everything else in this handler already worked.
    expect(urlOpenListener).toContain('setGithubRedirectingMessage(null)');
  });

  it('it still does the things that were already right', () => {
    expect(urlOpenListener).toContain('setGithubToken(token)');
    expect(urlOpenListener).toContain("localStorage.setItem('gh_token', token)");
    expect(urlOpenListener).toContain('Browser.close()');
  });

  it('the token is parsed by the tested helper, not re-implemented inline', () => {
    expect(urlOpenListener).toContain('tokenFromDeepLink(');
  });
});

describe('backing out of the browser does not freeze the app either', () => {
  it('a foreground resume can end the wait', () => {
    // The same stuck state from the other direction: no deep link ever fires, so without this the
    // overlay is frozen exactly as before — and the only escape is a Dismiss button that reads like
    // giving up on something still in progress.
    expect(app).toContain("addListener('appStateChange'");
    expect(app).toContain('resumeOutcome(');
    expect(app).toContain('GITHUB_CANCELLED_MESSAGE');
  });

  it('the resume decision reads live state, not a stale closure', () => {
    // These listeners register once and live for the session, so reading the state variable inside one
    // would forever see its value at registration — i.e. always "nothing in flight".
    expect(app).toContain('githubRedirectingRef.current');
    expect(app).toContain('githubRedirectingRef.current = githubRedirectingMessage');
  });

  it('it waits for the deep link before concluding anything', () => {
    // A successful return fires BOTH events, on some platforms in an unhelpful order.
    expect(app).toContain('RESUME_GRACE_MS');
  });

  it('both native listeners are removed on cleanup, not just the first', () => {
    // The url-open listener already had a remover; adding a second one beside it is exactly how a
    // listener leak gets introduced on a component that remounts.
    expect(app).toContain('resumeHandle.remove()');
  });
});

describe('the pieces this depends on are still in place', () => {
  it('native still asks the server for the deep-link return', () => {
    // Without this sentinel the server sends the web postMessage page instead, which in the native app
    // lands in a browser the app cannot read — the original reason this flow could not complete.
    expect(hook).toContain("'nbai-native'");
  });

  it('Dismiss still works, but is no longer the only way out', () => {
    expect(modals).toContain('setGithubRedirectingMessage(null)');
  });
});

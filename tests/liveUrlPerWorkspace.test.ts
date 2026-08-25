import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ONE APP'S LIVE LINK MUST NEVER APPEAR ON ANOTHER APP.
 *
 * Admin, 2026-08-25: *"maine 1 app ko publish kiya … navbharat me bani sabhi app par publish, live
 * site likh kar aane laga, check kiya to sabhi app me app no 1 hi show ho rahi."*
 *
 * The bug was one missing line. `setLiveUrl` was called ONLY when a URL came back:
 *
 *     if (!cancelled && typeof data?.url === 'string' && data.url) setLiveUrl(data.url);
 *
 * So publishing app #1 set the state, and switching to app #2 — never published — left that `if`
 * unsatisfied and app #1's URL simply STAYED. Every app in the account then advertised a "Live site"
 * button that opened somebody else's app.
 *
 * The shape is the one this codebase keeps finding: **state that lives for the whole session
 * describing something that belongs to ONE workspace, with nothing reconciling the two.** These tests
 * pin all three instances found.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the live URL is per-workspace, not per-session', () => {
  const panel = src('src/components/agentv3/AgentV3Panel.tsx');

  it('🔒 switching app clears the previous app’s live URL BEFORE any fetch', () => {
    // Before the network round-trip, not after — otherwise the old app's URL sits on screen under the
    // new app's name for as long as the request takes.
    expect(panel).toContain('useEffect(() => { setLiveUrl(null); setCelebration(null); }, [state.workspaceId]);');
  });

  it('🔒 the fetch ALWAYS assigns — "no live site" is an answer, not a reason to keep the old one', () => {
    expect(panel).toContain("if (!cancelled) setLiveUrl(typeof data?.url === 'string' && data.url ? data.url : null);");
  });

  it('🔒 the set-only-on-success form is gone from the FETCH — and still correct in the publish', () => {
    // Scoped deliberately. Inside the workspace fetch, "no URL came back" means this app has no live
    // site and the old value must go; that is the exact line that leaked. Inside `deployLive` the same
    // shape is RIGHT: a publish that returns no URL must not wipe a live URL this app already has.
    // A blanket ban would have "fixed" the leak by breaking the publish button — which is why this
    // asserts on the effect's own body rather than on the whole file.
    const start = panel.indexOf('// Fetch the persisted live URL whenever the workspace changes');
    expect(start).toBeGreaterThan(-1);
    const effect = panel.slice(start, panel.indexOf('}, [state.workspaceId, state.done, userId, email]);', start));
    expect(effect).not.toContain('data.url) setLiveUrl(data.url);');

    // …and the publish handler keeps it, on purpose.
    const publish = panel.slice(panel.indexOf('const deployLive ='));
    expect(publish).toContain("if (typeof data?.url === 'string' && data.url) setLiveUrl(data.url);");
  });

  it('the clear is keyed on the workspace ALONE, so a finishing build cannot blink the button', () => {
    // The fetch effect also runs on `state.done`. Clearing there would flicker the Live-site button
    // off and on during every build.
    const at = panel.indexOf('setLiveUrl(null); setCelebration(null);');
    expect(at).toBeGreaterThan(-1);
    const line = panel.slice(at, panel.indexOf('\n', at));
    expect(line).toContain('[state.workspaceId]');
    expect(line).not.toContain('state.done');
  });
});

describe('the siblings — everything else that described ONE app but lived for the session', () => {
  const panel = src('src/components/agentv3/AgentV3Panel.tsx');
  const hook = src('src/hooks/usePublishState.ts');

  it('🔒 the publish MESSAGE is cleared — it names the other app’s URL verbatim', () => {
    // "Your app is live at <app #1's URL>" is rendered verbatim by the Publish sheet.
    expect(panel).toContain("useEffect(() => { setPublishMsg(''); }, [state.workspaceId]);");
  });

  it('🔒 the first-publish celebration is cleared — it belongs to ONE app’s first time', () => {
    expect(panel).toContain('setCelebration(null);');
  });

  it('🔒 usePublishState forgets the previous app before asking about this one', () => {
    // It cleared only when workspaceId went EMPTY, so switching between two real apps kept the first
    // app's answer through every early return: a non-ok response, an unparseable body, an offline
    // fetch. The user then sees "published 2 minutes ago" against an app never published.
    expect(hook).toContain('useEffect(() => { setState(null); }, [workspaceId]);');
  });

  it('that clear does NOT re-fire on refreshKey, which would blink the dot mid-build', () => {
    const at = hook.indexOf('useEffect(() => { setState(null); }, [workspaceId]);');
    expect(at).toBeGreaterThan(-1);
    expect(hook.slice(at, hook.indexOf('\n', at))).not.toContain('refreshKey');
  });

  it('the early-return paths still exist — they are correct, they just must not preserve stale state', () => {
    // A failed fetch is not evidence about anyone's site; showing nothing is right. The clear above is
    // what makes "nothing" mean nothing, instead of meaning "the last app you looked at".
    expect(hook).toContain('if (!res.ok) return;');
  });
});

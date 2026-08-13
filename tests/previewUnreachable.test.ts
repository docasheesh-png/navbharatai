import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ADMIN REPORT 2026-08-13 — the mitrify port change.
 *
 * The admin changed their app's port from 5000 to 3000 and, mid-build, the Live tab showed this:
 *
 *     Closed Port Error
 *     The sandbox i5f6j2yx9dhrw3kpkvzd8 is running but there's no service running on port 3000.
 *     3000-i5f6j2yx9dhrw3kpkvzd8.e2b.app — Connection refused on port 3000
 *
 * The app itself was fine — the build was still running and the dev server had not restarted yet, and
 * it came up a minute later. What was NOT fine is that page, and it exposed two defects at once:
 *
 *  1. **The user cannot tell "still starting" from "broken".** The truthful answer was "not yet"; the
 *     screen said, in red, that something was wrong.
 *  2. **It names a vendor.** "sandbox", and an `e2b.app` hostname, on a screen an end user is looking
 *     at. The white-label law in CLAUDE.md forbids that outright — to the user it is always
 *     NavBharatAI doing the work.
 *
 * ROOT CAUSE, and it is one line: the health probe's `catch` swallowed the failure. `notServing` is
 * only ever set when the probe ANSWERS with `serving: false`, so a connection-refused left every piece
 * of state null — no banner, no explanation — while the iframe below happily rendered whatever the
 * provider chose to return.
 */

const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

/**
 * The unreachable branch with its comments STRIPPED.
 *
 * The comments above that branch necessarily name the vendor and quote the words "Closed Port Error" —
 * that is the record of why the code exists. What must not name a vendor is the text a USER reads, so
 * the assertions below run against the JSX alone. Asserting over the comment too would have forced the
 * explanation out of the file to make a test pass, which is the wrong trade every time.
 */
function unreachableJsx(): string {
  const at = surface.indexOf('unreachable ? (');
  expect(at, 'the unreachable branch must exist').toBeGreaterThan(0);
  // Bounded at the ELSE arm, not by a character count. A fixed window overshot into the reachable
  // branch, whose iframe carries a literal `sandbox="allow-scripts …"` attribute — an ordinary HTML
  // attribute that a blunt vendor-name search reads as a vendor name. The branch has to be delimited
  // by its own syntax or the test measures the wrong code.
  const end = surface.indexOf(') : (', at);
  expect(end, 'the branch must have an else arm').toBeGreaterThan(at);
  return surface.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('an unreachable preview is no longer swallowed', () => {
  it('the probe failure now RECORDS the state instead of discarding it', () => {
    expect(surface).toContain('setUnreachable(true)');
    // And a probe that answers must clear it, or one hiccup would pin the message on screen forever.
    expect(surface).toContain('setUnreachable(false)');
  });

  it('it is a SEPARATE state from notServing, because they are different failures', () => {
    /**
     * `notServing` means "the server answered but served the wrong thing" — the frame stays, because
     * what it shows is at least the user's own server. Unreachable means nothing answered at all, and
     * the frame must not stay. Collapsing the two would give one of them the wrong remedy.
     */
    expect(surface).toContain('const [unreachable, setUnreachable] = useState(false)');
    expect(surface).toContain('const [notServing, setNotServing] = useState<string[] | null>(null)');
  });
});

describe('the vendor error page is not framed as the user\'s app', () => {
  it('the iframe is replaced, not merely captioned, when nothing is answering', () => {
    // A banner above a red provider error page still leaves that page on screen. The fix is that it is
    // not rendered at all.
    expect(unreachableJsx()).toContain('hasn’t started serving yet');
    // …and the frame lives in the OTHER arm, so it renders only when something is actually answering.
    expect(surface).toMatch(/\) : \(\s*<ResponsiveFrame/);
  });

  it('the honest state names NO vendor', () => {
    const branch = unreachableJsx();
    expect(branch).not.toMatch(/\b(e2b|E2B|sandbox|Sandbox|StackBlitz|Firecracker)\b/);
    // …and it does say whose engine it is, which is the other half of the white-label law.
    expect(branch).toContain('NavBharatAI');
  });

  it('it does not accuse the app of being broken', () => {
    /**
     * The most common cause is a build still running, so the wording has to be true in that case
     * FIRST. Calling a starting app "failed" is the same class of dishonesty as calling a failed one
     * "ready" — it is just the cheaper direction to be wrong in.
     */
    const branch = unreachableJsx();
    expect(branch).toMatch(/still bringing it up|clears on its own/);
    expect(branch).not.toMatch(/\b(error|failed|crashed|broken)\b/i);
  });

  it('it offers a way forward, not just a diagnosis', () => {
    // "Check again" for the case where it has since come up, and the in-browser preview for the case
    // where the user just wants to SEE their app now — it renders the current files without a server.
    const branch = unreachableJsx();
    expect(branch).toContain('Check again');
    expect(branch).toContain("setMode('inbrowser')");
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { publishableVerdict, entryPagesOf } from '../src/server/AgentV3/publishablePayload';

/**
 * ⚠️ THE PUBLISH THIS EXISTS FOR (admin 2026-08-25). A publish reported success, returned a live link,
 * and the link opened the SANDBOX SCAFFOLD: "Welcome to Navbharat AI Sandbox — Edit index.html to see
 * changes or ask AI to build something!". Five files, no JavaScript bundle, and a green result.
 *
 * Every gate on that path had passed, and each was individually correct:
 *   • `npm run build` exited 0     — it did; it built the placeholder
 *   • an output directory existed  — it did
 *   • `files.size === 0` was false — five files is not zero
 *
 * The tenth instance of one pattern in a week: "the dist is not empty" standing in for "the app was
 * built". Emptiness was the only thing checked, and a placeholder is not empty.
 */
const PLACEHOLDER =
  '<!DOCTYPE html><html><body><div><h2>Welcome to Navbharat AI Sandbox</h2>'
  + '<p>Edit index.html to see changes or ask AI to build something!</p></div></body></html>';

describe('a publish must be the user\'s app, not the starter page', () => {
  it('refuses the scaffold placeholder', () => {
    const v = publishableVerdict([PLACEHOLDER]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('not your app');
  });

  it('survives the wrapping the publish pipeline adds', () => {
    // The real page was 3.9 KB, not the 350-byte template: the pipeline injects a badge, a manifest
    // link and a service-worker registration. A marker matched on the whole document would have missed.
    const wrapped = `<!DOCTYPE html><html><head><link rel="manifest" href="/manifest.webmanifest"></head>`
      + `<body>${PLACEHOLDER}<div class="made-with">Made with NavBharatAI</div>`
      + `<script>navigator.serviceWorker.register("/sw.js")</script></body></html>`;
    expect(publishableVerdict([wrapped]).ok).toBe(false);
  });

  it('tells the user what to DO, not just that it failed', () => {
    // "Publish failed" with no cause is what made this button feel dead once already.
    expect(publishableVerdict([PLACEHOLDER]).reason).toMatch(/build the app first/i);
  });
});

describe('and it must never refuse a real app', () => {
  it('publishes an ordinary built app', () => {
    expect(publishableVerdict(['<html><body><div id="root"></div><script src="/assets/index-a1b2.js"></script></body></html>']).ok).toBe(true);
  });

  it('publishes a plain HTML site with NO bundle — that is a real thing we build', () => {
    // The tempting second signal ("no JS bundle ⇒ not built") is wrong, and this is why: the `static`
    // scaffold makes plain HTML/CSS/JS sites on purpose. Refusing one would break a working feature to
    // catch a rarer bug. A publish is the user's own work; the bar for refusing is proof, not suspicion.
    expect(publishableVerdict(['<html><body><h1>Chai Counter</h1><p>Est. 2026</p></body></html>']).ok).toBe(true);
  });

  it('does not fire on a page that merely MENTIONS building or AI', () => {
    expect(publishableVerdict(['<html><body><h1>Build something with AI</h1><p>Our sandbox tutorial</p></body></html>']).ok).toBe(true);
  });

  it('an empty list is publishable here — emptiness is the caller\'s own check', () => {
    // Two different errors for one condition would be worse than one. `files.size === 0` already
    // throws its own sentence upstream.
    expect(publishableVerdict([]).ok).toBe(true);
  });
});

describe('entryPagesOf reads only the pages that can carry it', () => {
  it('picks index.html at any depth, and ignores everything else', () => {
    const files = new Map<string, Buffer>([
      ['index.html', Buffer.from(PLACEHOLDER)],
      ['about/index.html', Buffer.from('<h1>About</h1>')],
      ['assets/index-a1b2.js', Buffer.from('console.log(1)')],
      ['style.css', Buffer.from('body{}')],
    ]);
    const pages = entryPagesOf(files);
    expect(pages).toHaveLength(2);
    expect(publishableVerdict(pages).ok).toBe(false);
  });

  it('does not choke on binary bytes', () => {
    const files = new Map<string, Buffer>([['favicon.ico', Buffer.from([0, 1, 2, 255])]]);
    expect(() => entryPagesOf(files)).not.toThrow();
    expect(entryPagesOf(files)).toHaveLength(0);
  });
});

describe('it is wired at the ONE place both publish paths go through', () => {
  it('guards the shared deploy tool, after the emptiness check', () => {
    // The button and the agent both reach `deploy`. Guarding the route alone would leave the agent's
    // own publish able to ship a placeholder.
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const at = src.indexOf('const publishable = publishableVerdict(entryPagesOf(files), {');
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf("throw new Error('No built files found")).toBeLessThan(at);
    expect(src.indexOf('await this.deploy(this.workspaceId, files)')).toBeGreaterThan(at);
  });
});

/**
 * THE SECOND SIGNAL — a CONTRADICTION, not a suspicion (admin 2026-08-25: "aur jyada rocksolid kar ke
 * merge karna").
 *
 * The scaffold marker catches the exact page that shipped. It would NOT catch the same failure with a
 * different placeholder, an edited one, or none at all — and the underlying fault is not the text, it
 * is that a build produced nothing from source that plainly needed compiling.
 *
 * So this compares two facts we already hold and fires only when they cannot both be true: the
 * workspace has COMPONENT files, and the payload has no script or stylesheet at all. There is no
 * reading of that pair in which the user's app is in the payload.
 */
describe('a build that produced nothing from real UI source is refused', () => {
  const shell = ['index.html', 'robots.txt', 'manifest.webmanifest', 'sw.js', 'icon.svg'];

  it('refuses when the workspace has components and the payload has no assets', () => {
    // Exactly the shape of the reported publish: five files, none of them a script or a stylesheet.
    const v = publishableVerdict(['<html><body><h1>Hi</h1></body></html>'], {
      distPaths: shell,
      sourcePaths: ['src/App.tsx', 'src/components/Board.tsx', 'package.json'],
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('was not included');
  });

  it('does NOT fire on a plain HTML site — no components, so nothing was owed', () => {
    // The whole reason the signal is components-only. This is a first-class thing the platform builds.
    expect(publishableVerdict(['<html><body><h1>Chai Counter</h1></body></html>'], {
      distPaths: ['index.html', 'style.css'.replace('style.css', 'about.html')],
      sourcePaths: ['index.html', 'style.css', 'script.js', 'package.json'],
    }).ok).toBe(true);
  });

  it('does NOT fire on an API project — .ts is not evidence of a user interface', () => {
    expect(publishableVerdict(['<html><body>API</body></html>'], {
      distPaths: shell,
      sourcePaths: ['src/index.ts', 'src/routes/users.ts', 'package.json'],
    }).ok).toBe(true);
  });

  it('does NOT fire when the app really built — the assets are right there', () => {
    expect(publishableVerdict(['<html><body><div id="root"></div></body></html>'], {
      distPaths: ['index.html', 'assets/index-a1b2.js', 'assets/index-c3d4.css'],
      sourcePaths: ['src/App.tsx', 'src/main.tsx'],
    }).ok).toBe(true);
  });

  it('skips entirely when either list is missing — our blindness must never block a publish', () => {
    // The most important case. `listFiles` is best-effort at the call site, and a publish stopped
    // because WE could not look is the exact failure this whole file exists to prevent.
    const src = ['src/App.tsx'];
    expect(publishableVerdict(['<html></html>'], { distPaths: shell }).ok).toBe(true);
    expect(publishableVerdict(['<html></html>'], { sourcePaths: src }).ok).toBe(true);
    expect(publishableVerdict(['<html></html>'], {}).ok).toBe(true);
    expect(publishableVerdict(['<html></html>'], { distPaths: [], sourcePaths: src }).ok).toBe(true);
  });

  it('counts every asset kind a build can emit', () => {
    for (const asset of ['assets/a.js', 'a.mjs', 'a.cjs', 'style.css']) {
      expect(publishableVerdict(['<html></html>'], {
        distPaths: ['index.html', asset],
        sourcePaths: ['src/App.tsx'],
      }).ok).toBe(true);
    }
  });

  it('and every component kind the platform builds', () => {
    for (const ui of ['src/App.tsx', 'src/App.jsx', 'src/App.vue', 'src/App.svelte']) {
      expect(publishableVerdict(['<html></html>'], { distPaths: shell, sourcePaths: [ui] }).ok).toBe(false);
    }
  });
});

describe('the second signal is wired, and cannot itself break a publish', () => {
  const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('passes the real dist paths and the workspace listing', () => {
    expect(src).toContain('distPaths: [...files.keys()],');
    expect(src).toContain('sourcePaths,');
  });

  it('a failed listing degrades to undefined, never to an empty list', () => {
    // `catch { sourcePaths = [] }` would be the dangerous version — an empty list is a claim ("this
    // workspace has no components"), and here it would silently disable the check instead of skipping
    // it honestly. Same distinction as every other fix this week.
    expect(src).toContain('catch { sourcePaths = undefined; }');
  });
});

/**
 * THE REPORTED PUBLISH, REPRODUCED EXACTLY — the regression test that matters most.
 *
 * These are the five objects that actually landed in the bucket on 2026-08-25, in order, with the
 * page the user actually saw. If a future change makes this pass, the admin gets a dead link again.
 *
 * It is also the case my FIRST version of the second signal silently missed: `sw.js` matched
 * BUILT_ASSET, so "a script is present" read as "the build emitted something" — an artifact standing
 * in for the thing it was meant to prove, inside the very guard written against that pattern.
 */
describe('the 2026-08-25 publish, exactly as it happened', () => {
  const SHIPPED = ['icon.svg', 'index.html', 'manifest.webmanifest', 'robots.txt', 'sw.js'];
  const PAGE =
    '<!DOCTYPE html><html><head><link rel="manifest" href="/manifest.webmanifest" />'
    + '<link rel="icon" href="/icon.svg" type="image/svg+xml" /></head>'
    + '<body style="background:#0d1117"><div><h2 style="color:white">Welcome to Navbharat AI Sandbox</h2>'
    + '<p>Edit index.html to see changes or ask AI to build something!</p></div>'
    + "<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}</script>"
    + '</body></html>';

  it('is refused by the marker', () => {
    expect(publishableVerdict([PAGE]).ok).toBe(false);
  });

  it('is ALSO refused by the contradiction alone, with the marker text removed', () => {
    // Belt and braces on purpose: the marker is exact and therefore brittle to a reworded placeholder.
    // The contradiction does not care what the page says.
    const reworded = PAGE.replace('Welcome to Navbharat AI Sandbox', 'Hello')
      .replace('Edit index.html to see changes or ask AI to build something!', 'Coming soon');
    expect(publishableVerdict([reworded]).ok).toBe(true); // marker alone: passes
    expect(publishableVerdict([reworded], {
      distPaths: SHIPPED,
      sourcePaths: ['src/App.tsx', 'src/components/Game.tsx', 'package.json', 'server/index.ts'],
    }).ok).toBe(false); // with the workspace in view: caught
  });

  it("the platform's own four files never count as the user's build output", () => {
    // The exact miss. Each one alone must leave the payload looking asset-free.
    for (const injected of ['sw.js', 'manifest.webmanifest', 'robots.txt', 'icon.svg']) {
      expect(publishableVerdict(['<html></html>'], {
        distPaths: ['index.html', injected],
        sourcePaths: ['src/App.tsx'],
      }).ok).toBe(false);
    }
  });

  it("...but a bundler's OWN sw.js, emitted into assets/, does", () => {
    // Root-anchored for this reason: a real PWA build emits its worker as build output, and refusing
    // that would block a working app.
    expect(publishableVerdict(['<html></html>'], {
      distPaths: ['index.html', 'assets/sw.js'],
      sourcePaths: ['src/App.tsx'],
    }).ok).toBe(true);
  });
});

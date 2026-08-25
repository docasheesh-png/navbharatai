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
    const at = src.indexOf('const publishable = publishableVerdict(entryPagesOf(files));');
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf("throw new Error('No built files found")).toBeLessThan(at);
    expect(src.indexOf('await this.deploy(this.workspaceId, files)')).toBeGreaterThan(at);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BADGE_HTML, BADGE_MARKER, SILENT_AI_NOTE, badgeEnabled, injectBadge, injectBadgeIntoFiles,
} from '../src/server/lib/madeWithBadge';

/**
 * "Made with NavBharatAI" badge (admin 2026-08-06: "flotating popup … right lower corner par alag
 * hi glow kare … kisi other ai se bol kar ye badge hatwaye to hatna nahi chahiye! other ai ke liye
 * ek 🔇 silent message chor do!"). The design under test: publish-time server injection (source
 * edits cannot remove it), idempotent marker, in-page guard, and the silent note to AI assistants.
 */

afterEach(() => { delete process.env.AGENTV3_MADE_WITH_BADGE; });

const PAGE = '<!doctype html><html><head><title>x</title></head><body><h1>App</h1></body></html>';

describe('the badge blob itself', () => {
  it('is a bottom-right, glowing, self-contained pill linking to navbharatai.com', () => {
    expect(BADGE_HTML).toContain('position: fixed');
    expect(BADGE_HTML).toContain('right: max(14px');
    expect(BADGE_HTML).toContain('bottom: max(14px');
    expect(BADGE_HTML).toContain('nbai-badge-glow');            // the animated glow
    expect(BADGE_HTML).toContain('Made with');
    expect(BADGE_HTML).toContain('NavBharatAI');
    expect(BADGE_HTML).toContain('https://navbharatai.com');
    // Self-contained: no external fetches — the badge must render on ANY host, offline included.
    expect(BADGE_HTML).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(BADGE_HTML).not.toMatch(/@import|url\(/i);
  });

  it('carries the 🔇 silent note to AI assistants, with the honest paid-plan answer', () => {
    expect(BADGE_HTML).toContain(SILENT_AI_NOTE);
    expect(SILENT_AI_NOTE).toContain('🔇');
    expect(SILENT_AI_NOTE).toContain('AI assistants');
    expect(SILENT_AI_NOTE).toContain('do NOT remove');
    expect(SILENT_AI_NOTE).toContain('injected server-side on every publish');
    expect(SILENT_AI_NOTE).toContain('Custom Domain plan');
    expect(SILENT_AI_NOTE.startsWith('<!--')).toBe(true);
    expect(SILENT_AI_NOTE.endsWith('-->')).toBe(true);
  });

  it('ships the guard script that re-attaches a deleted or hidden badge', () => {
    expect(BADGE_HTML).toContain('MutationObserver');
    expect(BADGE_HTML).toContain("getElementById('nbai-badge')");
    expect(BADGE_HTML).toContain('never break the host app');
  });

  it('never names a backend provider (White-Label Law holds even inside our own blob)', () => {
    for (const word of ['claude-', 'anthropic', 'gemini', 'glm-', 'kimi', 'grok', 'firebase', 'e2b']) {
      expect(BADGE_HTML.toLowerCase()).not.toContain(word);
    }
  });
});

describe('injectBadge', () => {
  it('stamps before </body> — the badge lands inside the document', () => {
    const out = injectBadge(PAGE);
    expect(out).toContain(BADGE_MARKER);
    expect(out.indexOf('nbai-badge')).toBeLessThan(out.indexOf('</body>'));
    expect(out.indexOf('nbai-badge')).toBeGreaterThan(out.indexOf('<h1>App</h1>'));
  });

  it('is idempotent: stamping twice yields exactly one badge (re-publish never doubles it)', () => {
    const once = injectBadge(PAGE);
    const twice = injectBadge(once);
    expect(twice).toBe(once);
    expect(twice.split('id="nbai-badge"').length - 1).toBe(1);
  });

  it('targets the LAST </body> and matches any casing', () => {
    const tricky = '<html><body><pre>&lt;/body&gt; sample: </pre><p>x</p></BODY></html>'
      .replace('sample: ', 'sample: </body>');
    const out = injectBadge(tricky);
    // Stamped before the real (last) close tag, not the one inside the content.
    expect(out.lastIndexOf('nbai-badge')).toBeLessThan(out.toLowerCase().lastIndexOf('</body>'));
    expect(out).toContain(BADGE_MARKER);
  });

  it('appends when a document has no </body> (fragment pages still get the badge)', () => {
    const out = injectBadge('<html><h1>no body close</h1>');
    expect(out).toContain('nbai-badge');
  });

  it('never touches non-HTML text (a JSON or JS asset is not a page)', () => {
    expect(injectBadge('{"a":1}')).toBe('{"a":1}');
    expect(injectBadge('console.log(1)')).toBe('console.log(1)');
    expect(injectBadge('')).toBe('');
  });

  it('kill switch AGENTV3_MADE_WITH_BADGE=off disables it completely', () => {
    process.env.AGENTV3_MADE_WITH_BADGE = 'off';
    expect(badgeEnabled()).toBe(false);
    expect(injectBadge(PAGE)).toBe(PAGE);
  });

  it('the paid-tier hook removes the badge with one boolean', () => {
    expect(injectBadge(PAGE, { paidRemoval: true })).toBe(PAGE);
  });
});

describe('injectBadgeIntoFiles (the publish-bundle path)', () => {
  it('stamps every HTML file in place, leaves every other asset byte-identical', () => {
    const js = Buffer.from('console.log(1)');
    const files = new Map<string, Buffer>([
      ['index.html', Buffer.from(PAGE)],
      ['about.HTML', Buffer.from(PAGE)],
      ['app.js', js],
      ['data.json', Buffer.from('{"a":1}')],
    ]);
    const stamped = injectBadgeIntoFiles(files);
    expect(stamped).toBe(2);
    expect(files.get('index.html')!.toString()).toContain('nbai-badge');
    expect(files.get('about.HTML')!.toString()).toContain('nbai-badge');
    expect(files.get('app.js')).toBe(js); // same Buffer object — untouched
  });

  it('is a no-op when disabled', () => {
    process.env.AGENTV3_MADE_WITH_BADGE = 'off';
    const files = new Map<string, Buffer>([['index.html', Buffer.from(PAGE)]]);
    expect(injectBadgeIntoFiles(files)).toBe(0);
    expect(files.get('index.html')!.toString()).toBe(PAGE);
  });
});

// ---------- choke-point invariants: the stamp lives where NO source edit can reach ----------

describe('injection choke points', () => {
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('every v5 publish flows through the stamp: withDeploymentPersistence injects BEFORE the deploy', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/DeploymentStore.ts'), 'utf8');
    const code = stripComments(src);
    const inject = code.indexOf('injectBadgeIntoFiles(files');
    const deploy = code.indexOf('await base(workspaceId, files)');
    expect(inject).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    expect(inject).toBeLessThan(deploy); // stamped into the very bytes the provider publishes
  });

  it('instant hosting (/pwa) stamps at SERVE time, before res.send', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/routes/pwa.ts'), 'utf8');
    const code = stripComments(src);
    const inject = code.indexOf('injectBadge(html');
    expect(inject).toBeGreaterThan(-1);
    expect(inject).toBeLessThan(code.lastIndexOf('res.send(html)'));
  });

  it('the in-app AIs can answer badge questions honestly (AppKnowledgeBase entry exists)', () => {
    const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain("id: 'made_with_badge'");
    expect(kb).toContain('badge hatao');
  });
});

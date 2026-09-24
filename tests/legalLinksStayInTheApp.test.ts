import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A legal link must never reload the mobile app (admin 2026-09-23).
 *
 * Admin, verbatim: *"mobile app me navbharatai ke about us me jab terms and conditions etc par click
 * karte hai to open nahi ho raha. crash jaisa feel ho raha."*
 *
 * The bundled app's WebView origin is `https://localhost`, so a relative `<a href="/terms">` there
 * means `https://localhost/terms`: the local asset server answers with index.html and the whole app
 * boots again from its splash screen. It happened on three About links AND on every relative link
 * inside the legal documents, which the app renders on its own Legal page.
 *
 * These tests lock the FAILURE, not a wording:
 *  1. every legal path (and every alias the server redirects) resolves to a page the app really has;
 *  2. every relative link written inside every legal document resolves (a new link cannot reopen it);
 *  3. a tap on one of those links is intercepted — the default navigation never happens;
 *  4. no client component carries a bare relative `href="/…"` literal again.
 */

const opened: string[] = [];
vi.mock('../src/lib/mobileNative', () => ({
  openExternalUrl: (url: string) => { opened.push(url); },
  isNativeApp: () => true,
}));

const dispatched: Array<{ type: string; detail: unknown }> = [];
(globalThis as any).window = {
  dispatchEvent: (e: CustomEvent) => { dispatched.push({ type: e.type, detail: e.detail }); return true; },
};

const { legalLinkTarget, openLegalLink } = await import('../src/lib/legalLinks');
const { PUBLIC_LEGAL_ROUTES, LEGAL_PATH_ALIASES } = await import('../src/server/lib/legalPaths');
const { LEGAL_META } = await import('../src/content/legal/meta');
const { LEGAL_DOCS } = await import('../src/content/legal');
const { legalMarkdownComponents } = await import('../src/components/panels/LegalDocPage');
const { ABOUT_LEGAL_LINKS } = await import('../src/components/panels/AboutPanel');

const IN_APP_IDS = new Set(LEGAL_META.map((m) => m.id));

beforeEach(() => { opened.length = 0; dispatched.length = 0; });

describe('the resolver: every legal path goes somewhere the app really has', () => {
  it('each canonical legal path opens its own in-app page', () => {
    for (const [path, id] of Object.entries(PUBLIC_LEGAL_ROUTES)) {
      expect(legalLinkTarget(path)).toEqual({ kind: 'in-app', screen: id });
      expect(IN_APP_IDS.has(id as any)).toBe(true);
    }
  });

  it('every alias the server redirects lands on the same page, never on nothing', () => {
    for (const [alias, target] of Object.entries(LEGAL_PATH_ALIASES)) {
      expect(legalLinkTarget(alias)).toEqual(legalLinkTarget(target));
      expect(legalLinkTarget(alias)).not.toBeNull();
    }
  });

  it('pages only the server has open at their real address, never inside the WebView', () => {
    expect(legalLinkTarget('/contact')).toEqual({ kind: 'external', url: 'https://navbharatai.com/contact' });
    expect(legalLinkTarget('/delete-account')).toEqual({ kind: 'external', url: 'https://navbharatai.com/delete-account' });
  });

  it('absolute links to our own site, any case or trailing slash, resolve the same way', () => {
    expect(legalLinkTarget('https://navbharatai.com/privacy')).toEqual({ kind: 'in-app', screen: 'legal_privacy' });
    expect(legalLinkTarget('https://www.navbharatai.com/Terms/')).toEqual({ kind: 'in-app', screen: 'legal_terms' });
    expect(legalLinkTarget('/terms#refunds')).toEqual({ kind: 'in-app', screen: 'legal_terms' });
  });

  it('somebody else\'s site, a script URL, mail and nonsense are left alone', () => {
    for (const href of ['https://evil.example/terms', 'javascript:alert(1)', 'mailto:info@navbharatai.com', '', '   ', null, undefined, '/pricing', '#top']) {
      expect(legalLinkTarget(href as any)).toBeNull();
    }
  });
});

describe('the documents: no link written inside a legal page can reload the app', () => {
  const relativeLinks = LEGAL_DOCS.flatMap((d) =>
    [...d.body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => ({ doc: d.id, href: m[1] })));

  it('the documents really do link to each other (the class this locks exists)', () => {
    expect(relativeLinks.length).toBeGreaterThan(5);
  });

  it('every relative link in every document resolves', () => {
    const dead = relativeLinks.filter((l) => legalLinkTarget(l.href) === null);
    expect(dead).toEqual([]);
  });
});

describe('a tap is intercepted — the default navigation never happens', () => {
  function tap(href: string) {
    const el = (legalMarkdownComponents as any).a({ href, children: 'x' });
    const preventDefault = vi.fn();
    el.props.onClick({ preventDefault });
    return preventDefault;
  }

  it('an in-app document opens Settings on that document', () => {
    const prevented = tap('/refund');
    expect(prevented).toHaveBeenCalled();
    expect(dispatched).toEqual([{ type: 'navbharat:navigate', detail: { view: 'settings', settingsScreen: 'legal_refund' } }]);
  });

  it('a server-only page goes to the browser', () => {
    const prevented = tap('/contact');
    expect(prevented).toHaveBeenCalled();
    expect(opened).toEqual(['https://navbharatai.com/contact']);
  });

  it('another site goes to the browser too, instead of replacing the app', () => {
    const prevented = tap('https://www.meity.gov.in/');
    expect(prevented).toHaveBeenCalled();
    expect(opened).toEqual(['https://www.meity.gov.in/']);
  });

  it('a mail link keeps the browser\'s own behaviour', () => {
    const prevented = tap('mailto:info@navbharatai.com');
    expect(prevented).not.toHaveBeenCalled();
    expect(openLegalLink('mailto:info@navbharatai.com')).toBe(false);
  });

  it('every About link opens an in-app page', () => {
    expect(ABOUT_LEGAL_LINKS.map((l) => l.href)).toEqual(['/privacy', '/terms', '/grievance']);
    for (const link of ABOUT_LEGAL_LINKS) {
      expect(legalLinkTarget(link.href)?.kind).toBe('in-app');
    }
  });
});

describe('no client component carries a bare relative href again', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === 'server' ? [] : tsxFiles(p);
      return p.endsWith('.tsx') && !p.includes('.test.') ? [p] : [];
    });
  }

  it('a literal href="/…" in client code is the reload bug waiting to happen', () => {
    const offenders = tsxFiles(join(__dirname, '..', 'src')).filter((f) =>
      /href=["'`]\/[a-z]/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the About panel routes its links through the resolver', () => {
    const src = readFileSync(join(__dirname, '..', 'src/components/panels/AboutPanel.tsx'), 'utf8');
    expect(src).toContain('openLegalLink(link.href)');
  });
});

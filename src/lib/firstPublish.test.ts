import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { celebrationFor, whatsappShareUrl, shareText, prettyUrl, FIREWORK_MS } from './firstPublish';

const base = { firstPublish: true, url: 'https://demo.mitrify.in', linkLive: true, reducedMotion: false };

describe('celebrationFor — a celebration must be rare, and must be true', () => {
  it("celebrates the user's first live link", () => {
    expect(celebrationFor(base)).toBe('celebrate');
  });

  it('never celebrates a later publish — rarity is the whole point', () => {
    expect(celebrationFor({ ...base, firstPublish: false })).toBe('none');
  });

  it('refuses to celebrate when the link did NOT answer — it says "on its way" instead', () => {
    // A firework over a link that opens an error page is a worse first impression than no firework,
    // and it is the fake-success this repo forbids.
    expect(celebrationFor({ ...base, linkLive: false })).toBe('pending');
  });

  it('still celebrates when the CHECK could not run — our blindness is not the app being broken', () => {
    // Offline, blocked, or too slow: the server already confirmed the publish. Only an answered "no"
    // downgrades the moment.
    expect(celebrationFor({ ...base, linkLive: null })).toBe('celebrate');
  });

  it('honours a user who asked for reduced motion — the card, without the particles', () => {
    expect(celebrationFor({ ...base, reducedMotion: true })).toBe('calm');
    // And that preference still cannot turn an unverified link into a celebration.
    expect(celebrationFor({ ...base, reducedMotion: true, linkLive: false })).toBe('pending');
  });

  it('shows nothing when there is no link to show', () => {
    expect(celebrationFor({ ...base, url: '' })).toBe('none');
    expect(celebrationFor({ ...base, url: '   ' })).toBe('none');
  });
});

describe('sharing — the first thing anyone does with their first link', () => {
  it('builds a WhatsApp link with the URL encoded exactly once', () => {
    const share = whatsappShareUrl('https://demo.mitrify.in');
    expect(share.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(share.split('text=')[1])).toContain('https://demo.mitrify.in');
    expect(share).not.toContain('%2520'); // double-encoding would break the link in WhatsApp
  });

  it('names the app when we know it, and stays personal when we do not', () => {
    expect(shareText('https://x.in', 'Chai Counter')).toContain('Chai Counter');
    expect(shareText('https://x.in')).toContain('my first app');
    expect(shareText('https://x.in')).toContain('NavBharatAI');
  });

  it('shows the host, not the scheme — a headline does not need https://', () => {
    expect(prettyUrl('https://demo.mitrify.in/')).toBe('demo.mitrify.in');
    expect(prettyUrl('http://a.b/c')).toBe('a.b/c');
  });
});

// ── The wiring ───────────────────────────────────────────────────────────────
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), 'utf8'));

describe('the moment is wired end to end', () => {
  it('the SERVER decides "first", and reads it BEFORE the deploy writes the record', () => {
    const route = src('src/server/routes/agentv3.ts');
    const at = route.indexOf("'/api/agentv3/publish'");
    expect(at).toBeGreaterThan(-1);
    const handler = route.slice(at, route.indexOf('app.get(', at));
    const firstCheck = handler.indexOf('listByUser');
    const deploy = handler.indexOf("dispatch({ id: 'publish'");
    expect(firstCheck).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    // The deploy writes the very record that makes the answer "no" — asking afterwards would mean
    // nobody is ever celebrated.
    expect(firstCheck).toBeLessThan(deploy);
    expect(handler).toContain('firstPublish: true');
  });

  it('the client never invents "first" from browser storage', () => {
    // A localStorage flag would congratulate the same person again on a new phone, and rob them of
    // the moment entirely if they cleared their browser.
    const panel = src('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('data?.firstPublish === true');
    expect(panel).not.toMatch(/localStorage[^\n]*first[_-]?publish/i);
  });

  it('the link is probed before the word "live" is used', () => {
    expect(src('src/components/agentv3/AgentV3Panel.tsx')).toContain('probeLive');
  });

  it('the card is portalled to the body with an explicit z-index', () => {
    // `position: fixed` stops being viewport-relative under any transformed ancestor, and this is
    // launched from inside the publish sheet. The App Mart player already paid for this lesson.
    const card = src('src/components/agentv3/PublishCelebration.tsx');
    expect(card).toContain("createPortal");
    expect(card).toContain('document.body');
    expect(card).toContain('CELEBRATION_Z');
  });

  it('the particles stop, but the link does not go with them', () => {
    const card = src('src/components/agentv3/PublishCelebration.tsx');
    // The timer must clear the PARTICLES, never the card itself.
    expect(card).toContain('setShowParticles(false)');
    expect(card).not.toContain('setTimeout(onClose');
    expect(FIREWORK_MS).toBeLessThanOrEqual(4000);
  });

  it('brings no animation dependency with it', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['canvas-confetti', 'react-confetti', 'party-js', 'tsparticles']) {
      expect(deps[banned]).toBeUndefined();
    }
  });

  it('makes no sound', () => {
    const card = src('src/components/agentv3/PublishCelebration.tsx');
    expect(card).not.toMatch(/new Audio|\.play\(\)|<audio/);
  });
});

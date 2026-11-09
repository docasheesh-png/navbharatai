// BR1960 (report 1946f797, 2026-11-08) — "Create a html code of youtube seo generator".
//
// APP_SCOPE recorded "LARGE — clone of YouTube" for a single-screen SEO tag generator (complexity 15,
// "simple"). That sent the build through the mega-roadmap planner: an extra 8.8 s model call, a
// "YouTube SEO is a big app" message and a 5-step roadmap — for a tool that fits in one screen.
//
// The class: a product named in front of a TOOL noun ("YouTube SEO generator", "Instagram caption
// generator", "WhatsApp chat analyzer", "Uber fare calculator") names the thing the tool WORKS ON, not
// the product to clone. A likeness word ("like", "jaisa", "clone", "copy") still wins either side.
//
// Side-effect measurement (t311u): every prompt-like string in the test suite plus 1,524 real report
// app labels (78,007 strings) were scored with origin/main's analyzer and this one. Exactly ONE scope
// decision changed — the BR1960 prompt itself (analyze → direct). Famous-app detections 179 → 178.
import { describe, it, expect } from 'vitest';
import { analyzeAppScope, namesAsProduct, scopeVerdict } from '../src/server/lib/appScopeAnalyzer';

const BR1960_PROMPT = 'Create a html code of youtube seo generator';
const YOUTUBE = /\byou\s?tube\b/i;

describe('a tool FOR a product is not a clone of it', () => {
  it('the BR1960 prompt builds directly, with no clone reason', () => {
    const s = analyzeAppScope(BR1960_PROMPT);
    expect(s.famousApp).toBeNull();
    expect(s.decision).toBe('direct');
    expect(s.signals.join(' ')).not.toMatch(/clone/);
  });

  it('the verdict every big-app strategy reads is not LARGE, so the roadmap planner is not asked', () => {
    // BR1960 ran with complexity "simple"; scopeDispute could not stand the clone down (no small-app word).
    const v = scopeVerdict(BR1960_PROMPT, { complex: false });
    expect(v.large).toBe(false);
    expect(v.projectMode).toBe(false);
  });

  it.each([
    'youtube seo generator', 'YouTube tag generator', 'YouTube title generator', 'youtube video downloader',
    'YouTube thumbnail downloader', 'YouTube earnings calculator', 'YouTube shorts script generator',
  ])('"%s" names what the tool works on', (p) => expect(namesAsProduct(p, YOUTUBE)).toBe(false));

  it.each([
    'Instagram caption generator', 'Instagram hashtag generator', 'WhatsApp chat analyzer',
    'Uber fare calculator app', 'Amazon price tracker', 'Spotify playlist maker',
  ])('not a clone: %s', (p) => {
    const s = analyzeAppScope(p);
    expect(s.famousApp).toBeNull();
    expect(s.signals.join(' ')).not.toMatch(/clone/);
  });
});

describe('🔒 neighbours: a real clone request still escalates', () => {
  it.each([
    ['build a youtube clone', 'YouTube'],
    ['make a YouTube clone with a tag generator', 'YouTube'],
    ['YouTube jaisa SEO generator banao', 'YouTube'],
    ['Netflix clone', 'Netflix'],
    ['Build me an Instagram', 'Instagram'],
    ['an app like Instagram with a caption generator', 'Instagram'],
  ])('%s → %s', (p, app) => {
    const s = analyzeAppScope(p);
    expect(s.famousApp).toBe(app);
    expect(s.decision).not.toBe('direct');
  });

  it.each(['build a youtube clone', 'Netflix clone', 'YouTube jaisa SEO generator banao'])('scopeVerdict stays LARGE: %s', (p) => {
    expect(scopeVerdict(p, { complex: true }).large).toBe(true);
  });

  it('a tool noun far from the name does not shield a clone ask', () => {
    expect(namesAsProduct('Make YouTube for kids, with a keyword generator later', YOUTUBE)).toBe(true);
  });
});

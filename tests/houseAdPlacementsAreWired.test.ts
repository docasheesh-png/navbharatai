// HOUSE ADS — every place the admin can tick is a place that really draws an ad, and no other place does
// (admin 2026-10-20). A source census, because none of this is visible to `tsc`:
//
//   1. A tick box for a place nothing draws would be a control that lies. Every placement in
//      HOUSE_AD_PLACEMENTS must be named by at least one screen; a new placement with no screen fails here.
//   2. THE EXACT SET OF FILES THAT MAY DRAW AN AD. The admin ruled the builder, chat, the player and every
//      user's own app out. A new file that imports the ad component must be added here on purpose, with the reason.
//   3. An ad is never an overlay: no fixed/absolute/z-index, no portal, no modal in the ad component.
//   4. It always says "Sponsored", and with no link there is no button.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HOUSE_AD_PLACEMENTS } from '../src/lib/houseAds';
import { sourceCensusFiles } from './helpers/sourceCensus';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SRC = sourceCensusFiles(join(ROOT, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p), ['node_modules'])
  .map((p) => relative(ROOT, p).replace(/\\/g, '/'));

/** Every screen that draws an ad, with the place it draws and why it is allowed to. */
const DRAWS_ADS: Record<string, { placements: string[]; why: string }> = {
  'src/components/ide/NavAppStore.tsx': { placements: ['mart_tile', 'publish_success', 'mart_banner'], why: 'App Mart: a Sponsored tile between the app tiles, a banner under the post-success message, and the phone app\'s bottom banner' },
  'src/components/home/HomeView.tsx': { placements: ['dashboard'], why: 'Home: one small banner at the bottom, in the flow' },
  'src/components/agentv3/PublishCelebration.tsx': { placements: ['publish_success'], why: 'the publish success card: a banner below the link and the buttons' },
  'src/components/ide/PublishToNavStore.tsx': { placements: ['publish_success'], why: 'the post-to-App-Mart success message: a banner below it' },
  'src/components/admin/AdsPanel.tsx': { placements: ['dashboard'], why: 'the admin\'s PREVIEW: it feeds the real banner and tile the picture about to be saved (placement is not used to fetch)' },
};
/** The ad components themselves. */
const PLUMBING = new Set([
  'src/components/ads/SponsoredAd.tsx', 'src/components/ads/useHouseAd.ts',
  'src/lib/houseAds.ts', 'src/lib/houseAdClient.ts', 'src/lib/houseAdForm.ts', 'src/lib/houseAdImage.ts',
]);

describe('1 — every place the admin can tick is drawn by a screen', () => {
  it.each([...HOUSE_AD_PLACEMENTS])('placement %s is named by at least one screen that draws it', (p) => {
    const drawn = Object.entries(DRAWS_ADS).filter(([f, v]) => v.placements.includes(p) && f !== 'src/components/admin/AdsPanel.tsx');
    expect(drawn.length, `${p} has no screen`).toBeGreaterThan(0);
    for (const [file] of drawn) expect(code(read(file)), `${file} does not draw ${p}`).toMatch(new RegExp(`placement="${p}"|useHouseAd\\('${p}'\\)`));
    // …and the hook/fetch alone is not enough: the file must really render the component or the tile.
    for (const [file] of drawn) expect(code(read(file))).toMatch(/<Sponsored(Banner|Tile)\b/);
  });

  it('a screen\'s declared places are exactly the places it draws (no undeclared one)', () => {
    for (const [file, v] of Object.entries(DRAWS_ADS)) {
      if (file === 'src/components/admin/AdsPanel.tsx') continue;
      const named = [...code(read(file)).matchAll(/(?:placement=|useHouseAd\()"?'?([a-z_]+)/g)].map((m) => m[1]).filter((n) => (HOUSE_AD_PLACEMENTS as readonly string[]).includes(n));
      expect([...new Set(named)].sort(), file).toEqual([...v.placements].sort());
    }
  });
});

describe('2 — only the listed screens may draw an ad', () => {
  it('the set of files that import the ad component or hook is exactly the allowlist', () => {
    const users = SRC.filter((f) => !PLUMBING.has(f) && /from '[^']*ads\/(SponsoredAd|useHouseAd)'/.test(read(f))).sort();
    expect(users).toEqual(Object.keys(DRAWS_ADS).sort());
  });

  it('the builder, chat, the app player and every user-app surface never draw one', () => {
    const FORBIDDEN = [
      /^src\/components\/agentv3\/(?!PublishCelebration)/,   // the builder, its chat, preview and build progress
      /^src\/components\/ide\/WebAppPlayer\.tsx$/,           // a creator's own app, running
      /^src\/components\/panels\/(SettingsPanel|BillingPanel|SecretsPanel)/,
      /^src\/components\/wallet\//,                          // payments and the wallet
      /^src\/components\/chat\//,
      /^src\/server\//,                                      // generated apps and server pages
    ];
    const offenders = SRC.filter((f) => FORBIDDEN.some((re) => re.test(f)) && /SponsoredAd|useHouseAd|houseAdClient/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('nothing generated into a user\'s app can carry NavBharatAI\'s own ad component', () => {
    const generators = SRC.filter((f) => /^src\/server\/AgentV3\//.test(f));
    expect(generators.filter((f) => /SponsoredAd|houseAds|api\/ads\//.test(read(f)))).toEqual([]);
  });
});

describe('3 — an ad is never an overlay', () => {
  const AD = read('src/components/ads/SponsoredAd.tsx');
  const AD_CODE = code(AD);

  it('no fixed or absolute positioning, no z-index, no portal, no modal', () => {
    expect(AD_CODE).not.toMatch(/\b(fixed|absolute|sticky)\b/);
    expect(AD_CODE).not.toMatch(/\bz-\[?\d|\bz-(10|20|30|40|50)\b/);
    expect(AD_CODE).not.toMatch(/createPortal|role="dialog"|aria-modal|inset-0/);
  });

  it('uses theme tokens and no colour literals', () => {
    expect(AD_CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|text-white|bg-white|bg-black|\b(?:bg|text|border)-(?:red|green|blue|gray|slate|indigo|emerald)-\d{2,3}\b/);
  });
});

describe('4 — it says what it is, and a link-less ad has no button', () => {
  const AD_CODE = code(read('src/components/ads/SponsoredAd.tsx'));

  it('every ad shape carries the visible "Sponsored" label and an aria-label', () => {
    expect(AD_CODE.match(/<SponsoredLabel \/>/g)?.length).toBeGreaterThanOrEqual(2); // the banner and the tile
    expect(AD_CODE).toContain('Sponsored');
    expect(AD_CODE.match(/aria-label="Sponsored"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('every link is rel="noopener noreferrer sponsored" and opens in a new tab', () => {
    const anchors = AD_CODE.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    for (const a of anchors) { expect(a).toContain('rel="noopener noreferrer sponsored"'); expect(a).toContain('target="_blank"'); }
  });

  it('the "Learn more" button exists ONLY when the ad has a link', () => {
    expect(AD_CODE).toMatch(/\{ad\.linkUrl && \(\s*<a\b/);
    expect(AD_CODE).toMatch(/if \(!ad\.linkUrl\) return <div/);
  });

  it('a picture that fails to load hides the WHOLE ad, never a broken-image box', () => {
    expect(AD_CODE).toContain('onError={onBroken}');
    expect(AD_CODE.match(/if \(!ad \|\| broken\) return null|if \(broken\) return null/g)?.length).toBe(2);
  });
});

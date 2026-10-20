// HOUSE ADS — the rules both sides share (src/lib/houseAds.ts, houseAdForm.ts, houseAdImage.ts).
// Admin 2026-10-20: "admin apne kisi saman ka ads chala sake — naam, description aur photo upload kare, aur
// user ko woh ads dikhne lage."
//
// What this holds, none of which `tsc` can see:
//   1. What the admin may save: a valid ad, and each reason one is refused.
//   2. A link is https-only — it ends up in an `href`, so `javascript:` / `http:` / credentials never get in.
//   3. Which ad a screen shows: only LIVE ads for THAT place, and the status chip and the public list use ONE rule.
//   4. A server answer is not an ad until its shape is checked.
//   5. Every place the admin can tick is a place that exists (the public pages are deliberately absent).
import { describe, it, expect } from 'vitest';
import {
  HOUSE_AD_PLACEMENTS, PLACEMENT_INFO, HOUSE_AD_NAME_MAX, HOUSE_AD_DESCRIPTION_MAX,
  cleanHttpsLink, parseHouseAdInput, houseAdStatus, adInWindow, pickHouseAd, parseServedHouseAd, isHouseAdPlacement,
} from '../src/lib/houseAds';
import { adBodyFromForm, emptyForm, toDateInput, lastDayShown, nextDayStart, STATUS_VIEW } from '../src/lib/houseAdForm';
import { coverCrop, dataUrlBytes, sourceFileProblem, HOUSE_AD_SOURCE_MAX_BYTES } from '../src/lib/houseAdImage';

const GOOD = {
  name: 'Kumar Spices', description: 'Fresh masalas from Kerala, delivered across India.', linkUrl: 'https://kumarspices.in/offer',
  placements: ['mart_tile', 'dashboard'], enabled: true, startsAt: null, endsAt: null, imageDataUrl: 'data:image/jpeg;base64,AAAA',
};

describe('1 — what the admin may save', () => {
  it('accepts a complete ad and keeps the places in the canonical order', () => {
    const r = parseHouseAdInput({ ...GOOD, placements: ['dashboard', 'mart_tile'] }, { requireImage: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.placements).toEqual(['mart_tile', 'dashboard']);
      expect(r.value.linkUrl).toBe('https://kumarspices.in/offer');
    }
  });

  it('collapses stray whitespace in the name and description', () => {
    const r = parseHouseAdInput({ ...GOOD, name: '  Kumar    Spices  ', description: ' a \n b ' }, { requireImage: true });
    expect(r.ok && r.value.name).toBe('Kumar Spices');
    expect(r.ok && r.value.description).toBe('a b');
  });

  it.each([
    ['no name', { name: '   ' }, /name/i],
    ['a name over the limit', { name: 'x'.repeat(HOUSE_AD_NAME_MAX + 1) }, /at most/],
    ['no description', { description: '' }, /description/i],
    ['a description over the limit', { description: 'x'.repeat(HOUSE_AD_DESCRIPTION_MAX + 1) }, /at most/],
    ['no place chosen', { placements: [] }, /at least one place/],
    ['a place that does not exist', { placements: ['mart_tile', 'everywhere'] }, /not a real place/],
    ['the public pages, which are deliberately not a place', { placements: ['public_pages'] }, /not a real place/],
    ['an on/off that is not a yes or a no', { enabled: 'yes' }, /on or off/],
    ['an end that is not after the start', { startsAt: 2000, endsAt: 1000 }, /after the start/],
    ['a start that is not a date', { startsAt: 'soon' }, /not a real date/],
  ])('refuses %s', (_why, patch, message) => {
    const r = parseHouseAdInput({ ...GOOD, ...patch }, { requireImage: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('needs a picture to CREATE and not to EDIT (an edit without one keeps the stored picture)', () => {
    const { imageDataUrl: _drop, ...noPicture } = GOOD;
    expect(parseHouseAdInput(noPicture, { requireImage: true }).ok).toBe(false);
    const edit = parseHouseAdInput(noPicture, { requireImage: false });
    expect(edit.ok).toBe(true);
    expect(edit.ok && edit.value.imageDataUrl).toBeUndefined();
  });

  it('a body that is not an object is refused, not crashed on', () => {
    for (const bad of [null, undefined, 'x', 42, []]) expect(parseHouseAdInput(bad, { requireImage: true }).ok).toBe(false);
  });
});

describe('2 — a link is https only, because it ends up in an href', () => {
  it('accepts a normal https link', () => {
    expect(cleanHttpsLink('https://shop.example.in/a?b=1')).toBe('https://shop.example.in/a?b=1');
  });

  it.each([
    'javascript:alert(1)', 'http://shop.example.in', 'data:text/html,<script>1</script>', '//shop.example.in', '/relative/path',
    'https://user:pass@shop.example.in', 'https://localhost', 'ftp://shop.example.in', '', '   ',
  ])('refuses %j', (bad) => {
    expect(cleanHttpsLink(bad)).toBeNull();
  });

  it('refuses a link over the length limit and a non-string', () => {
    expect(cleanHttpsLink(`https://a.in/${'x'.repeat(600)}`)).toBeNull();
    expect(cleanHttpsLink(42 as unknown)).toBeNull();
  });

  it('a link the admin typed wrongly is an error, not silently dropped', () => {
    const r = parseHouseAdInput({ ...GOOD, linkUrl: 'http://insecure.example.in' }, { requireImage: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/https/);
  });

  it('an empty link is a plain ad with no link', () => {
    const r = parseHouseAdInput({ ...GOOD, linkUrl: '' }, { requireImage: true });
    expect(r.ok && r.value.linkUrl).toBeNull();
  });
});

describe('3 — which ad a screen shows, and what the status chip says', () => {
  const NOW = Date.UTC(2026, 9, 20, 12);
  const ad = (over: Record<string, unknown> = {}) => ({ id: 'a', enabled: true, startsAt: null, endsAt: null, placements: ['mart_tile'], ...over });

  it('the status is one rule: off beats everything, then the dates', () => {
    expect(houseAdStatus({ enabled: false, startsAt: null, endsAt: null }, NOW)).toBe('off');
    expect(houseAdStatus({ enabled: false, startsAt: NOW + 1, endsAt: null }, NOW)).toBe('off');
    expect(houseAdStatus({ enabled: true, startsAt: NOW + 1, endsAt: null }, NOW)).toBe('scheduled');
    expect(houseAdStatus({ enabled: true, startsAt: null, endsAt: NOW }, NOW)).toBe('ended');
    expect(houseAdStatus({ enabled: true, startsAt: NOW, endsAt: NOW + 1 }, NOW)).toBe('live');
    expect(houseAdStatus({ enabled: true, startsAt: null, endsAt: null }, NOW)).toBe('live');
  });

  it('every status has a label and a colour token (never a literal colour)', () => {
    for (const s of ['live', 'off', 'scheduled', 'ended'] as const) {
      expect(STATUS_VIEW[s].label).toBeTruthy();
      expect(STATUS_VIEW[s].tone).toMatch(/^text-(success|muted|info|warn)$/);
    }
  });

  it('the window includes its start and excludes its end', () => {
    expect(adInWindow({ startsAt: NOW, endsAt: NOW + 10 }, NOW)).toBe(true);
    expect(adInWindow({ startsAt: NOW, endsAt: NOW + 10 }, NOW + 10)).toBe(false);
    expect(adInWindow({ startsAt: NOW + 5, endsAt: null }, NOW)).toBe(false);
  });

  it('only a LIVE ad for THAT place competes', () => {
    const ads = [
      ad({ id: 'off', enabled: false }),
      ad({ id: 'later', startsAt: NOW + 1000 }),
      ad({ id: 'over', endsAt: NOW - 1 }),
      ad({ id: 'elsewhere', placements: ['dashboard'] }),
      ad({ id: 'live' }),
    ];
    expect(pickHouseAd(ads, 'mart_tile', NOW, () => 0)?.id).toBe('live');
    expect(pickHouseAd(ads, 'dashboard', NOW, () => 0)?.id).toBe('elsewhere');
    expect(pickHouseAd(ads, 'publish_success', NOW, () => 0)).toBeNull();
    expect(pickHouseAd([], 'mart_tile', NOW)).toBeNull();
  });

  it('two live ads in one place SHARE it instead of the first one owning it', () => {
    const ads = [ad({ id: 'first' }), ad({ id: 'second' })];
    expect(pickHouseAd(ads, 'mart_tile', NOW, () => 0)?.id).toBe('first');
    expect(pickHouseAd(ads, 'mart_tile', NOW, () => 0.99)?.id).toBe('second');
    expect(pickHouseAd(ads, 'mart_tile', NOW, () => 1)?.id).toBe('second'); // an out-of-range random is clamped, not undefined
  });
});

describe('4 — a server answer is not an ad until its shape is checked', () => {
  const served = { id: 'ad_0123456789ab', name: 'Kumar Spices', description: 'Fresh masalas.', linkUrl: 'https://kumarspices.in/', imageUrl: '/api/ads/image/ad_0123456789ab?v=1' };

  it('accepts the exact shape, with or without a link', () => {
    expect(parseServedHouseAd({ ad: served })).toEqual(served);
    expect(parseServedHouseAd({ ad: { ...served, linkUrl: null } })?.linkUrl).toBeNull();
  });

  it.each([
    ['no ad', { ad: null }],
    ['no body', null],
    ['a string body', 'ad'],
    ['no name', { ad: { ...served, name: '' } }],
    ['no description', { ad: { ...served, description: undefined } }],
    ['a picture from another host', { ad: { ...served, imageUrl: 'https://evil.example/pixel.png' } }],
    ['a picture path that is not the ad picture route', { ad: { ...served, imageUrl: '/api/other' } }],
    ['an http link', { ad: { ...served, linkUrl: 'http://x.example.in' } }],
    ['a javascript link', { ad: { ...served, linkUrl: 'javascript:alert(1)' } }],
  ])('treats %s as NO ad', (_why, body) => {
    expect(parseServedHouseAd(body)).toBeNull();
  });
});

describe('5 — every place the admin can tick is a place that exists', () => {
  it('every placement is described, and the id check agrees', () => {
    for (const p of HOUSE_AD_PLACEMENTS) {
      expect(PLACEMENT_INFO[p].label).toBeTruthy();
      expect(PLACEMENT_INFO[p].where).toBeTruthy();
      expect(isHouseAdPlacement(p)).toBe(true);
    }
    expect(Object.keys(PLACEMENT_INFO).sort()).toEqual([...HOUSE_AD_PLACEMENTS].sort());
  });

  it('the server-rendered public pages are NOT a place (they cannot tell who has paid)', () => {
    expect(isHouseAdPlacement('public_pages')).toBe(false);
    expect([...HOUSE_AD_PLACEMENTS]).not.toContain('public_pages');
  });
});

describe('the admin form → request body', () => {
  it('a new ad starts ticked everywhere and turned on', () => {
    const f = emptyForm();
    expect(f.placements).toEqual([...HOUSE_AD_PLACEMENTS]);
    expect(f.enabled).toBe(true);
  });

  it('the end date is INCLUSIVE: the stored end is the next local midnight, and the form reads it back as the same day', () => {
    const body = adBodyFromForm({ ...emptyForm(), name: 'a', description: 'b', startDate: '2026-10-21', endDate: '2026-10-25', imageDataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(body.startsAt).toBe(new Date(2026, 9, 21).getTime());
    expect(body.endsAt).toBe(new Date(2026, 9, 26).getTime());
    expect(toDateInput(lastDayShown(body.endsAt as number))).toBe('2026-10-25');
    expect(nextDayStart('2026-10-31')).toBe(new Date(2026, 10, 1).getTime()); // month roll-over
  });

  it('no dates means no dates; no new picture means the body carries none', () => {
    const body = adBodyFromForm({ ...emptyForm(), name: 'a', description: 'b' });
    expect(body.startsAt).toBeNull();
    expect(body.endsAt).toBeNull();
    expect('imageDataUrl' in body).toBe(false);
    expect(body.linkUrl).toBeNull();
  });
});

describe('the picture is cropped to the middle of a 4:1 strip', () => {
  it('a wide picture loses its sides, a tall one its top and bottom, an exact one nothing', () => {
    expect(coverCrop(2000, 300, 1200, 300)).toEqual({ sx: 400, sy: 0, sw: 1200, sh: 300 });
    expect(coverCrop(1200, 1200, 1200, 300)).toEqual({ sx: 0, sy: 450, sw: 1200, sh: 300 });
    expect(coverCrop(1200, 300, 1200, 300)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 300 });
  });

  it('measures a data URL without decoding it', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('nonsense')).toBe(0);
  });

  it('refuses a source that is the wrong type or absurdly large before reading a pixel', () => {
    expect(sourceFileProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/JPG, PNG or WebP/);
    expect(sourceFileProblem({ type: 'application/pdf', size: 10 })).toMatch(/JPG, PNG or WebP/);
    expect(sourceFileProblem({ type: 'image/png', size: HOUSE_AD_SOURCE_MAX_BYTES + 1 })).toMatch(/too large/);
    expect(sourceFileProblem({ type: 'image/webp', size: 1024 })).toBeNull();
  });
});

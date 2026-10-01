import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  indianPeopleDirective, depictsPeople, namesOtherOrigin,
  INDIAN_PEOPLE_DIRECTION, INDIAN_PEOPLE_CONDITIONAL, INDIAN_PEOPLE_NEGATIVE,
} from '../src/server/lib/imagePeople';
import { craftImagePrompt, withInlineNegative } from '../src/server/lib/imagePromptCraft';
import { feedFor, isPaidItem } from '../src/lib/imageFeed';

/**
 * TWO UNBREAKABLE RULES (admin 2026-10-01), from one screenshot: a PAID picture carrying the free
 * provider's watermark, of an East Asian face.
 *
 *   1. *"jab tak specific kaha na jaye, tab tak indian face banane chahiye … result me 100% indian
 *      human ana chahiye … yeh un breckbale rule hai"*
 *   2. *"paid me logo nahi hoga! na navbharatai ka na kisi aur ka"*
 *
 * Each had its own cause, and neither was the engine:
 *   • The Indian rule reached only briefs whose words were on a deliberately NARROW list, and it
 *     carried no NEGATIVE at all — a lone positive sentence against a diffusion model's face prior.
 *   • Free and Paid shared one screen AND one feed, and the chip did not regenerate, so a free
 *     picture (fetched with no account key, where the provider's `nologo` is not honoured) sat under
 *     a lit PAID chip.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE FACE
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('every face is Indian — the words the old list left out', () => {
  // THE SCREENSHOT'S OWN BRIEF, and its family. Not one of these words is in `PEOPLE_WORDS`:
  // `worker`, `driver`, `vendor`, `cook`, `seller`, `player`, `officer`, `artist` and a bare
  // `portrait` were all excluded on purpose, because the EMPHATIC sentence could put a stranger into
  // a picture of an object. So each of these reached the engine with nothing about who the person is.
  it.each([
    'delivery worker wearing a mask',
    'factory worker in a safety vest',
    'construction worker on a site',
    'auto driver waiting for a passenger',
    'street vendor selling fruit',
    'a cook in a kitchen',
    'shop seller behind a counter',
    'police officer on duty',
    'portrait, studio lighting',
    'two people walking in the rain',
  ])('"%s" is told the person is Indian', (p) => {
    const d = indianPeopleDirective(p);
    expect(d, p).not.toBeNull();
    expect(d!.direction.toLowerCase()).toContain('indian');
    expect(d!.negative).toBe(INDIAN_PEOPLE_NEGATIVE);
  });

  it('reaches the engine on the real brief, in BOTH halves', () => {
    const c = craftImagePrompt({
      prompt: 'Photograph — delivery worker wearing a mask',
      style: 'photo', type: 'Photograph', size: 'square',
    });
    expect(c.prompt.toLowerCase()).toContain('indian');
    // THE HALF THAT WAS MISSING ENTIRELY: the negative.
    expect(c.negative).toContain('east asian face');
    // …and it survives into the single string the free provider is sent.
    expect(withInlineNegative(c).toLowerCase()).toContain('east asian face');
  });

  it('the EMPHATIC wording is kept where a person really is named', () => {
    const d = indianPeopleDirective('a boy flying a kite');
    expect(d!.named).toBe(true);
    expect(d!.direction).toBe(INDIAN_PEOPLE_DIRECTION);
  });

  it('the CONDITIONAL wording is used where one is merely possible', () => {
    const d = indianPeopleDirective('delivery worker wearing a mask');
    expect(d!.named).toBe(false);
    expect(d!.direction).toBe(INDIAN_PEOPLE_CONDITIONAL);
  });

  // 🔒 THE PROPERTY THAT MAKES BROAD APPLICATION SAFE, and the reason the word list no longer gates
  // coverage: the conditional sentence constrains a person who is already there. It cannot add one.
  it('the conditional sentence can never invent a person', () => {
    expect(INDIAN_PEOPLE_CONDITIONAL).toMatch(/^If any person appears/);
    expect(INDIAN_PEOPLE_CONDITIONAL).not.toMatch(/\bEvery person\b/);
  });

  it.each([
    'cat face', "a dog's face", 'face wash bottle product photo', 'a bowl of biryani',
    'sunset over the mountains', 'media player app icon', 'service worker diagram', 'best seller badge',
  ])('"%s" still gets no EMPHATIC sentence — nobody is put into it', (p) => {
    const d = indianPeopleDirective(p);
    expect(d!.named, p).toBe(false);
    expect(craftImagePrompt({ prompt: p }).prompt, p).not.toContain(INDIAN_PEOPLE_DIRECTION);
  });

  // THE HALF THAT HAS NEVER CHANGED, and must not: the user's own words win.
  it.each([
    'a Japanese chef cooking ramen', 'an African dancer', 'a diverse team of people', 'Chinese girl',
    'European tourist', 'blonde girl', 'spiderman on a building', 'a robot waving', 'asian man',
  ])('"%s" names somebody else — nothing is added at all', (p) => {
    expect(indianPeopleDirective(p), p).toBeNull();
    const c = craftImagePrompt({ prompt: p, style: 'photo' });
    expect(c.prompt, p).not.toContain(INDIAN_PEOPLE_DIRECTION);
    expect(c.prompt, p).not.toContain(INDIAN_PEOPLE_CONDITIONAL);
    expect(c.negative, p).not.toContain('east asian face');
  });

  it('"south asian", "indian" and plain colours are not another origin', () => {
    for (const p of ['south asian man', 'indian bride', 'a girl in a black dress', 'man on a white background']) {
      expect(namesOtherOrigin(p), p).toBe(false);
      expect(indianPeopleDirective(p), p).not.toBeNull();
    }
  });

  // A UI screenshot and a background used to get NOTHING, because "student" there names a domain.
  // They now get the conditional sentence, which is strictly more and still cannot people a dashboard.
  it('a dashboard gets the conditional sentence, never the emphatic one', () => {
    const c = craftImagePrompt({ prompt: 'student management dashboard', type: 'UI screenshot' });
    expect(c.indianPeople).toBe(false);
    expect(c.prompt).not.toContain(INDIAN_PEOPLE_DIRECTION);
    expect(c.prompt).toContain(INDIAN_PEOPLE_CONDITIONAL);
  });

  it('the negative is short — this module pays for long inline negatives in sharpness', () => {
    expect(INDIAN_PEOPLE_NEGATIVE.split(',').length).toBeLessThanOrEqual(6);
  });

  // REVERSION GUARD. `tsc` and `vitest` cannot see a rule that is merely never applied, which is how
  // the negative came to be missing for a month: it was written, documented, and wired to nothing.
  it('the craft layer really reads both halves of the directive', () => {
    const src = readFileSync(join(__dirname, '../src/server/lib/imagePromptCraft.ts'), 'utf8');
    expect(src).toContain('indianPeopleDirective(base');
    expect(src).toContain('indian ? indian.negative : ');
  });

  it('depictsPeople itself is unchanged — the precision lock still holds', () => {
    expect(depictsPeople('a boy')).toBe(true);
    expect(depictsPeople('service worker diagram')).toBe(false);
    expect(depictsPeople('best seller badge')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2 · THE PAGE (and the watermark that rode in on it)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('Paid is a page, and it shows only its own pictures', () => {
  const free = { id: 'f', tier: 'free' as const };
  const paid = { id: 'p', tier: 'paid' as const };
  const legacy = { id: 'l' }; // saved before 2026-10-01

  it('a FREE picture can never appear on the paid screen — the watermark rule', () => {
    expect(feedFor([free, paid, legacy], 'paid')).toEqual([paid]);
  });

  it('the free screen keeps everything else, including anything saved before this shipped', () => {
    expect(feedFor([free, paid, legacy], 'free')).toEqual([free, legacy]);
  });

  it('an item of unknown origin is treated as free — the no-logo screen takes no guesses', () => {
    expect(isPaidItem(legacy)).toBe(false);
    expect(isPaidItem(undefined)).toBe(false);
    expect(feedFor([legacy], 'paid')).toEqual([]);
  });

  it('order is preserved, so the thread still reads newest-against-the-box', () => {
    const a = { id: 'a', tier: 'paid' as const };
    const b = { id: 'b', tier: 'paid' as const };
    expect(feedFor([a, free, b], 'paid')).toEqual([a, b]);
  });

  it('junk in, nothing out', () => {
    expect(feedFor(null as never, 'paid')).toEqual([]);
    expect(feedFor([], 'free')).toEqual([]);
  });
});

describe('the screen is wired to the rule', () => {
  const ui = readFileSync(join(__dirname, '../src/components/ide/AIImageGenerator.tsx'), 'utf8');

  it('every visit still opens on Free — the only default that cannot spend a balance', () => {
    expect(ui).toContain("useState<ImageTier>('free')");
  });

  it('paging runs on the PAGE\'s feed, never on the whole history', () => {
    expect(ui).toContain('feedFor(history, tier)');
    expect(ui).toContain('usePagedList(visibleHistory)');
    expect(ui).not.toContain('usePagedList(history)');
  });

  it('a picture records which page made it', () => {
    expect(ui).toContain('tier: tierNow');
  });

  // The chip is gone on purpose: a press that only lights a chip is what left a free picture under a
  // lit PAID label. Leaving the page is now a visible act with its own control.
  it('the in-place Free/Paid chip row is gone', () => {
    expect(ui).not.toContain('aria-label="Image mode"');
    expect(ui).toContain('Back to Free mode');
  });
});

describe('the route can finally say which engine drew a picture', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/imageGen.ts'), 'utf8');

  it('every rung names itself on delivery', () => {
    for (const engine of ['cloudflare-flux', 'free-provider (account key)', 'pro-host', 'gemini:${model}', 'grok:${gModel}']) {
      expect(route, engine).toContain(engine);
    }
  });

  it('the paid ladder is in the admin\'s order: Cloudflare, then the keyed provider, then the pro host', () => {
    // Measured at the DELIVER calls, which exist only at the rungs — an import line near the top of
    // the file would otherwise read as "the pro host comes first".
    const cf = route.indexOf("deliver(cr.image, false, 'cloudflare-flux')");
    const keyed = route.indexOf("deliver(pr.image, true, 'free-provider (account key)')");
    const pro = route.indexOf("deliver(hr.image, true, 'pro-host')");
    expect(cf).toBeGreaterThan(0);
    expect(cf).toBeLessThan(keyed);
    expect(keyed).toBeLessThan(pro);
  });

  // 🔒 WHITE-LABEL LAW. The vendor's name is for the admin and the server log, never for a user.
  it('the engine name reaches an ADMIN caller only', () => {
    expect(route).toContain('isAgentV3FreeUser(account.uid, account.email) ? { engine } : {}');
  });
});

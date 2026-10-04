/**
 * QUEUE Q-322: A LOOKBEHIND IN THE WEB BUNDLE TAKES ITS SCREEN DOWN ON iOS 15 – 16.3.
 *
 * Safari learned `(?<=…)` / `(?<!…)` in 16.4; our build targets safari14 and the phone app runs on
 * iOS 15. Vite turns such a literal into a `RegExp(...)` call, which THROWS when it runs. Found in the
 * built bundle on 2026-10-04: the Image Generator (four regexes, built at module load, so the whole
 * screen failed to open), the Dark Mode generator, and the chat's markdown library (every reply that
 * held an email address threw while rendering).
 *
 * The census that keeps the class closed runs on the BUILT bundle (`scripts/noLookbehindInBundle.mjs`,
 * part of `npm run test:bundle` in CI), because server modules and libraries reach the client too.
 * This file locks its parser and proves each rewrite reads exactly what the old regex read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error — a plain .mjs script with no type declarations.
import { findLookbehinds } from '../scripts/noLookbehindInBundle.mjs';
import { depictsPeople, namesOtherOrigin } from '../src/server/lib/imagePeople';
import { findAddress, findPhones } from '../src/lib/imageTextFromPrompt';
import {
  AUTOLINK_EMAIL_WITH_LOOKBEHIND,
  isAutolinkLiteralModule,
  patchAutolinkEmail,
} from '../src/lib/autolinkEmailPatch';

const ROOT = join(__dirname, '..');

describe('the bundle census reads regexes, not text', () => {
  it('finds a literal, a RegExp() string and a new RegExp() template', () => {
    const src = [
      'const a = /(?<![\\d])x/g;',
      'const b = RegExp("(?<=^)y", "g");',
      'const c = new RegExp(`(?<!${w})z`, "iu");',
    ].join('\n');
    expect(findLookbehinds(src).map((h: { pattern: string }) => h.pattern)).toEqual([
      '(?<![\\d])x', '(?<=^)y', '(?<!${…})z',
    ]);
  });

  it('ignores a regex engine that merely mentions the syntax, and a lookahead', () => {
    const src = 'if (s.lookingAt(`(?<=`)) parse(); const t = "(?<!x)"; const r = /(?=a)(?!b)(?<name>c)/;';
    expect(findLookbehinds(src)).toEqual([]);
  });
});

describe('the Image Generator people rules read exactly what they read before', () => {
  // The two old regexes, verbatim, run here on Node (which has lookbehind) as the reference.
  const OLD_FACE = new RegExp(
    "(?<![\\p{L}\\p{N}])(?<!(?:cat|kitten|dog|puppy|animal|lion|tiger|monkey|bear|panda|fox|owl|horse|cow|rabbit|bird|robot|clock|watch|emoji|smiley|cartoon|doll|teddy|pumpkin|moon|sun|rock|cliff|mountain|building|cube|coin|card)['’]?s?\\s)face(?![\\p{L}\\p{N}])(?!\\s+(?:mask|masks|wash|cream|creams|serum|serums|pack|packs|scrub|oil|powder|id|off|palm|paint|shield|value|card|cards|down|up)(?![\\p{L}\\p{N}]))",
    'iu',
  );
  const faceCases = [
    'a smiling face', 'face of a farmer', "cat's face", 'cat face', 'clock face on a tower', 'face wash bottle',
    'face mask', 'Face', 'surface of the moon', 'facebook ad', 'happy face, close up', 'robot face',
    "the doll's face", 'face face', 'interface design', 'a face  wash', 'bobcat face', 'puppys face',
  ];
  for (const p of faceCases) {
    it(`face: "${p}"`, () => {
      const old = OLD_FACE.test(p.normalize('NFKC'));
      // depictsPeople is true for a person's face (and for other person words, none of which are here).
      expect(depictsPeople(p)).toBe(old);
    });
  }

  it('"south asian" is still Indian-compatible; "asian" and "east asian" still name another origin', () => {
    expect(namesOtherOrigin('a south asian bride')).toBe(false);
    expect(namesOtherOrigin('a south-asian family')).toBe(false);
    expect(namesOtherOrigin('an asian chef')).toBe(true);
    expect(namesOtherOrigin('east asian students')).toBe(true);
    expect(namesOtherOrigin('a south asian and a chinese man')).toBe(true);
    expect(namesOtherOrigin('caucasian man')).toBe(true);
    expect(namesOtherOrigin('Asian')).toBe(true);
  });
});

describe('the phone and PIN reader gives back what the user wrote', () => {
  it('reads the number as written, at the start, after a label and after a word', () => {
    expect(findPhones('98765 43210 Sharma Sweets')).toEqual(['98765 43210']);
    expect(findPhones('phone:+91 98765-43210')).toEqual(['+91 98765-43210']);
    expect(findPhones('call 09876543210 now')).toEqual(['09876543210']);
    expect(findPhones('a, 9876543210 b, 8765432109')).toEqual(['9876543210', '8765432109']);
  });

  it('never pulls ten digits out of a longer run', () => {
    expect(findPhones('order 129876543210345')).toEqual([]);
    expect(findPhones('x19876543210')).toEqual([]);
  });

  it('a PIN is still found at the start of a line and after a word', () => {
    expect(findAddress('Shop 5, Rajouri Market, Delhi 110027')).toBe('Shop 5, Rajouri Market, Delhi 110027');
    expect(findAddress('poster 1100271 shop')).toBe('');
  });
});

describe('the chat markdown library no longer needs a lookbehind for an email', () => {
  const LIB = join(ROOT, 'node_modules/mdast-util-gfm-autolink-literal/lib/index.js');
  const TMP = join(ROOT, 'tests/.tmp-q322');
  let original: (md: string) => string[];
  let patched: (md: string) => string[];

  beforeAll(async () => {
    const source = readFileSync(LIB, 'utf8');
    const out = patchAutolinkEmail(source);
    expect(out).not.toBeNull();
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, 'patched.mjs');
    writeFileSync(file, out!);
    const { fromMarkdown } = await import('mdast-util-from-markdown');
    const { gfmAutolinkLiteral } = await import('micromark-extension-gfm-autolink-literal');
    const orig = await import('mdast-util-gfm-autolink-literal');
    const mine = await import(pathToFileURL(file).href);
    const linksWith = (ext: { gfmAutolinkLiteralFromMarkdown: () => unknown }) => (md: string) => {
      const tree = fromMarkdown(md, {
        extensions: [gfmAutolinkLiteral()],
        mdastExtensions: [ext.gfmAutolinkLiteralFromMarkdown() as never],
      });
      const urls: string[] = [];
      const walk = (n: { type: string; url?: string; children?: unknown[] }) => {
        if (n.type === 'link' && n.url) urls.push(n.url);
        for (const c of (n.children ?? []) as never[]) walk(c);
      };
      walk(tree as never);
      return urls;
    };
    original = linksWith(orig as never);
    patched = linksWith(mine as never);
  });

  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  it('the patched source carries no lookbehind', () => {
    const out = patchAutolinkEmail(readFileSync(LIB, 'utf8'))!;
    expect(out).not.toContain(AUTOLINK_EMAIL_WITH_LOOKBEHIND);
    expect(findLookbehinds(out)).toEqual([]);
  });

  const corpus = [
    'mail me at ravi@example.com please',
    'ravi@example.com',
    '(ravi.k+test@mail.example.co.in)',
    'path/to/ravi@example.com',
    'xravi@example.com',
    'a.b@c.d and e@f.gh',
    'email: support@navbharatai.com.',
    'no email here, just @mention and www.example.com',
    'reach-me@my-site.com, or me@site.org!',
    'ईमेल ravi@example.com पर भेजो',
    'éravi@example.com',
    'user@bad_domain.com',
  ];
  for (const md of corpus) {
    it(`same links: "${md}"`, () => expect(patched(md)).toEqual(original(md)));
  }

  it('the build hook applies to exactly that module', () => {
    expect(isAutolinkLiteralModule('/x/node_modules/mdast-util-gfm-autolink-literal/lib/index.js')).toBe(true);
    expect(isAutolinkLiteralModule('C:\\x\\node_modules\\mdast-util-gfm-autolink-literal\\lib\\index.js?v=1')).toBe(true);
    expect(isAutolinkLiteralModule('/x/node_modules/mdast-util-gfm-autolink-literal/index.js')).toBe(false);
  });

  it('an upgrade that moves the pattern is refused, not shipped', () => {
    expect(patchAutolinkEmail('export const x = 1;')).toBeNull();
  });
});

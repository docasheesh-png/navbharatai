// "HAAN, POORI GITA KE 700 SHLOKA DAAL DO" (admin 2026-09-30).
//
// The Gita reader template carried 27 chosen verses and said so honestly. It now carries the whole book:
// the Sanskrit from a public-domain dataset (cleaned), and a Hindi bhavarth written for NavBharatAI for
// every verse. Locked here:
//   1. every chapter holds exactly the verses Gita Press numbers — 700, plus Arjuna's question as 13.0;
//   2. the Sanskrit carries none of the source's encoding slips, and every line has a verse's length;
//   3. every verse has its own Hindi, in Devanagari;
//   4. the app reads the eighteen chapter files and counts what it holds on its first screen;
//   5. no single file is a whole book, so a builder that opens one reads one chapter.
import { describe, it, expect } from 'vitest';
import { GITA_CHAPTERS, gitaChapterFiles } from '../src/server/AgentV3/goldenScaffolds/gitaText';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';

// Gita Press verse counts per chapter.
const COUNTS = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 34, 27, 20, 24, 28, 78];
const SPEAKERS = new Set(['श्री भगवानुवाच', 'अर्जुन उवाच', 'सञ्जय उवाच', 'धृतराष्ट्र उवाच']);
const verse = (ch: number, v: number) => GITA_CHAPTERS[ch - 1].find((x) => x.v === v)!;

/** Syllables in one line of Sanskrit: every consonant not closed by a virama, every independent vowel, and ॐ.
 *  Enough to tell a whole half-verse (16, or 21–24 in the longer metre) from a cut or padded one. */
function syllables(line: string): number {
  let n = 0;
  const cs = [...line];
  cs.forEach((c, i) => {
    if ('अआइईउऊऋॠऌएऐओऔॐ'.includes(c)) n++;
    else if (c >= 'क' && c <= 'ह' && cs[i + 1] !== '्') n++;
  });
  return n;
}

describe('1 · the whole book, numbered as Hindi readers know it', () => {
  it('🔴 eighteen chapters, 700 counted verses, each chapter exactly its Gita Press count', () => {
    expect(GITA_CHAPTERS.length).toBe(18);
    GITA_CHAPTERS.forEach((vs, i) => {
      expect(vs.filter((x) => x.v > 0).length, 'chapter ' + (i + 1)).toBe(COUNTS[i]);
    });
    expect(GITA_CHAPTERS.flat().filter((x) => x.v > 0).length).toBe(700);
  });
  it('verses run 1..n with no gap; only chapter 13 has a verse 0 (Arjuna\'s question)', () => {
    GITA_CHAPTERS.forEach((vs, i) => {
      const nums = vs.map((x) => x.v);
      const start = i === 12 ? 0 : 1;
      expect(nums, 'chapter ' + (i + 1)).toEqual(Array.from({ length: nums.length }, (_, k) => k + start));
    });
    expect(verse(13, 0).sp).toBe('अर्जुन उवाच');
    expect(verse(13, 1).sa).toMatch(/^इदं शरीरं कौन्तेय/);
  });
  it('the verses everyone knows are where everyone looks for them', () => {
    expect(verse(2, 47).sa).toMatch(/^कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।/);
    expect(verse(4, 7).sa).toMatch(/^यदा यदा हि धर्मस्य/);
    expect(verse(18, 66).sa).toMatch(/^सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज।/);
    expect(verse(18, 78).sa).toMatch(/^यत्र योगेश्वरः कृष्णो/);
  });
});

describe('2 · the Sanskrit is clean', () => {
  const all = GITA_CHAPTERS.flatMap((vs, i) => vs.map((x) => ({ ...x, ch: i + 1 })));
  it('🔴 none of the source\'s encoding slips survive', () => {
    for (const x of all) {
      const at = x.ch + '.' + x.v;
      expect(x.sa, at).not.toMatch(/्ि/);   // i-matra before the conjunct (कश्िचत्)
      expect(x.sa, at).not.toMatch(/़/);         // stray nukta (पितृ़न्)
      expect(x.sa, at).not.toContain('श्रृ');         // the Hindi-keyboard spelling of शृ
      expect(x.sa, at).not.toMatch(/[0-9A-Za-z]/);    // verse numbers, Latin
      expect(x.sa.endsWith('॥'), at).toBe(true);
      expect(x.sa, at).not.toMatch(/उवाच$/m);         // a speaker line left inside the verse
    }
  });
  it('🔴 every half-verse has a verse\'s length (a cut or padded line fails here)', () => {
    // 11.1 opens with a nine-syllable pada in the received text itself; it is the one known exception.
    const bad = all.filter((x) => !(x.ch === 11 && x.v === 1))
      .filter((x) => x.sa.split('\n').some((l) => ![16, 21, 22, 23, 24].includes(syllables(l))));
    expect(bad.map((x) => x.ch + '.' + x.v)).toEqual([]);
  });
  it('the three verses repaired by hand read as the received text does', () => {
    expect(verse(5, 8).sa).toContain('शृण्वन्');
    expect(verse(17, 23).sa).toMatch(/^ॐ तत्सदिति/);
    expect(verse(17, 25).sa).toContain('मोक्षकाङ्क्षिभिः॥');
  });
  it('a speaker is only ever one of the four who speak in the Gita', () => {
    for (const x of all) if (x.sp) expect(SPEAKERS.has(x.sp), x.ch + '.' + x.v).toBe(true);
  });
});

describe('3 · every verse has its own Hindi', () => {
  it('🔴 701 bhavarths, in Devanagari, none empty, none a copy of another verse\'s', () => {
    const his = GITA_CHAPTERS.flat().map((x) => x.hi);
    expect(his.length).toBe(701);
    for (const h of his) {
      expect(h.length).toBeGreaterThan(20);
      expect(h).toMatch(/[ऀ-ॿ]/);
      expect(h).not.toMatch(/[A-Za-z]/);
    }
    expect(new Set(his).size).toBe(his.length);
  });
});

describe('4 · the app reads the book and counts it', () => {
  const g = GOLDEN_SCAFFOLDS.find((s) => s.id === 'geeta')!;
  const files = goldenScaffoldFiles(g);
  it('🔴 the scaffold ships the eighteen chapter files and App.tsx imports every one', () => {
    for (let i = 1; i <= 18; i++) {
      const p = 'src/gita/' + String(i).padStart(2, '0') + '.json';
      expect(files[p], p).toBeDefined();
      expect(JSON.parse(files[p]).length, p).toBe(GITA_CHAPTERS[i - 1].length);
      expect(g.appTsx, p).toContain("from './gita/" + String(i).padStart(2, '0') + ".json'");
    }
  });
  it('the first screen counts what it holds — no "selection" wording left over', () => {
    expect(g.appTsx).toContain('सभी {CHAPTERS.length} अध्याय और पूरे {COUNTED.length} श्लोक');
    expect(g.appTsx).not.toContain('चुने हुए');
    expect(g.appTsx).not.toContain('इस चयन में');
  });
  it('the other templates carry no data files they did not ask for', () => {
    for (const s of GOLDEN_SCAFFOLDS) {
      if (s.id === 'geeta') continue;
      expect(Object.keys(goldenScaffoldFiles(s)).some((p) => p.startsWith('src/gita/')), s.id).toBe(false);
    }
  });
});

describe('5 · no file is the whole book', () => {
  it('🔒 every chapter file stays small enough for one read', () => {
    for (const [p, c] of Object.entries(gitaChapterFiles())) expect(Buffer.byteLength(c), p).toBeLessThan(64 * 1024);
    expect(Buffer.byteLength(GOLDEN_SCAFFOLDS.find((s) => s.id === 'geeta')!.appTsx)).toBeLessThan(24 * 1024);
  });
});

import { describe, it, expect } from 'vitest';
import {
  imagesMissingAlt,
  inputsMissingLabel,
  controlsMissingName,
  htmlMissingLang,
  positiveTabindexCount,
  lintA11y,
} from '../src/server/AppMakerLab/intelligence/A11yLinter';

/** P-TQA.11 (builder-side) — pure WCAG static-lint logic. */

describe('imagesMissingAlt', () => {
  it('counts images without alt (alt="" is valid/decorative)', () => {
    const code = '<img src="a.png"><img src="b.png" alt="B"><img src="c.png" alt="">';
    expect(imagesMissingAlt(code)).toEqual([3, 1]);
  });
  it('no images → [0,0]', () => {
    expect(imagesMissingAlt('<div/>')).toEqual([0, 0]);
  });
});

describe('inputsMissingLabel', () => {
  it('flags an input with none of aria-label/id/title, skips hidden/submit', () => {
    const code = '<input type="text"><input type="text" id="email"><input type="hidden"><input type="submit">';
    expect(inputsMissingLabel(code)).toEqual([2, 1]); // 2 counted (text ones), 1 unlabelled
  });
  it('an id or aria-label suppresses the flag', () => {
    expect(inputsMissingLabel('<input aria-label="Name"><select id="s"></select>')).toEqual([2, 0]);
  });
});

describe('controlsMissingName', () => {
  it('flags icon-only buttons with no accessible name', () => {
    const code = '<button><svg></svg></button><button>Save</button><button aria-label="Close"><svg/></button>';
    expect(controlsMissingName(code)).toEqual([3, 1]);
  });
  it('counts anchors only when they have href', () => {
    const code = '<a>no href</a><a href="/x"></a><a href="/y">Home</a>';
    // <a> without href skipped; <a href></a> empty → unnamed; <a href>Home</a> named
    expect(controlsMissingName(code)).toEqual([2, 1]);
  });
});

describe('htmlMissingLang', () => {
  it('flags <html> without lang; ok with lang; N/A for fragments', () => {
    expect(htmlMissingLang('<html><body></body></html>')).toBe(true);
    expect(htmlMissingLang('<html lang="en"><body></body></html>')).toBe(false);
    expect(htmlMissingLang('<div>fragment</div>')).toBe(false);
  });
});

describe('positiveTabindexCount', () => {
  it('counts positive tabindex only', () => {
    expect(positiveTabindexCount('<div tabindex="1"></div><div tabindex="0"></div><div tabindex="-1"></div><a tabindex="5">')).toBe(2);
  });
});

describe('lintA11y', () => {
  it('clean code scores A/100', () => {
    const code = '<html lang="en"><img src="a" alt="a"><button>Go</button><input aria-label="q"></html>';
    const r = lintA11y(code);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.violations).toEqual([]);
  });
  it('accumulates penalties and reports mapped WCAG violations with AI fix-prompts', () => {
    const code = '<html><img src="a"><button><svg/></button><input type="text"></html>';
    const r = lintA11y(code);
    const types = r.violations.map((v) => v.type).sort();
    expect(types).toEqual(['control-name', 'html-lang', 'img-alt', 'input-label']);
    expect(r.score).toBeLessThan(100);
    const imgAlt = r.violations.find((v) => v.type === 'img-alt');
    expect(imgAlt?.wcag).toBe('1.1.1');
    expect(typeof imgAlt?.fix).toBe('string');
    expect(imgAlt?.fix.length).toBeGreaterThan(10);
    // every violation carries a fix-prompt
    expect(r.violations.every((v) => typeof v.fix === 'string' && v.fix.length > 0)).toBe(true);
  });
  it('score clamped to [0,100]; empty code is a perfect 100', () => {
    expect(lintA11y('').score).toBe(100);
    // pile on issues across categories (each cap ~25-30) → score floors well below 60 → grade D
    const bad =
      '<html>' +
      '<img src="x">'.repeat(30) + // img-alt: +30
      '<input type="text">'.repeat(10) + // input-label: +30
      '<button><svg/></button>'.repeat(10) + // control-name: +25
      '</html>'; // html-lang: +10  → penalty ~95
    const r = lintA11y(bad);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(60);
    expect(r.grade).toBe('D');
  });
});

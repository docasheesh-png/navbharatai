/**
 * AN SVG LINE DRAWN IN WHITE DISAPPEARS ON LIGHT (admin 2026-09-25, phone screenshot of Other → Bot
 * Builder in light mode: the nodes were there and the connecting lines between them were not —
 * "dark mode me dikhti hai").
 *
 * The canvas drew its edges, arrowheads, labels and grid as SVG presentation attributes:
 * `stroke="rgba(255,255,255,0.2)"`. White at 20% is a visible grey on the dark surface and nothing at
 * all on the light one (#f8fafc). The same literal-neutral shape sat in five more places — the score
 * number inside the SEO and code-review rings (`fill="white"`, i.e. an invisible score on Light),
 * and the tracks of three ring charts.
 *
 * 🔑 WHY THE THEME RATCHET NEVER SAW IT: `tests/themeTokensOnly.test.ts` counts colour CLASSES and
 * inline STYLE objects. An SVG presentation attribute (`stroke="…"`, `fill="…"`) is neither, so this
 * whole class was invisible to the one lock built to catch it. This file closes that gap for the
 * dangerous half: a NEUTRAL (white or black, any alpha) written as an SVG attribute is a colour that
 * vanishes on one of the themes, by construction. A brand colour (`stroke={color}` = '#22c55e') is
 * the same on every theme and is deliberately not matched.
 *
 * The fix routes those neutrals through the theme variables (`style={{ stroke: 'var(--border-soft)' }}`)
 * — declared in `@layer base`, so they really exist in the stylesheet (see
 * `everyTokenAStyleUsesIsDeclared.test.ts`), unlike a `--color-*` name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

function clientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full.endsWith(join('src', 'server'))) continue;
      clientFiles(full, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `fill="white"`, `stroke={'#fff'}`, `stroke="rgba(255,255,255,0.2)"`, `fill="#ffffff60"`, `stopColor="black"`… */
const NEUTRAL_SVG_ATTR =
  /\b(fill|stroke|stopColor|floodColor|lightingColor)=(?:"|\{\s*['"`])\s*(white|black|#fff(?:fff)?(?:[0-9a-f]{2})?|#000(?:000)?(?:[0-9a-f]{2})?|rgba?\(\s*(?:255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0)\b[^)]*\))\s*["'`]/gi;

function offenders(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...code.matchAll(NEUTRAL_SVG_ATTR)].map((m) => m[0]);
}

describe('the detector sees the exact shapes that broke', () => {
  it('matches the Bot Builder edge, arrowhead and label, and the invisible score numbers', () => {
    expect(offenders('<path stroke="rgba(255,255,255,0.2)" />')).toHaveLength(1);
    expect(offenders('<path d="M0,0" fill="rgba(255,255,255,0.3)" />')).toHaveLength(1);
    expect(offenders('<text fill="white">{score}</text>')).toHaveLength(1);
    expect(offenders('<text fill="#ffffff60">x</text>')).toHaveLength(1);
    expect(offenders('<circle stroke="#ffffff08" />')).toHaveLength(1);
    expect(offenders("<line stroke={'#000'} />")).toHaveLength(1);
  });

  it('leaves brand colours, computed colours, themed styles and comments alone', () => {
    expect(offenders('<circle stroke={color} />')).toEqual([]);
    expect(offenders('<circle stroke="#22c55e" />')).toEqual([]);
    expect(offenders('<path fill="none" stroke="transparent" />')).toEqual([]);
    expect(offenders("<path style={{ stroke: 'var(--border-soft)' }} />")).toEqual([]);
    expect(offenders('<path fill="currentColor" />')).toEqual([]);
    expect(offenders('// was stroke="rgba(255,255,255,0.2)"')).toEqual([]);
  });
});

describe('no client SVG draws a theme-dependent neutral as a fixed attribute', () => {
  it('finds none anywhere in client code', () => {
    const found: string[] = [];
    for (const file of clientFiles(join(ROOT, 'src'))) {
      for (const hit of offenders(readFileSync(file, 'utf8'))) {
        found.push(`${file.slice(ROOT.length + 1)}: ${hit}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the Bot Builder draws its connections from the theme', () => {
    const src = readFileSync(join(ROOT, 'src/components/ide/BotBuilder.tsx'), 'utf8');
    expect(src).toMatch(/markerEnd="url\(#arrow\)" style=\{\{ stroke: 'var\(--text-faint\)'/);
    expect(src).toMatch(/L8,3 z" style=\{\{ fill: 'var\(--text-muted\)' \}\}/);
    expect(src).not.toContain('ring-white/40');
  });
});

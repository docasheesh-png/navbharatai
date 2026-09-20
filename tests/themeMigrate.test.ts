/**
 * The literal → token codemod (theme replacement, PR C onward — admin 2026-09-18).
 *
 * The claim that matters for review is that an EXACT row is pixel-identical on every theme TODAY:
 * the literal is one `theme-compat.css` already remaps to a palette variable, and the token's utility
 * emits the SAME variable. That is proved here against the compat file itself, not asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { mapToken, migrate, enclosingSpan, fillContext, SOLID_FILL, TOKEN_VAR, fixedFill, inlineFillKind, hasOwnOpaqueBackground,
  DARK_VALUE, INLINE_TEXT, INLINE_LINE, INLINE_BG, INLINE_ACCENT_FILL, inlineColourToken, inlineBackgroundKind, normaliseColour, styleObjectSpans, inlineSkipReason, inlineOnlyRun, elementAt, elementFixesItsLabel } from '../scripts/themeMigrate.mjs';
import { literalsIn, maskEmbeddedSources } from '../scripts/themeColourBaseline.mjs';

const compat = readFileSync(resolve(__dirname, '../src/styles/theme-compat.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** `.text-\[\#8b949e\]` → `text-[#8b949e]`; the utility class each compat selector names. */
function unescape(sel: string): string {
  return sel.trim().replace(/^html\[data-theme\]\s*\./, '').replace(/:hover$/, '').replace(/\\(.)/g, '$1');
}
/** literal utility → the palette variable compat resolves it to (single-class selectors only). */
function compatMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of compat.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const v = m[2].match(/var\((--[\w-]+)\)/)?.[1];
    if (!v) continue;
    for (const sel of m[1].split(',')) {
      const cls = unescape(sel);
      if (/^[\w[\]#/.-]+$/.test(cls) && !cls.includes('.')) out.set(cls, v);
    }
  }
  return out;
}

describe('🔒 every EXACT row emits the variable the compat layer already resolves that literal to', () => {
  const cm = compatMap();
  it('parsed the compat file (the selector shape has not changed under this test)', () => {
    expect(cm.size).toBeGreaterThan(60);
    expect(cm.get('text-white')).toBe('--text-primary');
  });
  const LITERALS = ['text-white', 'text-[#c9d1d9]', 'text-[#8b949e]', 'text-[#484f58]', 'text-[#6e7681]', 'text-gray-400', 'text-zinc-500',
    'bg-[#0d1117]', 'bg-[#161b22]', 'bg-[#21262d]', 'bg-[#30363d]', 'bg-zinc-900', 'bg-zinc-800', 'bg-zinc-950',
    'border-[#30363d]', 'border-zinc-800'];
  for (const lit of LITERALS) {
    it(`${lit}`, () => {
      const r = mapToken(lit)!;
      expect(r, `${lit} is not mapped`).toBeTruthy();
      expect(r.kind).toBe('exact');
      const tokenName = r.token.replace(/^(text|bg|border|divide|placeholder)-/, '');
      expect(cm.get(lit), `compat does not remap ${lit}`).toBeTruthy();
      expect(TOKEN_VAR[tokenName as keyof typeof TOKEN_VAR]).toBe(cm.get(lit));
    });
  }
});

describe('the readability FIX rows — pixels change on purpose, toward AA', () => {
  it('the faded-label idiom lands on a real token by opacity band', () => {
    expect(mapToken('text-white/30')).toEqual({ token: 'text-faint', kind: 'fix' });
    expect(mapToken('text-white/40')).toEqual({ token: 'text-faint', kind: 'fix' });
    expect(mapToken('text-white/50')).toEqual({ token: 'text-muted', kind: 'fix' });
    expect(mapToken('text-white/60')).toEqual({ token: 'text-muted', kind: 'fix' });
    expect(mapToken('text-white/70')).toEqual({ token: 'text-body', kind: 'fix' });
    expect(mapToken('text-white/90')).toEqual({ token: 'text-body', kind: 'fix' });
  });
  it('a light brand shade used as TEXT becomes the readable brand token, opacity dropped', () => {
    expect(mapToken('text-emerald-400')?.token).toBe('text-success');
    expect(mapToken('text-amber-300/80')?.token).toBe('text-warn');
    expect(mapToken('text-rose-300')?.token).toBe('text-danger');
    expect(mapToken('text-sky-300')?.token).toBe('text-info');
    expect(mapToken('text-indigo-400')?.token).toBe('text-accent-text');
    expect(mapToken('text-indigo-600')).toEqual({ token: 'text-accent-text', kind: 'fix' }); // PR G: a dark shade as text is 3.3:1 on Dark — the role token
    expect(mapToken('text-indigo-800')).toBeNull(); // 800+ as text is a design choice — by hand
  });
  it('border-white/N is a FIX row — compat\'s last rule for it is a mix of --text-primary, not --border-soft', () => {
    // On dark the two are the same rgba(255,255,255,.1); on light --border-soft (#e2e8f0) replaces a
    // 10% mix of near-black (~#e7e8eb). Honest classification: pixels can differ by a shade.
    expect(mapToken('border-white/10')).toEqual({ token: 'border-line', kind: 'fix' });
    expect(mapToken('border-white/5')).toEqual({ token: 'border-line', kind: 'fix' });
    expect(mapToken('divide-white/5')).toEqual({ token: 'divide-line', kind: 'fix' });
    expect(mapToken('border-white/40')).toBeNull();
  });
  it('the neutral status dot / knob grey is a faint SURFACE, and an underline follows its text', () => {
    expect(mapToken('bg-zinc-500')?.token).toBe('bg-faint');
    expect(mapToken('bg-[#484f58]')?.token).toBe('bg-faint');
    expect(mapToken('decoration-white/20')?.token).toBe('decoration-line');
    expect(mapToken('decoration-white')?.token).toBe('decoration-ink');
  });
  it('the grey families and hexes compat never covered — today they do not follow the theme at all', () => {
    expect(mapToken('text-zinc-600')).toEqual({ token: 'text-faint', kind: 'fix' });
    expect(mapToken('text-stone-400')?.token).toBe('text-muted');
    expect(mapToken('text-[#a1a1aa]')?.token).toBe('text-muted');
    expect(mapToken('text-[#efeff1]')?.token).toBe('text-body');
    expect(mapToken('hover:border-zinc-500')).toBeNull(); // the variant is stripped by migrate, not mapToken
    expect(mapToken('border-zinc-500')?.token).toBe('border-line');
    expect(mapToken('border-stone-800')?.token).toBe('border-line');
    expect(mapToken('border-zinc-800/60')?.token).toBe('border-line');
    expect(mapToken('bg-stone-900')?.token).toBe('bg-card');
    expect(mapToken('bg-zinc-900/60')?.token).toBe('bg-raised');
    expect(mapToken('bg-zinc-900/80')?.token).toBe('bg-card');
    expect(mapToken('bg-[#0d1117]/85')?.token).toBe('bg-surface');
    expect(mapToken('bg-[#1a212b]')?.token).toBe('bg-raised');
    expect(mapToken('text-[#ff8080]')?.token).toBe('text-danger');
    expect(mapToken('text-[#58a6ff]')?.token).toBe('text-info');
    expect(mapToken('text-[#a259ff]')?.token).toBe('text-accent-text');
  });
  it('a gradient stop INTO the chrome follows the theme; a brand or white stop is left', () => {
    expect(mapToken('to-[#161b22]')).toEqual({ token: 'to-card', kind: 'fix' });
    expect(mapToken('from-gray-950')?.token).toBe('from-surface');
    expect(mapToken('via-gray-900')?.token).toBe('via-card');
    expect(mapToken('via-gray-950/70')?.token).toBe('via-surface');
    expect(mapToken('from-white')).toBeNull();
    expect(mapToken('to-indigo-600')).toBeNull();
  });
  it('a hex BRAND fill (GitHub black) is a solid fill, so its white label stays white', () => {
    expect(SOLID_FILL.test('bg-[#24292e] text-white')).toBe(true);
    expect(migrate('"px-3 bg-[#24292e] hover:bg-[#1a1e22] text-white"').out).toContain('text-on-accent');
  });
  it('a LIGHT-authored surface is not guessed — bg-gray-50 / text-gray-900 / border-gray-200 stay for a hand read', () => {
    for (const lit of ['bg-gray-50', 'bg-stone-100', 'text-gray-900', 'text-stone-900', 'border-gray-200', 'text-zinc-950']) {
      expect(mapToken(lit), lit).toBeNull();
    }
  });
  it('a translucent black is a well inside a card up to /50 and a scrim from /60', () => {
    expect(mapToken('bg-black/20')?.token).toBe('bg-well');
    expect(mapToken('bg-black/50')?.token).toBe('bg-well');
    expect(mapToken('bg-black/60')?.token).toBe('bg-scrim');
    expect(mapToken('bg-black/70')?.token).toBe('bg-scrim');
  });
  it('a faint white wash is a raised surface; a near-solid one is a card', () => {
    expect(mapToken('bg-white/5')?.token).toBe('bg-raised');
    expect(mapToken('bg-white/30')?.token).toBe('bg-raised');
    expect(mapToken('bg-white/90')?.token).toBe('bg-card');
    expect(mapToken('bg-white/50')).toBeNull();
  });
});

describe('what is deliberately LEFT for a human', () => {
  it('bg-white, bg-black, text-black and non-colour props are not guessed', () => {
    for (const lit of ['bg-white', 'bg-black', 'text-black', 'from-white/10', 'fill-white', 'to-black/30']) {
      expect(mapToken(lit), lit).toBeNull();
    }
  });
});

describe('white text on a SOLID brand fill stays white — the compat exception, mirrored', () => {
  it('SOLID_FILL matches a 500–700 fill and a gradient, not a tint', () => {
    expect(SOLID_FILL.test('px-3 bg-indigo-600 text-white')).toBe(true);
    expect(SOLID_FILL.test('hover:bg-red-500 hover:text-white')).toBe(true);
    expect(SOLID_FILL.test('bg-gradient-to-r from-indigo-600 to-purple-600 text-white')).toBe(true);
    expect(SOLID_FILL.test('bg-indigo-500/10 text-white')).toBe(false);
    expect(SOLID_FILL.test('bg-indigo-50 text-white')).toBe(false);
  });
  it('the context is the enclosing string, so a ternary\'s two branches are judged separately', () => {
    const line = "className={`px-2 ${on ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white'} rounded`}";
    const { out } = migrate(line);
    expect(out).toContain("'bg-indigo-600 text-on-accent'");
    expect(out).toContain("'bg-raised text-ink'");
    expect(enclosingSpan(line, line.indexOf('bg-white/5'))).toBe('bg-white/5 text-white');
  });
  it('a fill chosen by a ternary INSIDE the template: white when every branch is a fill, left when mixed', () => {
    const every = "className={`px-3 text-white ${banned ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}";
    expect(fillContext(every, every.indexOf('text-white'))).toBe('yes');
    expect(migrate(every).out).toContain('px-3 text-on-accent ${');
    const mixed = "className={`px-3 text-white ${on ? 'bg-indigo-600' : 'bg-white/5'}`}";
    expect(fillContext(mixed, mixed.indexOf('text-white'))).toBe('mixed');
    const r = migrate(mixed);
    expect(r.out).toContain('px-3 text-white ${'); // untouched, not guessed
    expect(Object.keys(r.left).join()).toContain('text-white (mixed fills');
    const none = "className={`px-3 text-white ${on ? 'border-line' : ''}`}";
    expect(fillContext(none, none.indexOf('text-white'))).toBe('no');
  });
  it('an 80%+ fill is still a fill (bg-rose-600/80); a 10% tint is not', () => {
    expect(SOLID_FILL.test('bg-rose-600/80 text-white')).toBe(true);
    expect(SOLID_FILL.test('bg-rose-600/10 text-white')).toBe(false);
  });
  it('every grey label nested under a fixed fill goes white, however deep — the Studio status bar', () => {
    const src = [
      '<div className="h-5 bg-[#007acc] flex items-center px-3">',
      '  <span className="text-[10px] text-white font-mono">Ln 1</span>',
      '  <span className="text-[10px] text-[#c9d1d9] font-mono">TXT</span>',
      '  <span className="text-[10px] text-[#8b949e] font-mono ml-auto">UTF-8</span>',
      '</div>',
      '<span className="text-[#8b949e]">outside</span>',
    ].join('\n');
    const out = migrate(src).out.split('\n');
    expect(out[1]).toContain('text-on-accent');
    expect(out[2]).toContain('text-on-accent');
    expect(out[3]).toContain('text-on-accent');
    expect(out[5]).toBe('<span className="text-muted">outside</span>');
  });
  it('a label directly inside a filled box (the line above opens a solid-fill element) stays white', () => {
    const src = [
      '<div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">',
      '  <span className="text-white font-black text-xs">NB</span>',
      '</div>',
      '<div className="p-4 bg-card">',
      '  <span className="text-white font-black">plain</span>',
    ].join('\n');
    const { out } = migrate(src);
    expect(out).toContain('<span className="text-on-accent font-black text-xs">NB</span>');
    expect(out).toContain('<span className="text-ink font-black">plain</span>');
  });
  it('a FIXED hex fill the theme will never change (VS Code blue) keeps its white label; a chrome hex does not count', () => {
    // Studio\'s status bar: `bg-[#007acc] text-white/60` became text-muted on the first run — #8b949e on
    // that blue is 1.47:1, an "invisible" the crawl caught on Dark. A hex that the table maps to a
    // surface token (bg-[#161b22] → bg-card) is chrome, not a fill, so white on IT is still text-ink.
    expect(migrate('"bg-[#007acc] text-white/60 px-2"').out).toBe('"bg-[#007acc] text-on-accent px-2"');
    expect(migrate('"bg-[#161b22] text-white px-2"').out).toBe('"bg-card text-ink px-2"');
  });
  it('mapToken itself takes the flag', () => {
    expect(mapToken('text-white', { onSolidFill: true })?.token).toBe('text-on-accent');
    expect(mapToken('text-white/80', { onSolidFill: true })?.token).toBe('text-on-accent');
  });
});

describe('migrate — mechanics', () => {
  it('preserves every variant prefix verbatim', () => {
    const { out } = migrate('"hover:text-white md:bg-[#161b22] group-hover:text-[#8b949e] placeholder:text-[#484f58] dark:border-white/10"');
    expect(out).toBe('"hover:text-ink md:bg-card group-hover:text-muted placeholder:text-faint dark:border-line"');
  });
  it('is idempotent — a migrated file is a fixed point', () => {
    const once = migrate('"text-white bg-[#0d1117] text-emerald-400 bg-black/40 border-white/10"').out;
    expect(migrate(once).out).toBe(once);
    expect(once).toBe('"text-ink bg-surface text-success bg-well border-line"');
  });
  it('reports what changed, how (exact vs fix), and what it left', () => {
    // Two SEPARATE class strings: since PR H a `bg-white` in the same string marks a LIGHT fixed fill,
    // and its labels are deliberately left for a hand (white on white is nobody's readable default).
    const r = migrate('"text-white text-white/40" "bg-white text-black"');
    expect(r.exact).toBe(1);
    expect(r.fix).toBe(1);
    expect(r.left).toEqual({
      'bg-white': 1,
      "text-black (inside a LIGHT fixed fill — somebody else's surface, by hand)": 1,
    });
    expect(r.changed).toEqual({ 'text-white → text-ink': 1, 'text-white/40 → text-faint': 1 });
  });
  it('an arbitrary opacity is normalised first, so bg-white/[0.02] cannot become a 2% raised surface', () => {
    // Two whites at two alphas both land on `bg-raised`; the hover then moves to `-hover` (see the
    // dead-hover describe below), so this used to expect `hover:bg-raised` and was asserting a no-op.
    expect(migrate('"bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.08]"').out).toBe('"bg-raised hover:bg-raised-hover border-line"');
  });
  it('never touches a token that is already semantic', () => {
    const src = '"bg-card text-muted border-line text-on-accent"';
    expect(migrate(src).out).toBe(src);
  });
});

describe('🔒 a fixed fill decides its label — PR G rows, each from a real crawl miss', () => {
  it('an inline style background is a fixed fill: text-white → text-on-accent (the white-label preview buttons)', () => {
    const src = `<button className="px-4 py-2 text-xs text-white font-medium" style={{ backgroundColor: config.primaryColor }}>Login</button>`;
    expect(migrate(src).out).toContain('text-on-accent font-medium');
  });
  it('a var(--…) inline background follows the theme and is NOT a fixed fill', () => {
    const src = `<div className="text-white" style={{ background: 'var(--surface-card)' }}>x</div>`;
    expect(migrate(src).out).toContain('className="text-ink"');
  });
  it('a solid fill with no text colour of its own gets text-on-accent ("Download YAML" on bg-violet-600 inherited ink)', () => {
    const src = `<button className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium">Download</button>`;
    const r = migrate(src);
    expect(r.out).toContain('rounded-xl text-sm font-medium text-on-accent"');
    expect(migrate(r.out).out).toBe(r.out); // idempotent
  });
  it('a HOVER-only fill on a flat button does not pin white text for the resting state', () => {
    const src = `<button className="px-3 py-1 hover:bg-indigo-600 rounded">x</button>`;
    expect(migrate(src).out).toBe(src);
  });
  it('gradient TEXT (bg-clip-text) and a fill that already names its text colour are left alone', () => {
    const src = `<span className="bg-gradient-to-r from-indigo-400 to-amber-300 bg-clip-text text-transparent">FULL TEAM</span>\n<button className="bg-indigo-600 text-on-accent px-3">ok</button>`;
    expect(migrate(src).out).toBe(src);
  });
  it('a ternary branch that is only a fill gets the label colour in that branch alone', () => {
    const src = "<div className={`px-2 ${on ? 'bg-emerald-600' : 'bg-raised'}`}>x</div>";
    expect(migrate(src).out).toBe("<div className={`px-2 ${on ? 'bg-emerald-600 text-on-accent' : 'bg-raised'}`}>x</div>");
  });
  it('a DARK tint becomes the 500 shade at 10% (bg-emerald-900/30 was a mid-dark smear on Light)', () => {
    expect(mapToken('bg-emerald-900/30')).toEqual({ token: 'bg-emerald-500/10', kind: 'fix' });
    expect(mapToken('bg-amber-950/40')).toEqual({ token: 'bg-amber-500/10', kind: 'fix' });
    expect(mapToken('bg-emerald-900')).toBeNull(); // a SOLID dark fill is a design choice — by hand
    expect(mapToken('bg-red-950/95')).toBeNull(); // past 60% it is an opaque panel, not a wash — by hand
    expect(literalsIn('<div className="bg-red-900/20 text-red-200">x</div>').map((h) => h.token)).toEqual(['bg-red-900/20', 'text-red-200']);
  });
  it('a DARK brand shade as text becomes the role token (text-emerald-600 is 3.3:1 on Dark)', () => {
    expect(mapToken('text-emerald-600')).toEqual({ token: 'text-success', kind: 'fix' });
    expect(mapToken('text-red-700')).toEqual({ token: 'text-danger', kind: 'fix' });
    expect(literalsIn('<p className="text-emerald-600">x</p>').map((h) => h.token)).toEqual(['text-emerald-600']);
  });
});

describe('🔒 a FIXED background fixes everything inside it, and its luminance picks the label (PR H)', () => {
  it('bg-black / bg-white / a non-chrome hex are fixed; a chrome hex is not', () => {
    expect(fixedFill('rounded bg-black p-2')).toBe('dark');
    expect(fixedFill('bg-white rounded')).toBe('light');
    expect(fixedFill('bg-[#16181c] h-40')).toBe('dark');   // Twitter's card
    expect(fixedFill('bg-[#f0f2f5] px-3')).toBe('light');  // Facebook's card
    expect(fixedFill('bg-[#161b22] p-2')).toBeNull();      // chrome — becomes bg-card
    expect(fixedFill('bg-indigo-600 px-3')).toBeNull();    // a brand hue, judged by SOLID_FILL
  });

  it('a text-white deep inside a bg-black mockup stays white (the Twitter card preview)', () => {
    const src = [
      '<div className="rounded-2xl overflow-hidden border border-[#2f3336] bg-black">',
      '  <div className="p-3 flex gap-3">',
      '    <div className="min-w-0">',
      '      <p className="text-white text-sm font-bold truncate">{title}</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-on-accent text-sm font-bold');
    expect(migrate(src).out).not.toContain('text-ink');
  });

  it("a label inside a LIGHT fixed fill is LEFT ALONE — white would be invisible on it", () => {
    const src = [
      '<div className="rounded-lg bg-[#f0f2f5]">',
      '  <p className="text-[#606770] text-xs">{site}</p>',
      '</div>',
    ].join('\n');
    const r = migrate(src);
    expect(r.out).toBe(src);
    expect(Object.keys(r.left).join(' ')).toContain('LIGHT fixed fill');
  });

  it('the inherited-label rule never stamps white on a light fixed fill', () => {
    expect(migrate('<div className="rounded bg-[#f0f2f5] px-3">x</div>').out)
      .toBe('<div className="rounded bg-[#f0f2f5] px-3">x</div>');
    // …while a DARK fixed fill still gets it
    expect(migrate('<div className="rounded bg-[#007acc] px-3">x</div>').out)
      .toContain('text-on-accent');
  });

  it('a WASH gradient is not a fill: a 1px gradient border around a themed card keeps themed labels', () => {
    const src = [
      '<div className="rounded-xl p-[1px] bg-gradient-to-r from-indigo-500 to-amber-400">',
      '  <div className="rounded-[11px] bg-surface px-3 py-2">',
      '    <span className="text-white/40 font-normal">{n} agents</span>',
      '  </div>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-faint font-normal'); // themed, not text-on-accent
  });

  it('a translucent gradient stop makes it a wash (from-indigo-950/40 to-black/30)', () => {
    const src = [
      '<div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-black/30">',
      '  <p className="text-[10px] text-[#8b949e] font-medium">Cloud Deployment Hub</p>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-muted font-medium');
  });

  it('an element that declares its own themed surface ends the fixed subtree', () => {
    const src = [
      '<div className="bg-black rounded">',
      '  <div className="bg-card p-2">',
      '    <p className="text-white">{x}</p>',
      '  </div>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-ink'); // on bg-card, not on the black
  });

  it('a HOVER background is not the element\'s own background (the DoseCalculator dropdown)', () => {
    const src = [
      '<div className="rounded-xl bg-[#0a1018] overflow-hidden">',
      '  <button className="w-full px-3 text-[#c9d1d9] hover:bg-emerald-500/10">{label}</button>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-on-accent hover:bg-emerald-500/10');
  });

  it('an INLINE fixed background opens a fixed subtree and is measured (PerformanceAnalyzer\'s panel)', () => {
    expect(inlineFillKind("<div style={{ background: '#12141c' }}>")).toBe('dark');
    expect(inlineFillKind("<div style={{ background: '#f0f2f5' }}>")).toBe('light');
    expect(inlineFillKind("<div style={{ background: 'var(--surface-card)' }}>")).toBeNull();
    expect(inlineFillKind('<div style={{ backgroundColor: config.primaryColor }}>')).toBe('dark');
    const src = [
      "<div className=\"rounded-xl p-4\" style={{ background: '#12141c' }}>",
      '  <span className="text-sm font-semibold text-white">Live performance</span>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-on-accent');
  });

  it('a background under FIXED hex ink is never themed — both halves stay (a code block)', () => {
    const pair = '<pre className="p-4 bg-[#0d1117] text-[#a5d6ff]">x</pre>';
    expect(migrate(pair).out).toBe(pair);
    // …while the same background under mappable ink still migrates
    expect(migrate('<pre className="p-4 bg-[#0d1117] text-white">x</pre>').out)
      .toBe('<pre className="p-4 bg-surface text-ink">x</pre>');
  });

  it('a brand-hue label on a FIXED fill keeps its literal — the box never changes, nor may the ink', () => {
    const src = [
      "<div className=\"rounded-xl p-4\" style={{ background: '#12141c' }}>",
      '  <p className="mt-2 text-[11px] text-amber-400">Open your preview once</p>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-amber-400'); // NOT text-warn
    // the same rule for a hex brand ink on a fixed chip (Figma's purple on its own dark tile)
    expect(migrate('<div className="bg-[#1e1333] text-[#a259ff]">F</div>').out)
      .toBe('<div className="bg-[#1e1333] text-[#a259ff]">F</div>');
    // …while off a fill it still becomes the role token
    expect(migrate('<p className="text-amber-400">x</p>').out).toContain('text-warn');
  });

  it('a TRANSLUCENT tint does not replace the fixed surface beneath it (AICodeReview\'s warning strip)', () => {
    const src = [
      '<div className="px-6 py-4 bg-[#0f141b] space-y-3">',
      '  <div className="text-xs text-amber-400 bg-amber-500/10 px-3 py-2">{err}</div>',
      '</div>',
    ].join('\n');
    expect(migrate(src).out).toContain('text-amber-400'); // stays literal on the fixed box, NOT text-warn
    expect(hasOwnOpaqueBackground('text-xs bg-amber-500/10 px-3')).toBe(false);
    expect(hasOwnOpaqueBackground('text-xs hover:bg-card px-3')).toBe(false);
    expect(hasOwnOpaqueBackground('text-xs bg-card px-3')).toBe(true);
    expect(hasOwnOpaqueBackground('text-xs bg-indigo-600 px-3')).toBe(true); // a HYPHENATED colour must parse
    expect(hasOwnOpaqueBackground('text-xs bg-white/90 px-3')).toBe(true);
  });

  it('a chrome background still themes its children normally (no false fixed scope)', () => {
    const src = [
      '<div className="bg-[#161b22] p-2">',
      '  <p className="text-white">{x}</p>',
      '</div>',
    ].join('\n');
    const out = migrate(src).out;
    expect(out).toContain('bg-card');
    expect(out).toContain('text-ink');
  });
});

describe('🔒 embedded source is SOMEBODY ELSE\'S app — never counted, never rewritten', () => {
  // ComponentLibrary\'s copyable snippets and SyncedTemplates\' starter projects are markup inside
  // template literals. Those apps run on plain Tailwind, where `bg-card` means nothing — the first
  // run of PR D rewrote 19 snippets to our tokens and would have handed users broken components.
  const snippet = "const c = { html: `<nav class=\"bg-[#161b22] text-white px-4\"><a class=\"text-gray-400\">Home</a></nav>` };";
  it('the census does not count a literal inside embedded markup', () => {
    expect(literalsIn(snippet)).toEqual([]);
    expect(maskEmbeddedSources(snippet)).toMatch(/const c = \{ html: +\};/); // the whole literal, backticks included, becomes spaces
  });
  it('the codemod leaves embedded markup byte-identical while migrating the UI around it', () => {
    const src = snippet + "\nconst ui = <div className=\"bg-[#161b22] text-white\">{c.html}</div>;";
    const { out } = migrate(src);
    expect(out.split('\n')[0]).toBe(snippet);
    expect(out.split('\n')[1]).toBe("const ui = <div className=\"bg-card text-ink\">{c.html}</div>;");
  });
  it('a QUOTED string that opens an HTML tag is embedded markup too (a print report, a highlighter span)', () => {
    const src = `const h = md.replace(/^# (.+)$/gm, '<h1 style="color:#064e3b">$1</h1>');\nconst k = "<span style=\\"color:#79c0ff\\">";\nconst cls = "text-white bg-[#0d1117]";`;
    expect(literalsIn(src).map((h) => h.token)).toEqual(['text-white', 'bg-[#0d1117]']);
    expect(migrate(src).out).toContain(`'<h1 style="color:#064e3b">$1</h1>'`);
  });
  it('a NESTED template (rows mapped inside a report) is ONE embedded literal, not alternating segments', () => {
    const src = 'const html = `<table>${rows.map((r) => `<tr><td style="color:#6b7280">${r.k}</td></tr>`).join(\'\')}</table>`;\nconst ui = "text-white";';
    expect(literalsIn(src).map((h) => h.token)).toEqual(['text-white']);
    expect(migrate(src).out).toContain('color:#6b7280');
  });
  it('a class-list template (`px-2 ${x} text-white`) is NOT embedded source — it has no markup', () => {
    const src = "className={`px-2 ${on ? 'a' : 'b'} text-white`}";
    expect(maskEmbeddedSources(src)).toBe(src);
    expect(migrate(src).out).toBe("className={`px-2 ${on ? 'a' : 'b'} text-ink`}");
  });
  it('a starter project file (a whole App.tsx in a backtick) counts for nothing', () => {
    const starter = "files: { 'src/App.tsx': `import React from \"react\";\nexport default () => <div className=\"bg-white text-gray-900\">hi</div>;` }";
    expect(literalsIn(starter)).toEqual([]);
    expect(migrate(starter).out).toBe(starter);
  });
});

describe('🔒 a hover to the surface it already has is not a hover (PR #3095\'s guard, now built into the codemod)', () => {
  it('bg-white/5 hover:bg-white/10 rests on raised and hovers to raised-hover — never raised twice', () => {
    expect(migrate('"px-2 bg-white/5 hover:bg-white/10 rounded"').out).toBe('"px-2 bg-raised hover:bg-raised-hover rounded"');
  });
  it('the same for a well, and for group-hover', () => {
    expect(migrate('"bg-black/20 group-hover:bg-black/30"').out).toBe('"bg-well group-hover:bg-well-hover"');
  });
  it('a hover to a DIFFERENT surface is left exactly as mapped', () => {
    expect(migrate('"bg-white/5 hover:bg-[#161b22]"').out).toBe('"bg-raised hover:bg-card"');
  });
  it('an already-correct pair is untouched, and a lone hover with no resting surface is untouched', () => {
    expect(migrate('"bg-raised hover:bg-raised-hover"').out).toBe('"bg-raised hover:bg-raised-hover"');
    expect(migrate('"px-2 hover:bg-white/5"').out).toBe('"px-2 hover:bg-raised"');
  });
  it('is counted as a readability FIX, not an exact swap', () => {
    const r = migrate('"bg-white/5 hover:bg-white/10"');
    expect(r.changed['hover/press to the surface it already has → its -hover token']).toBe(1);
  });

  it('📱 a PRESS counts too — on a phone `active:` is the only feedback there is', () => {
    // Added 2026-09-19. A finger never hovers, so `bg-raised active:bg-raised` is a button that does
    // not answer a tap — and this codemod emitted exactly that into the mobile editor toolbar, where
    // the admin then reported the controls dead. Same collapsed mapping, one variant over.
    expect(migrate('"bg-white/10 active:bg-white/20"').out).toBe('"bg-raised active:bg-raised-hover"');
    expect(migrate('"bg-black/30 active:bg-black/40"').out).toBe('"bg-well active:bg-well-hover"');
    // A press with no RESTING fill of that surface paints a real change and must be left alone.
    expect(migrate('"hover:bg-white/10 active:bg-white/10"').out).toBe('"hover:bg-raised active:bg-raised"');
    // And a press to a DIFFERENT surface is already honest feedback.
    expect(migrate('"bg-well active:bg-white/5"').out).toBe('"bg-well active:bg-raised"');
  });
});


/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * INLINE STYLE COLOURS — `style={{ color: '#818cf8' }}`
 *
 * The class table had a compat layer to be identical to; an inline style has nothing. So the proof
 * here is different in kind: every `exact` row must BE the dark palette's own value, read out of
 * index.css itself. That is what makes "Dark is unchanged, Light is repaired" a fact rather than a
 * hope — and it is why `exact` is computed from DARK_VALUE instead of inherited from the class rows,
 * where "exact" means something else entirely.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

const indexCss = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

/** The `:root, html[data-theme="dark"]` block's own declarations. */
function darkPalette(): Map<string, string> {
  const start = indexCss.indexOf('html[data-theme="dark"]');
  expect(start, 'the dark palette block is no longer spelled html[data-theme="dark"]').toBeGreaterThan(0);
  const open = indexCss.indexOf('{', start);
  const close = indexCss.indexOf('}', open);
  const body = indexCss.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

describe('🔒 every EXACT inline row IS the dark palette value — proved against index.css', () => {
  const dark = darkPalette();

  it('parsed the dark block (a canary, so a scan that matched nothing cannot pass for ever)', () => {
    expect(dark.size).toBeGreaterThan(15);
    expect(dark.get('--text-primary')).toBe('#ffffff');
    expect(dark.get('--surface-card')).toBe('#161b22');
  });

  it('DARK_VALUE agrees with index.css on every role it names', () => {
    for (const [varName, value] of Object.entries(DARK_VALUE)) {
      expect(dark.get(varName), `${varName} is not declared in the dark block`).toBeTruthy();
      expect(normaliseColour(dark.get(varName)!), varName).toBe(normaliseColour(value));
    }
  });

  it('a row whose literal equals its role value is EXACT, and Dark cannot move', () => {
    for (const [value, varName] of Object.entries(INLINE_TEXT)) {
      const r = inlineColourToken('color', value)!;
      expect(r.varName).toBe(varName);
      const same = normaliseColour(dark.get(varName) ?? '\u0000') === normaliseColour(value);
      expect(r.kind, `${value} → ${varName}`).toBe(same ? 'exact' : 'fix');
    }
  });

  it('the roles the old dark UI wrote by hand map back to themselves', () => {
    expect(inlineColourToken('color', '#818cf8')).toEqual({ varName: '--brand-accent-strong', kind: 'exact' });
    expect(inlineColourToken('color', '#f87171')).toEqual({ varName: '--brand-danger-text', kind: 'exact' });
    expect(inlineColourToken('color', 'white')).toEqual({ varName: '--text-primary', kind: 'exact' });
    expect(inlineColourToken('color', '#FFF')).toEqual({ varName: '--text-primary', kind: 'exact' });
    expect(inlineColourToken('borderColor', 'rgba(255, 255, 255, 0.1)')).toEqual({ varName: '--border-soft', kind: 'exact' });
    expect(inlineColourToken('background', '#161b22')).toEqual({ varName: '--surface-card', kind: 'exact' });
    expect(inlineColourToken('background', '#4f46e5'), 'a brand fill is never themed').toBeNull();
  });
});

describe('the white-alpha ladder — the invisible-text defect itself', () => {
  it('each band lands on the role that opacity was imitating', () => {
    expect(inlineColourToken('color', 'rgba(255,255,255,0.9)')!.varName).toBe('--text-primary');
    expect(inlineColourToken('color', 'rgba(255,255,255,0.65)')!.varName).toBe('--text-body');
    expect(inlineColourToken('color', 'rgba(255,255,255,0.5)')!.varName).toBe('--text-muted');
    expect(inlineColourToken('color', 'rgba(255,255,255,0.4)')!.varName).toBe('--text-muted');
    expect(inlineColourToken('color', 'rgba(255,255,255,0.3)')!.varName).toBe('--text-faint');
    expect(inlineColourToken('color', 'rgba(255,255,255,0.2)')!.varName).toBe('--text-faint');
  });

  it('every band is a FIX — none of them is a palette value, so Dark shifts on purpose', () => {
    for (const a of ['0.9', '0.65', '0.5', '0.4', '0.3', '0.2']) {
      expect(inlineColourToken('color', `rgba(255,255,255,${a})`)!.kind).toBe('fix');
    }
  });

  it('spacing and case do not make two colours out of one', () => {
    expect(normaliseColour('rgba(255, 255, 255, 0.1)')).toBe('rgba(255,255,255,0.1)');
    expect(normaliseColour('#ABC')).toBe('#aabbcc');
    expect(normaliseColour('  White ')).toBe('#ffffff');
  });
});

describe('a brand-coloured rule is not a divider', () => {
  it('borderLeftColor takes the meaning colour, not --border-soft', () => {
    expect(inlineColourToken('borderLeftColor', '#ef4444')!.varName).toBe('--brand-danger-text');
    expect(inlineColourToken('borderLeftColor', '#22c55e')!.varName).toBe('--brand-success-text');
  });
  it('a neutral rule still takes the divider', () => {
    expect(inlineColourToken('borderColor', 'rgba(255,255,255,0.08)')!.varName).toBe('--border-soft');
    expect(inlineColourToken('borderColor', '#30363d')!.varName).toBe('--border-soft');
  });
});

describe('what the inline pass deliberately LEAVES — nothing is guessed', () => {
  it('a low-alpha wash background is not a surface', () => {
    expect(inlineColourToken('background', 'rgba(255,255,255,0.05)')).toBeNull();
    expect(inlineColourToken('background', 'rgba(239,68,68,0.15)')).toBeNull();
  });
  it('an unknown hex is left exactly as written', () => {
    expect(inlineColourToken('color', '#123456')).toBeNull();
    expect(inlineColourToken('background', '#1a0a0a')).toBeNull();
  });
  it('a value that already follows the theme is not rewritten', () => {
    expect(inlineColourToken('color', 'var(--text-muted)')).toBeNull();
  });
  it('a property that is not a colour role is not touched', () => {
    expect(inlineColourToken('boxShadow', '#000000')).toBeNull();
  });
});

describe('text on a FIXED inline fill stays as the author wrote it', () => {
  it('inlineBackgroundKind separates a fixed fill, a wash and a themed surface', () => {
    // A BRAND fill is FIXED, not themed — TRAP 3 of tests/inlineThemeColours.test.ts (2026-08-16).
    expect(inlineBackgroundKind("style={{ background: '#4f46e5', color: 'white' }}")).toBe('fixed');
    expect(inlineBackgroundKind("style={{ background: '#1877f2' }}")).toBe('fixed');
    expect(inlineBackgroundKind("style={{ background: 'rgba(255,255,255,0.05)' }}")).toBe('wash');
    expect(inlineBackgroundKind("style={{ background: '#161b22' }}")).toBe('themed');
    expect(inlineBackgroundKind("style={{ background: user.brandColor }}")).toBe('fixed');
    expect(inlineBackgroundKind("style={{ background: 'var(--surface-card)' }}")).toBe('none');
    expect(inlineBackgroundKind('<div className="p-2">')).toBe('none');
  });

  it('a white label on somebody else\'s brand fill is left, and reported', () => {
    const src = `<b style={{ background: '#1877f2', color: 'white' }}>Go</b>`;
    const { out, left } = migrate(src);
    expect(out).toContain("color: 'white'");
    expect(Object.keys(left).join(' ')).toContain('fixed inline fill');
  });

  /* 🔴 THE REGRESSION THIS PASS ACTUALLY PRODUCED, caught in its own diff before it left the branch.
   * The guard read the LINE; a style object is routinely written over several, so `color: 'white'`
   * saw no background and became `--text-primary` — near-black, on an indigo fill, about 2.2:1. The
   * tool removing invisible labels had created one. These four cases are the lock. */
  it('🔒 a MULTI-LINE style object is ONE context — the label on a brand fill survives', () => {
    const src = [
      '<button style={{',
      "  background: '#4f46e5',",
      "  color: 'white',",
      '}}>Go</button>',
    ].join('\n');
    const { out } = migrate(src);
    expect(out).toBe(src);                       // the fill stays, and so does its label
    expect(out).not.toContain('--text-primary'); // the regression: near-black on indigo, ~2.2:1
  });

  it('🔒 a MULTI-LINE style object on a fixed foreign fill leaves its label alone', () => {
    const src = ['<b style={{', "  background: '#1877f2',", "  color: 'white',", '}}>x</b>'].join('\n');
    expect(migrate(src).out).toContain("color: 'white'");
  });

  it('every label on a brand fill is left, whatever colour it is', () => {
    const src = ['<b style={{', "  background: '#818cf8',", "  color: '#8b949e',", '}}>x</b>'].join('\n');
    expect(migrate(src).out).toContain("color: '#8b949e'");
  });

  it('styleObjectSpans finds the whole object, braces and all', () => {
    const src = "a style={{ color: '#fff', pad: { x: 1 } }} b";
    const [[from, to]] = styleObjectSpans(src);
    expect(src.slice(from, to)).toBe("style={{ color: '#fff', pad: { x: 1 } }}");
  });

  it('a label on a WASH is themed — the wash is not a background', () => {
    const src = `<b style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>x</b>`;
    expect(migrate(src).out).toContain("color: 'var(--text-muted)'");
  });
});

describe('the inline pass in migrate()', () => {
  it('rewrites the declaration and keeps the quote style', () => {
    const src = `<i style={{ color: "#8b949e", borderColor: 'rgba(255,255,255,0.1)' }} />`;
    const { out, exact } = migrate(src);
    expect(out).toContain('color: "var(--text-muted)"');
    expect(out).toContain("borderColor: 'var(--border-soft)'");
    expect(exact).toBeGreaterThanOrEqual(2);
  });

  it('🔒 embedded source is never rewritten — it is somebody else\'s app', () => {
    const src = 'const tpl = `<div class="card" style="color: #8b949e">hi</div>`;';
    expect(migrate(src).out).toBe(src);
  });

  it('🔒 the pass really fires — a canary against a regex that matches nothing', () => {
    const { changed } = migrate(`<p style={{ color: '#c9d1d9' }}>t</p>`);
    expect(Object.keys(changed).join(' ')).toContain('var(--text-body)');
  });

  it('the census stops counting a declaration once it is a var()', () => {
    const before = `<p style={{ color: '#c9d1d9' }}>t</p>`;
    expect(literalsIn(before).length).toBe(1);
    expect(literalsIn(migrate(before).out).length).toBe(0);
  });
});


describe('🔒 the two traps an earlier sweep already paid for — named, not pattern-matched', () => {
  it('a library config and the user\'s own app are skipped by NAME', () => {
    expect(inlineSkipReason('src/components/ide/ShellTerminal.tsx')).toContain('xterm');
    expect(inlineSkipReason('src/components/ide/MultiPageBuilder.tsx')).toContain("USER'S app");
    expect(inlineSkipReason('src/components/ide/DarkModeGenerator.tsx')).toBeTruthy();
    expect(inlineSkipReason('src/components/ide/WhitelabelBranding.tsx')).toBeTruthy();
    expect(inlineSkipReason('src/components/ide/AIDebugger.tsx')).toBeNull();
  });
});

describe('inlineOnlyRun — the class literals are not touched', () => {
  it('rewrites the inline style and leaves every className alone', () => {
    const src = `<i className="bg-white/10 text-gray-400" style={{ color: '#8b949e' }} />`;
    const { out } = inlineOnlyRun(src);
    expect(out).toContain('className="bg-white/10 text-gray-400"');
    expect(out).toContain("color: 'var(--text-muted)'");
  });

  it('🔒 and migrate() still DOES touch them — so the split is real, not a no-op', () => {
    const src = `<i className="bg-white/10 text-gray-400" style={{ color: '#8b949e' }} />`;
    expect(migrate(src).out).not.toContain('bg-white/10');
  });
});


describe('🔒 a fill is a fill whether it is a style or a CLASS', () => {
  /* The second half of the same regression. `styleObjectSpans` fixed "the background is on another
   * LINE"; this is "the background is not inline at all". AuthComponent's Apple button carries
   * `className="… bg-black … text-on-accent"` beside an inline `color: '#ffffff'` whose own comment
   * says it exists to be unthemeable — and the pass themed it, breaking TRAP 3. */
  it('elementAt returns the opening tag a declaration sits in', () => {
    const src = `x <button style={{ color: '#fff' }} className="bg-black">y</button>`;
    expect(elementAt(src, src.indexOf("'#fff'"))).toContain('className="bg-black"');
    expect(elementAt(src, src.indexOf("'#fff'"))).not.toContain('</button>');
  });

  it('an element that fixes its own label is recognised', () => {
    expect(elementFixesItsLabel('<b className="bg-black">')).toBe(true);
    expect(elementFixesItsLabel('<b className="bg-indigo-600">')).toBe(true);
    expect(elementFixesItsLabel('<b className="bg-raised text-on-accent">')).toBe(true);
    expect(elementFixesItsLabel('<b className="bg-card text-muted">')).toBe(false);
  });

  it('🔒 a forced white label beside a CLASS fill is left exactly as written', () => {
    const src = [
      '<button',
      "  style={{ color: '#ffffff' }}",
      '  className="w-full py-4 bg-black text-on-accent border border-line"',
      '>Sign in</button>',
    ].join('\n');
    expect(inlineOnlyRun(src).out).toBe(src);
  });

  it('and a label on an ordinary themed surface is still migrated', () => {
    const src = `<b className="bg-card" style={{ color: '#8b949e' }}>x</b>`;
    expect(inlineOnlyRun(src).out).toContain("color: 'var(--text-muted)'");
  });
});

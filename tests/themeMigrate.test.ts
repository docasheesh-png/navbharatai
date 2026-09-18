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
import { mapToken, migrate, enclosingSpan, fillContext, SOLID_FILL, TOKEN_VAR } from '../scripts/themeMigrate.mjs';
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
    const r = migrate('"text-white text-white/40 bg-white text-black"');
    expect(r.exact).toBe(1);
    expect(r.fix).toBe(1);
    expect(r.left).toEqual({ 'bg-white': 1, 'text-black': 1 });
    expect(r.changed).toEqual({ 'text-white → text-ink': 1, 'text-white/40 → text-faint': 1 });
  });
  it('an arbitrary opacity is normalised first, so bg-white/[0.02] cannot become a 2% raised surface', () => {
    expect(migrate('"bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.08]"').out).toBe('"bg-raised hover:bg-raised border-line"');
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

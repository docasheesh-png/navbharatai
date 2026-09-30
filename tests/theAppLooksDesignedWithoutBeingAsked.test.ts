// "APP/GAME EK DAM SIMPLE SE HTML BANTE HAI — NA KOI DESIGN, NA SUNDARTA, NA ANIMATIONS" (admin 2026-09-30).
//
// Rendered in a real browser, the kit looked designed ONLY when the model used its class names. The same
// to-do screen written with the model's own names (`.app`, `.todo-list`, a bare <button>) rendered as raw
// HTML: white buttons with a grey hairline, a bulleted list, nothing else. And a game's "Tap to Start" was
// a line of text. Most generated markup is the second kind, so that is what users saw.
//
// Fixed at four points, each locked below:
//   1. the kit's ELEMENT layer is designed and has ZERO specificity (:where), so markup nobody styled
//      looks designed and an app's own class always wins;
//   2. fill and ink are separate tokens and every new colour pair is contrast-checked here (WCAG AA);
//   3. the fast lane — where most small apps are built — is told the kit's classes by name, only where
//      the scaffold really ships the kit, and its stylesheet call no longer re-styles kit classes;
//   4. a one-file app keeps the kit: the platform folds the linked stylesheet into index.html.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { StaticProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/StaticProvider';
import { frameworkShipsDesignKit, frameworksShippingDesignKit } from '../src/server/AgentV3/designKitReach';
import {
  DESIGN_CONTRACT, DESIGN_KIT_VOCABULARY, designContractFor, fileSystemPrompt, stylesheetClassContext,
} from '../src/server/AgentV3/SimpleBuilder';
import { SINGLE_HTML_FILE_RULE, architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { inlineLinkedStylesheet } from '../src/server/AgentV3/singleFileKit';
import { parseCssBlocks } from '../src/server/AgentV3/kitRestore';
import { themeTsx } from '../src/server/AgentV3/goldenScaffolds/base';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// ── WCAG contrast, computed — never eyeballed ────────────────────────────────────────────────────
type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB;
};
const lum = ([r, g, b]: RGB) => {
  const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** `color-mix(in srgb, a p%, b)` — interpolation in encoded sRGB, exactly as the browser does it. */
const mix = (a: RGB, p: number, b: RGB): RGB => a.map((v, i) => v * p + b[i] * (1 - p)) as RGB;

function tokens(): { light: Record<string, string>; dark: Record<string, string> } {
  const blocks = parseCssBlocks(DESIGN_KIT_CSS);
  const decl = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)].map((m) => [m[1], m[2]]));
  const light = decl(blocks.find((b) => b.prelude === ':root')!.body);
  const darkBlock = blocks.find((b) => /prefers-color-scheme:\s*dark/.test(b.prelude))!;
  const dark = { ...light, ...decl(darkBlock.body) };
  return { light, dark };
}

describe('2 · every new colour pair reads (WCAG AA 4.5:1), in both themes', () => {
  const t = tokens();
  for (const [name, tk] of Object.entries(t)) {
    const c = (k: string) => { expect(tk[k], `${name} ${k}`).toBeDefined(); return hex(tk[k]); };
    const pairs: Array<[string, RGB, RGB]> = [
      ['a bare button: accent ink on the soft tint', c('--accent-ink'), c('--accent-soft')],
      ['a bare button on hover', c('--accent-ink'), mix(c('--accent'), 0.18, c('--card'))],
      ['a filled button: white on the strong fill', c('--accent-fg'), c('--accent-strong')],
      ['a filled button: white on the deep fill', c('--accent-fg'), c('--accent-deep')],
      ['a destructive button', c('--danger-ink'), mix(c('--danger'), 0.12, c('--card'))],
      ['the game button\'s second colour', c('--accent-fg'), c('--accent-2')],
      ['game text on the stage', c('--game-fg'), c('--game-bg')],
      ['an unselected tab on the tab strip', mix(c('--fg'), 0.78, c('--bg')), mix(c('--fg'), 0.06, c('--bg'))],
      ['body text on a card', c('--fg'), c('--card')],
    ];
    for (const [what, fg, bg] of pairs) {
      it(`${name}: ${what}`, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5));
    }
  }

  it('🔴 the reason fill and ink are separate: white on the dark theme\'s --accent fails', () => {
    // If a later edit folds the fill back into --accent, dark-mode buttons drop to 3.4:1.
    expect(ratio(hex('#ffffff'), hex(t.dark['--accent']))).toBeLessThan(4.5);
  });

  it('the golden templates\' theme switch carries every new token, in both themes', () => {
    // Pinning dark while the device is light would otherwise take --accent-ink from the LIGHT tokens
    // and put dark ink on the dark tint.
    for (const theme of ['light', 'dark']) {
      const block = new RegExp(`\\[data-theme='${theme}'\\]\\{([^}]*)\\}`).exec(themeTsx)?.[1] ?? '';
      for (const tok of ['--accent-ink', '--accent-strong', '--accent-deep', '--danger-ink']) {
        expect(block, `${theme} ${tok}`).toContain(`${tok}:`);
      }
    }
  });
});

describe('1 · the element layer is designed, and never beats the app', () => {
  const blocks = parseCssBlocks(DESIGN_KIT_CSS).filter((b) => !b.prelude.startsWith('@') && b.prelude !== ':root');
  /** A selector naming an element with no class, id or :root/body/html — the ones that must be :where. */
  const bareElement = (sel: string) => /^(button|input|textarea|select|ul|ol|table|th|td|hr|code|kbd|progress|meter)\b/.test(sel.trim());

  it('🔒 every bare-element rule is wrapped in :where() — zero specificity', () => {
    /** Split a selector list on its TOP-LEVEL commas — a comma inside :where(…) is part of one selector. */
    const topLevel = (sel: string) => {
      const out: string[] = []; let depth = 0; let cur = '';
      for (const ch of sel) {
        if (ch === '(') depth++; else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      return [...out, cur.trim()];
    };
    const offenders = blocks.flatMap((b) => topLevel(b.prelude)).filter(bareElement);
    expect(offenders).toEqual([]);
  });

  it('a bare button is TINTED, not white-on-white, and a submit button is filled', () => {
    const btn = blocks.find((b) => b.prelude.startsWith(':where(button), .btn'))!;
    expect(btn.body).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(btn.body).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(btn.body).not.toMatch(/background:\s*var\(--card\)/);
    const submit = blocks.find((b) => b.prelude.startsWith(':where(button[type="submit"])'))!;
    expect(submit.body).toMatch(/linear-gradient\(135deg, var\(--accent-strong\), var\(--accent-deep\)\)/);
  });

  it('a classed list loses its bullets, a destructive button turns red, a bare table is a table', () => {
    expect(DESIGN_KIT_CSS).toContain(':where(ul[class], ol[class]) { list-style: none; padding-left: 0; }');
    expect(DESIGN_KIT_CSS).toMatch(/:where\(button\[class\*="delete" i\][^{]*\{[^}]*var\(--danger-ink\)/);
    expect(DESIGN_KIT_CSS).toContain(':where(table)');
  });

  it('checkboxes and radios are not given padding and a border — they would deform', () => {
    expect(DESIGN_KIT_CSS).toContain(':where(input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"]), textarea, select)');
  });
});

describe('3 · the recipes people actually build: games, chat, tabs, toast', () => {
  const NEW = [
    'nb-tabs', 'nb-tab', 'nb-toast', 'nb-gradient-text', 'nb-chat', 'nb-msg', 'nb-msg-user', 'nb-msg-bot',
    'nb-composer', 'nb-typing', 'nb-stagger', 'nb-game', 'nb-game-screen', 'nb-game-title', 'nb-game-sub',
    'nb-game-btn', 'nb-game-btn-secondary', 'nb-game-hud', 'nb-game-stat', 'nb-game-bar', 'nb-game-bar-fill',
    'nb-game-pad', 'nb-game-keys', 'nb-game-key',
  ];
  const architect = architectSystemPrompt('vite-react');
  const fastLane = DESIGN_KIT_VOCABULARY.join('\n');

  // The fast lane's vocabulary is compact on purpose (it rides in every per-file call); these three are
  // decoration it can live without. The architect is told about every one.
  const FAST_LANE_OMITS = new Set(['nb-typing', 'nb-game-sub', 'nb-gradient-text']);
  for (const cls of NEW) {
    it(`.${cls} exists in the kit and the builders are told about it`, () => {
      expect(DESIGN_KIT_CSS).toMatch(new RegExp(`\\.${cls}[\\s{.,:>\\[]`));
      expect(architect, `architect prompt never names .${cls}`).toContain(cls);
      if (!FAST_LANE_OMITS.has(cls)) expect(fastLane, `fast lane never names .${cls}`).toContain(cls);
    });
  }

  it('🔒 a game\'s start button is a REAL button, in both builders\' words', () => {
    expect(architect).toContain('REAL `<button class="nb-game-btn">`');
    expect(architect).toMatch(/clickable\s+'?\s*<div>|clickable <div>/);
    expect(fastLane).toContain('REAL `<button class="nb-game-btn">`');
  });

  it('motion stays inside the kit\'s own rules: transform/opacity, and reduced motion quiets it', () => {
    expect(DESIGN_KIT_CSS).toMatch(/@keyframes nb-pulse \{[^}]*transform/);
    expect(DESIGN_KIT_CSS).toMatch(/\.nb-game-bar-fill \{[^}]*transform: scaleX\(var\(--value, 1\)\)/);
    expect(DESIGN_KIT_CSS).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.nb-game-btn:hover/);
  });
});

describe('4 · the fast lane is told the kit by name — only where the kit is', () => {
  it('the registry, not a hand list, decides which scaffolds ship the kit', () => {
    const set = frameworksShippingDesignKit();
    for (const id of ['vite-react', 'vue', 'svelte', 'preact', 'solid', 'alpine', 'vanilla', 'static', 'nextjs', 'nuxt', 'sveltekit', 'angular']) {
      expect(set.has(id), id).toBe(true);
    }
    for (const id of ['remix', 'astro', 'lit', 'node-express', 'python-fastapi']) expect(set.has(id), id).toBe(false);
    expect(frameworkShipsDesignKit('')).toBe(true);
    expect(frameworkShipsDesignKit(undefined)).toBe(true);
    expect(frameworkShipsDesignKit('react')).toBe(true);
    expect(frameworkShipsDesignKit('remix')).toBe(false);
  });

  it('the per-file prompt carries the vocabulary where the kit ships, and only the bar elsewhere', () => {
    expect(designContractFor('vite-react')).toEqual([...DESIGN_CONTRACT, ...DESIGN_KIT_VOCABULARY]);
    expect(designContractFor('remix')).toEqual(DESIGN_CONTRACT);
    expect(fileSystemPrompt('vite-react')).toContain('ALREADY IS A DESIGN KIT');
    expect(fileSystemPrompt('remix')).not.toContain('ALREADY IS A DESIGN KIT');
  });

  it('🔴 the stylesheet call no longer re-styles kit classes', () => {
    const produced = [{ path: 'src/App.tsx', content: '<div className="card todo-row"><button className="btn-primary">Add</button></div>' }];
    const kitApp = stylesheetClassContext(produced as never, 'vite-react');
    const [toStyle, already] = kitApp.split('ALREADY STYLED');
    expect(toStyle).toContain('.todo-row');
    expect(toStyle).not.toContain('.card');
    expect(already).toContain('.card');
    expect(already).toContain('.btn-primary');
    // Where the kit is not in the project, the same class is the stylesheet's job.
    const remix = stylesheetClassContext(produced as never, 'remix');
    expect(remix).not.toContain('ALREADY STYLED');
    expect(remix).toContain('.card');
  });
});

describe('5 · a one-file app keeps its design', () => {
  it('the linked stylesheet is folded into the page, attributes in any order', () => {
    for (const link of ['<link rel="stylesheet" href="style.css" />', "<link href='./style.css' rel=stylesheet>", '<LINK REL="stylesheet" HREF="style.css">']) {
      const out = inlineLinkedStylesheet(`<head>${link}<style>.mine{}</style></head>`, 'style.css', '.card{color:red}');
      expect(out, link).toBe('<head><style>\n.card{color:red}\n</style><style>.mine{}</style></head>');
    }
  });

  it('never touches a page that does not link it, another stylesheet, or an empty file', () => {
    expect(inlineLinkedStylesheet('<head><style>x{}</style></head>', 'style.css', 'a{}')).toBeNull();
    expect(inlineLinkedStylesheet('<head><link rel="stylesheet" href="theme.css"></head>', 'style.css', 'a{}')).toBeNull();
    expect(inlineLinkedStylesheet('<head><link rel="icon" href="style.css"></head>', 'style.css', 'a{}')).toBeNull();
    expect(inlineLinkedStylesheet('<head><link rel="stylesheet" href="style.css"></head>', 'style.css', '  ')).toBeNull();
  });

  it('a stylesheet cannot close its own <style> tag', () => {
    const out = inlineLinkedStylesheet('<link rel="stylesheet" href="style.css">', 'style.css', 'a::after{content:"</style>"}')!;
    expect(out.match(/<\/style>/g)).toHaveLength(1);
  });

  it('the rule keeps style.css; the route folds it in after the build and says so', () => {
    expect(SINGLE_HTML_FILE_RULE).toMatch(/KEEP style\.css and its <link>/);
    expect(SINGLE_HTML_FILE_RULE).not.toMatch(/delete the scaffold's style\.css/);
    const route = read('src/server/routes/agentv3.ts');
    const at = route.indexOf("inlineLinkedStylesheet(cleanIndex, 'style.css', kitCss)");
    expect(at).toBeGreaterThan(0);
    const block = route.slice(at - 1200, at + 2600);
    expect(block).toContain('if (singleHtmlFileRule && result.ok && expectsArtifacts)');
    expect(block).toContain("withoutPreviewBridge('index.html', sandboxIndex)"); // never persist the preview bridge
    expect(block).toContain("writtenFiles.delete('style.css')");
    expect(block).toContain("removeWorkspaceFiles(workspaceId, ['style.css'])");
    expect(block).toContain("code: 'SINGLE_FILE_KIT_INLINED'");
    expect(at).toBeLessThan(route.indexOf('E2E NET, WRITTEN NOT RUN'));
    for (const f of ['src/server/AgentV3/BuildDiagnostics.ts', 'src/server/AgentV3/buildFindingSuggestions.ts']) {
      expect(read(f)).toContain("'SINGLE_FILE_KIT_INLINED'");
    }
  });

  it('🔴 the static starter styles no longer override the kit on every page', () => {
    const css = new StaticProvider().getFiles([])['style.css'];
    const own = css.slice(DESIGN_KIT_CSS.length);
    // Page-wide rules AFTER the kit beat its element layer: every button one flat fill, every page centred.
    for (const bare of [/^\s*\*[\s,{]/m, /^\s*body\s*\{/m, /^\s*button\s*\{/m, /^\s*main\s*\{/m, /^\s*h1\s*\{/m]) {
      expect(own).not.toMatch(bare);
    }
    expect(own).toContain('.starter');
    expect(new StaticProvider().getFiles([])['index.html']).toContain('class="starter"');
  });
});

// A REAL BROWSER, where one exists (a session container; CI has none and skips it visibly). Strings
// prove what is written; this proves what the CASCADE does with it.
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('in a real browser', () => {
  it('unstyled markup looks designed, and an app\'s own class always wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-kit-'));
    writeFileSync(join(dir, 'page.html'), `<!doctype html><html><head><style>${DESIGN_KIT_CSS}
      .mine { background: rgb(1, 2, 3); color: rgb(250, 250, 250); }
      .their-submit { background: rgb(9, 99, 9); }
      .their-list { list-style: square; }
    </style></head><body>
      <button id="bare">Add</button>
      <button id="del" class="delete-btn">Delete</button>
      <button id="mine" class="mine">Mine</button>
      <button id="sub" type="submit" class="their-submit">Save</button>
      <ul id="ul" class="todo-list"><li>a</li></ul>
      <ul id="ul2" class="their-list"><li>b</li></ul>
    </body></html>`);
    const script = join(dir, 'run.mjs');
    writeFileSync(script, `import playwright from '${PW}';
      const b = await playwright.chromium.launch();
      const p = await b.newPage();
      await p.goto('file://${join(dir, 'page.html')}');
      const r = await p.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id));
        return {
          bareBg: cs('bare').backgroundColor, bareColor: cs('bare').color, bareBorder: cs('bare').borderTopColor,
          delColor: cs('del').color, mineBg: cs('mine').backgroundColor, mineColor: cs('mine').color,
          subBg: cs('sub').backgroundColor, subImage: cs('sub').backgroundImage,
          ul: cs('ul').listStyleType, ul2: cs('ul2').listStyleType,
        };
      });
      console.log(JSON.stringify(r));
      await b.close();`);
    const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }).toString().trim().split('\n').pop()!);
    expect(out.bareBg).toBe('rgb(238, 240, 255)');   // the accent tint, not white
    expect(out.bareColor).toBe('rgb(67, 56, 202)');  // accent ink
    expect(out.delColor).toBe('rgb(185, 28, 28)');   // danger ink
    expect(out.mineBg).toBe('rgb(1, 2, 3)');         // the app's own class wins
    expect(out.mineColor).toBe('rgb(250, 250, 250)');
    expect(out.subImage).toBe('none');               // the app's submit colour beats the kit's gradient…
    expect(out.subBg).toBe('rgb(9, 99, 9)');         // …where the old (0,1,1) rule silently beat it
    expect(out.ul).toBe('none');
    expect(out.ul2).toBe('square');
  }, 90_000);
});

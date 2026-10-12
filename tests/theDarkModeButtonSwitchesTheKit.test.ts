// THE DARK-MODE BUTTON THAT DID NOTHING (autopsy db07e0af, 2026-10-12).
//
// A todo app's light/dark button put `dark` on <html> and nothing changed: the design kit's dark palette lived only
// inside `@media (prefers-color-scheme: dark)`. The explorer caught it and a repair added `:root.dark` — and on a phone
// set to dark there was still no way back to light, because nothing could beat the media query. 8257ca59 was the
// same class from the other side (a switch setting a hook nothing styled). Fixed where the class is born:
//   1. the kit styles the hooks switches actually set — `dark`/`light` class and `data-theme` on <html> or <body> —
//      generated from the SAME palette as the media query, so the two can never drift;
//   2. in a real browser, each switch beats the device setting in both directions;
//   3. the switch blocks are palette, not component classes: no screen is told `.dark` is "already styled", and a
//      rewrite of the stylesheet carries them along with the tokens;
//   4. the preview panel's own switch forces light too, and reports what the page really looks like;
//   5. both build lanes are told which hooks the kit styles.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import {
  DESIGN_KIT_CSS, KIT_DARK_SWITCH, KIT_LIGHT_SWITCH, withThemeSwitch,
} from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { parseCssBlocks, kitClasses, keepKitOnRewrite, kitRestorePatch, appOwnStylesheet } from '../src/server/AgentV3/kitRestore';
import { stylesheetClassContext, DESIGN_KIT_VOCABULARY } from '../src/server/AgentV3/SimpleBuilder';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';
import { hookIsStyled } from '../src/server/AgentV3/deadThemeSwitch';
import { makeTempDir } from './helpers/tempDir';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const KIT_BEFORE = gunzipSync(readFileSync(join(__dirname, 'fixtures/designKitBeforeThemeSwitch.css.gz'))).toString('utf8');
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const blocks = parseCssBlocks(DESIGN_KIT_CSS);
const blockOf = (prelude: string) => blocks.find((b) => b.prelude === prelude);

describe('1 · the kit styles the switch, from one palette', () => {
  const light = decls(blockOf(':root')!.body);
  const media = blocks.find((b) => /prefers-color-scheme:\s*dark/.test(b.prelude))!;
  const dark = decls(parseCssBlocks(media.body).find((r) => r.prelude === ':root')!.body);

  it('both switch blocks exist, on <html> and <body>, for the class and for data-theme', () => {
    for (const sel of [':root.dark', ':root[data-theme="dark"]', 'body.dark', 'body[data-theme="dark"]']) expect(KIT_DARK_SWITCH).toContain(sel);
    for (const sel of [':root.light', ':root[data-theme="light"]', 'body.light', 'body[data-theme="light"]']) expect(KIT_LIGHT_SWITCH).toContain(sel);
    expect(blockOf(KIT_DARK_SWITCH)).toBeDefined();
    expect(blockOf(KIT_LIGHT_SWITCH)).toBeDefined();
  });
  it('the dark switch carries exactly the media query\'s palette, the light switch the :root value of each', () => {
    const d = decls(blockOf(KIT_DARK_SWITCH)!.body);
    const l = decls(blockOf(KIT_LIGHT_SWITCH)!.body);
    for (const [k, v] of Object.entries(dark)) {
      expect(d[k], `dark ${k}`).toBe(v);
      expect(l[k], `light ${k}`).toBe(light[k]);
    }
    expect(blockOf(KIT_DARK_SWITCH)!.body).toContain('color-scheme: dark');
    expect(blockOf(KIT_LIGHT_SWITCH)!.body).toContain('color-scheme: light');
  });
  it('a token computed from a switched one (--ring) is re-declared, so <body> switches it too', () => {
    expect(decls(blockOf(KIT_DARK_SWITCH)!.body)['--ring']).toBe(light['--ring']);
  });
  it('the system-preference block itself is unchanged', () => {
    const was = parseCssBlocks(KIT_BEFORE).find((b) => /prefers-color-scheme:\s*dark/.test(b.prelude))!;
    expect(media.body).toBe(was.body);
  });
  it('generated, so it cannot drift: the old kit run through the generator is the new kit', () => {
    expect(withThemeSwitch(KIT_BEFORE)).toBe(DESIGN_KIT_CSS);
  });
  it('the dead-switch detector now sees both hooks as styled in a kit project', () => {
    const project = { 'src/index.css': DESIGN_KIT_CSS };
    expect(hookIsStyled({ kind: 'class', name: 'dark' }, project)).toBe(true);
    expect(hookIsStyled({ kind: 'attribute', name: 'data-theme' }, project)).toBe(true);
  });
});

describe('3 · palette, not component classes', () => {
  it('the kit does not claim `dark` or `light` as classes a screen can use', () => {
    expect(kitClasses().has('dark')).toBe(false);
    expect(kitClasses().has('light')).toBe(false);
  });
  it('the fast lane is never told a screen\'s `.dark` wrapper is "already styled by the kit"', () => {
    const ctx = stylesheetClassContext([{ path: 'src/App.tsx', content: 'export default function App(){ return <div className="app dark"><p className="card">x</p></div>; }' }] as never, 'vite-react');
    expect(ctx).toMatch(/CLASS NAMES THE SCREENS ALREADY USE[\s\S]*\.dark/);
    expect(ctx.split('ALREADY STYLED')[1] ?? '').not.toContain('.dark');
  });
  it('the review still sees the switch blocks as ours, not the app\'s', () => {
    const own = appOwnStylesheet(`${DESIGN_KIT_CSS}\n.todo { color: red; }`) ?? '';
    expect(own).toContain('.todo');
    expect(own).not.toContain(':root.dark');
  });
  it('a rewrite of the stylesheet that drops the kit keeps the switch, in the NEW palette', () => {
    const after = `:root { --bg: #fffbeb; --fg: #1c1917; }\n@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #fafaf9; } }\n.todo-row { padding: 8px; }\n`;
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, after);
    expect(keep).not.toBeNull();
    const kept = parseCssBlocks(keep!.content);
    const d = kept.find((b) => b.prelude === KIT_DARK_SWITCH);
    const l = kept.find((b) => b.prelude === KIT_LIGHT_SWITCH);
    expect(d, 'dark switch carried').toBeDefined();
    expect(l, 'light switch carried').toBeDefined();
    expect(decls(d!.body)['--bg']).toBe('#1c1917');   // the rewrite's own dark value
    expect(decls(l!.body)['--bg']).toBe('#fffbeb');   // the rewrite's own light value
    expect(decls(d!.body)['--card']).toBe('#17171f'); // a token it never set: the old file's
  });
  it('a rewrite that styles its own switch is left alone', () => {
    const after = `:root { --bg: #fff; }\nhtml.dark { --bg: #000; }\n.todo-row { padding: 8px; }\n`;
    const keep = keepKitOnRewrite('src/index.css', DESIGN_KIT_CSS, after);
    expect(keep?.content ?? '').not.toContain(KIT_DARK_SWITCH);
  });
  it('tokens restored into an app that lost the kit come with the switch', () => {
    const files = {
      'src/App.tsx': 'export default function App(){ return <div className="nb-empty"><p className="nb-empty-title">Nothing</p></div>; }',
      'src/main.tsx': "import './index.css';",
      'src/index.css': '.app { padding: 8px; }\n',
    };
    const patch = kitRestorePatch(files, {} as NodeJS.ProcessEnv);
    expect(patch).not.toBeNull();
    expect(patch!.tokens).toEqual(['--fg', '--muted']);
    const restored = parseCssBlocks(patch!.content);
    expect(decls(restored.find((b) => b.prelude === KIT_DARK_SWITCH)!.body)).toEqual({ '--fg': '#ececf1', '--muted': '#9ca3af' });
    expect(decls(restored.find((b) => b.prelude === KIT_LIGHT_SWITCH)!.body)).toEqual({ '--fg': '#17171c', '--muted': '#6b7280' });
  });
});

describe('4 · the preview panel\'s own switch', () => {
  const src = previewBridgeSource('live');
  it('"light" sets `light`, which beats the device setting; "dark" clears it', () => {
    expect(src).toContain("document.documentElement.classList.toggle('dark', d.__nbaiTheme === 'dark');");
    expect(src).toContain("document.documentElement.classList.toggle('light', d.__nbaiTheme === 'light');");
  });
  it('it reports what the page really looks like, not only whether the class is there', () => {
    expect(src).toContain('isDark: looksDark(),');
    expect(src).not.toContain("isDark: !!(document.documentElement && document.documentElement.classList.contains('dark'))");
  });
});

describe('5 · both lanes are told the hooks the kit styles', () => {
  it('the architect', () => {
    const p = read('src/server/AgentV3/systemPrompt.ts');
    expect(p).toContain('a light/dark SWITCH sets `data-theme="dark"` / `"light"` (or the class');
    expect(p).not.toContain('the scaffold already does via prefers-color-scheme + src/theme.tsx');
  });
  it('the fast lane', () => {
    expect(DESIGN_KIT_VOCABULARY.join('\n')).toContain('A light/dark SWITCH sets `data-theme="dark"` / `"light"` (or the class `dark` / `light`) on <html>');
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('2 · in a real browser, every switch beats the device setting', () => {
  it('dark and light, class and data-theme, <html> and <body>, on a light and on a dark device', () => {
    const dir = makeTempDir('nbai-theme-switch-');
    writeFileSync(join(dir, 'kit.css'), DESIGN_KIT_CSS);
    writeFileSync(join(dir, 'page.html'), '<!doctype html><html><head><link rel="stylesheet" href="kit.css"></head><body><main class="card">x</main></body></html>');
    const script = join(dir, 'run.mjs');
    writeFileSync(script, `import playwright from '${PW}';
      const b = await playwright.chromium.launch();
      const out = {};
      for (const scheme of ['light', 'dark']) {
        const p = await b.newPage({ colorScheme: scheme });
        await p.goto('file://${join(dir, 'page.html')}');
        const cases = [['none', null, null], ['html.dark', 'html', 'c:dark'], ['html.light', 'html', 'c:light'],
          ['html[dt=dark]', 'html', 'a:dark'], ['html[dt=light]', 'html', 'a:light'],
          ['body.dark', 'body', 'c:dark'], ['body.light', 'body', 'c:light'], ['body[dt=dark]', 'body', 'a:dark'], ['body[dt=light]', 'body', 'a:light']];
        for (const [name, where, how] of cases) {
          out[scheme + ' ' + name] = await p.evaluate(([where, how]) => {
            for (const el of [document.documentElement, document.body]) { el.className = ''; el.removeAttribute('data-theme'); }
            if (where) {
              const el = where === 'html' ? document.documentElement : document.body;
              const [k, v] = how.split(':');
              if (k === 'c') el.classList.add(v); else el.setAttribute('data-theme', v);
            }
            return getComputedStyle(document.querySelector('main')).getPropertyValue('--bg').trim();
          }, [where, how]);
        }
        await p.close();
      }
      console.log(JSON.stringify(out));
      await b.close();`);
    const out = JSON.parse(execFileSync(process.execPath, [script], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 60_000 }).toString().trim().split('\n').pop()!);
    const LIGHT = '#f6f7fb';
    const DARK = '#0d0d12';
    for (const scheme of ['light', 'dark']) {
      expect(out[`${scheme} none`], `${scheme} device, no switch: follows the device`).toBe(scheme === 'dark' ? DARK : LIGHT);
      for (const where of ['html', 'body']) {
        expect(out[`${scheme} ${where}.dark`], `${scheme} device, ${where}.dark`).toBe(DARK);
        expect(out[`${scheme} ${where}.light`], `${scheme} device, ${where}.light`).toBe(LIGHT);
        expect(out[`${scheme} ${where}[dt=dark]`], `${scheme} device, ${where} data-theme=dark`).toBe(DARK);
        expect(out[`${scheme} ${where}[dt=light]`], `${scheme} device, ${where} data-theme=light`).toBe(LIGHT);
      }
    }
  }, 90_000);
});

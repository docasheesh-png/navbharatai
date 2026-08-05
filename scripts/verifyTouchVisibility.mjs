// Real-browser verification of the touch-visibility fix (admin 2026-08-05).
//
// The source tests assert that no IDE control uses an UNGATED `opacity-0 group-hover:opacity-100`.
// That proves the class string changed. It does NOT prove the replacement behaves correctly — that
// `[@media(hover:hover)]:opacity-0` really leaves the control visible on a phone and still hides it
// until hover on a desktop. Only a browser can answer that, so this asks one.
//
// It renders the EXACT class strings taken from the source, against the app's REAL built CSS, in two
// Chromium contexts — one touch (no hover), one desktop (hover capable) — and reads computed opacity.
//
// Run: node scripts/verifyTouchVisibility.mjs   (needs `npm run build` first, and a Chromium)
// Deliberately NOT wired into CI: it needs a browser binary CI does not install today, and a check
// that silently skips is worse than one that is run deliberately and reported.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLASSES = {
  'FileExplorer row actions (delete / open in GitHub)':
    'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity flex items-center gap-0.5',
  'Editor tab close ✕ (background tab)':
    'p-0.5 rounded hover:bg-white/10 transition-opacity opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
  'DebugPanel remove-breakpoint ✕':
    'p-1 -m-1 text-zinc-500 hover:text-rose-400 opacity-70 group-hover:opacity-100 transition-opacity shrink-0',
};

const assets = join('dist', 'assets');
if (!existsSync(assets)) { console.error('No dist/ — run `npm run build` first.'); process.exit(1); }
const cssFile = readdirSync(assets).find((f) => f.endsWith('.css') && f.startsWith('index'));
const css = readFileSync(join(assets, cssFile), 'utf8');

const { chromium } = await import('playwright');
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
  .find((p) => existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const html = `<style>${css}</style><body>` +
  Object.entries(CLASSES).map(([name, cls], i) =>
    `<div class="group" style="padding:8px"><span>row</span><div id="t${i}" class="${cls}" data-name="${name}">ACTION</div></div>`).join('') +
  `</body>`;

async function measure(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.setContent(html);
  const out = await page.evaluate((n) => {
    const r = [];
    for (let i = 0; i < n; i++) {
      const el = document.getElementById('t' + i);
      r.push({ name: el.dataset.name, opacity: getComputedStyle(el).opacity });
    }
    return r;
  }, Object.keys(CLASSES).length);
  await ctx.close();
  return out;
}

const touch = await measure({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const desk = await measure({ viewport: { width: 1440, height: 900 } });
await browser.close();

let failed = 0;
console.log('\nComputed opacity of each control, as Chromium renders it:\n');
for (let i = 0; i < touch.length; i++) {
  const visibleOnTouch = Number(touch[i].opacity) > 0;
  if (!visibleOnTouch) failed++;
  console.log(`  ${visibleOnTouch ? '✅' : '❌'} ${touch[i].name}`);
  console.log(`       touch (no hover): opacity ${touch[i].opacity}   desktop (hover capable): ${desk[i].opacity}`);
}
console.log(failed === 0
  ? '\n✅ Every control is visible — and therefore tappable — on a touch device.\n'
  : `\n❌ ${failed} control(s) still invisible on touch.\n`);
process.exit(failed === 0 ? 0 : 1);

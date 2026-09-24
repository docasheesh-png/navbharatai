// EVERY shortcut in the Code Studio Shortcuts panel, pressed in a REAL browser, with its observable
// effect asserted (admin 2026-09-24: "sabhi list ko ek ek kar ke verify karo").
//
//   npm run build                                   # dist/monaco must exist (the editor loads from it)
//   npx vite build --config scripts/ideShortcutAudit/vite.config.ts
//   PLAYWRIGHT_CORE=/path/to/playwright-core node scripts/ideShortcutAudit/audit.mjs phone     # 390x844
//   PLAYWRIGHT_CORE=/path/to/playwright-core node scripts/ideShortcutAudit/audit.mjs desktop   # 1280x800
//   … audit.mjs phone "Undo,Format Document"        # only these labels
//
// One line per shortcut: OK / DEAD / ERR with the evidence. Not part of CI — it takes ~6 minutes per
// viewport and needs a browser; it is the tool a session runs before claiming a shortcut works.
// Playwright is not a dependency of this repo (the sandbox's pre-baked browser is what runs it);
// point PLAYWRIGHT_CORE at any installed playwright-core, and CHROME at a Chromium binary.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
import http from 'http';
import { readFileSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const VIEWPORT = process.argv[2] === 'desktop' ? { width: 1280, height: 800 } : { width: 390, height: 844 };
const MOBILE = process.argv[2] !== 'desktop';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null; // optional: run only these labels

const HARNESS = 'scripts/ideShortcutAudit/dist';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json', '.map': 'application/json' };
const srv = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/studio.html';
  const p = url.startsWith('/monaco/') ? join('dist', url) : join(HARNESS, url);
  if (!existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: MOBILE, hasTouch: MOBILE, permissions: ['clipboard-read', 'clipboard-write'] });
// Nothing may leave the machine: firebase, fonts, anything.
await ctx.route(/^(?!http:\/\/127\.0\.0\.1)/, (r) => r.abort());

/** Open a fresh page with the editor ready and the shortcuts popup open. */
async function fresh() {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|firebase|Firebase|net::ERR/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(base + '/');
  // The editor: wait for Monaco to mount a model for the active file.
  await page.waitForFunction(() => window.monaco && window.monaco.editor.getEditors().length > 0 && window.monaco.editor.getEditors()[0].getModel(), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { page, errors };
}
const ed = (page) => page.evaluate(() => { const e = window.monaco.editor.getEditors().find((x) => x.hasTextFocus()) || window.monaco.editor.getEditors()[0]; return e; });
const evalEd = (page, fn) => page.evaluate(`(() => { const ed = window.monaco.editor.getEditors().find((x) => x.hasTextFocus()) || window.monaco.editor.getEditors()[0]; return (${fn})(ed); })()`);

async function openPopup(page) {
  if (await page.locator('text=VS Code – Master Keyboard Shortcuts').count()) return;
  if (MOBILE) {
    await page.click('button:has-text("More")');
    await page.click('button:has-text("Shortcuts")');
  } else {
    await page.click('button[aria-label="Shortcuts"]');
  }
  await page.waitForSelector('text=VS Code – Master Keyboard Shortcuts');
}
async function pressShortcut(page, label) {
  await openPopup(page);
  await page.click('text=Select a shortcut function', { timeout: 5000 }).catch(async () => { await page.click('button:has(.lucide-search)'); });
  await page.fill('input[placeholder="Search 100+ shortcuts..."]', label);
  const row = page.locator(`button:has(span:text-is("${label}"))`).first();
  await row.click();
  await page.click('button[aria-label="Run the selected shortcut"]');
  await page.waitForTimeout(350);
}
/** Put the cursor at a line/column in the editor and focus it (the popup keeps the editor mounted). */
const setPos = (page, line, col = 1) => evalEd(page, `(ed) => { ed.setPosition({ lineNumber: ${line}, column: ${col} }); ed.focus(); }`);
const value = (page) => evalEd(page, '(ed) => ed.getModel().getValue()');
const lineCount = (page) => evalEd(page, '(ed) => ed.getModel().getLineCount()');
const pos = (page) => evalEd(page, '(ed) => { const p = ed.getPosition(); return [p.lineNumber, p.column]; }');
const sel = (page) => evalEd(page, '(ed) => { const s = ed.getSelection(); return [s.startLineNumber, s.startColumn, s.endLineNumber, s.endColumn]; }');
const selCount = (page) => evalEd(page, '(ed) => ed.getSelections().length');
const visible = (page, css) => page.evaluate((c) => { const el = document.querySelector(c); if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; }, css);
const textVisible = (page, t) => page.locator(`text=${t}`).first().isVisible().catch(() => false);
const panelOpen = async (p) => (await p.locator('.xterm').count()) > 0 || (await p.locator('text=/new terminal/i').count()) > 0 || (await p.locator('text=/sandbox/i').count()) > 0;
const calls = (page) => page.evaluate(() => window.__calls.map((c) => c.what));

// Each check: name (the panel label), an optional setup, and a probe returning { ok, note }.
const CHECKS = [
  ['Command Palette', null, async (p) => ({ ok: await textVisible(p, 'Type a command') || await visible(p, 'input[placeholder*="command" i]'), note: 'palette input' })],
  ['Quick Open File', null, async (p) => ({ ok: await textVisible(p, 'Type a command') || await visible(p, 'input[placeholder*="command" i]'), note: 'palette (quick open = palette)' })],
  ['Toggle Sidebar', async (p) => ({ before: await p.locator('span:text-is("Explorer")').first().isVisible().catch(() => false) }), async (p, b) => { const now = await p.locator('span:text-is("Explorer")').first().isVisible().catch(() => false); return { ok: now !== b.before, note: `explorer heading before=${b.before} after=${now}` }; }],
  ['Toggle Terminal', async (p) => ({ before: await panelOpen(p) }), async (p, b) => { const now = await panelOpen(p); return { ok: now !== b.before, note: `panel before=${b.before} after=${now}` }; }],
  ['Save File', async (p) => { await evalEd(p, '(ed) => { ed.setPosition({lineNumber:1,column:1}); ed.trigger("t","type",{text:"// edited\\n"}); }'); return {}; }, async (p) => ({ ok: (await calls(p)).includes('onFlushEdits') || (await calls(p)).includes('onFilesChange'), note: (await calls(p)).slice(-3).join(',') })],
  ['Save All Files', async (p) => { await evalEd(p, '(ed) => { ed.setPosition({lineNumber:1,column:1}); ed.trigger("t","type",{text:"// edited\\n"}); }'); return {}; }, async (p) => ({ ok: (await calls(p)).includes('onFilesChange'), note: (await calls(p)).slice(-3).join(',') })],
  ['Undo', async (p) => { await setPos(p, 1); await evalEd(p, '(ed) => ed.trigger("t","type",{text:"ZZZ"})'); return { v: await value(p) }; }, async (p, b) => ({ ok: !(await value(p)).includes('ZZZ') && b.v.includes('ZZZ'), note: `typed text removed? before-has=${b.v.includes('ZZZ')} after-has=${(await value(p)).includes('ZZZ')} first=${JSON.stringify((await value(p)).slice(0, 30))}` })],
  ['Redo', async (p) => { await setPos(p, 1); await evalEd(p, '(ed) => { ed.trigger("t","type",{text:"ZZZ"}); ed.trigger("t","undo",{}); }'); return {}; }, async (p) => ({ ok: (await value(p)).includes('ZZZ'), note: 'undone text back' })],
  ['Cut Line', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n - 1, note: `lines ${b.n} → ${await lineCount(p)}` })],
  ['Copy Line', async (p) => { await setPos(p, 3); await p.evaluate(() => navigator.clipboard.writeText('')); return {}; }, async (p) => ({ ok: (await p.evaluate(() => navigator.clipboard.readText())).includes('greet'), note: 'clipboard has line 3' })],
  ['Paste', async (p) => { await p.evaluate(() => navigator.clipboard.writeText('PASTED_TEXT')); await setPos(p, 1); return {}; }, async (p) => ({ ok: (await value(p)).includes('PASTED_TEXT'), note: 'clipboard text inserted' })],
  ['Select All', null, async (p) => ({ ok: JSON.stringify(await sel(p)) === JSON.stringify([1, 1, await lineCount(p), 1]), note: JSON.stringify(await sel(p)) })],
  ['New File', null, async (p) => ({ ok: !!(await p.evaluate(() => window.__files['created-by-shortcut.ts'] !== undefined)), note: 'file created from prompt' })],
  ['Open File', null, async (p) => ({ ok: await textVisible(p, 'Type a command') || await visible(p, 'input[placeholder*="command" i]'), note: 'palette' })],
  ['New Window', null, async (p) => ({ ok: (await calls(p)).includes('window.open'), note: 'window.open called' })],
  ['Close Tab', async (p) => ({ tabs: await p.locator('[aria-label^="Close tab"]').count() }), async (p, b) => ({ ok: (await p.locator('[aria-label^="Close tab"]').count()) === b.tabs - 1, note: `tabs ${b.tabs} → ${await p.locator('[aria-label^="Close tab"]').count()}` })],
  ['Reopen Closed Tab', async (p) => { await pressShortcut(p, 'Close Tab'); return { tabs: await p.locator('[aria-label^="Close tab"]').count() }; }, async (p, b) => ({ ok: (await p.locator('[aria-label^="Close tab"]').count()) === b.tabs + 1, note: 'tab back' })],
  ['Next Tab', async (p) => { await p.click('text=src/utils.ts').catch(() => {}); await p.click('text=README.md').catch(() => {}); await p.click('text=src/App.tsx').catch(() => {}); return { f: await evalEd(p, '(ed) => ed.getModel().uri.path') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getModel().uri.path')) !== b.f, note: 'active file changed' })],
  ['Previous Tab', async (p) => { await p.click('text=src/utils.ts').catch(() => {}); return { f: await evalEd(p, '(ed) => ed.getModel().uri.path') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getModel().uri.path')) !== b.f, note: 'active file changed' })],
  ['Next Editor Group', async (p) => { await p.click('text=src/utils.ts').catch(() => {}); await p.click('text=src/App.tsx').catch(() => {}); return { f: await evalEd(p, '(ed) => ed.getModel().uri.path') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getModel().uri.path')) !== b.f, note: 'active file changed' })],
  ['Previous Editor Group', async (p) => { await p.click('text=src/utils.ts').catch(() => {}); return { f: await evalEd(p, '(ed) => ed.getModel().uri.path') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getModel().uri.path')) !== b.f, note: 'active file changed' })],
  ['Explorer Panel', null, async (p) => ({ ok: await textVisible(p, 'README.md'), note: 'explorer shows files' })],
  ['Find', null, async (p) => ({ ok: await visible(p, '.find-widget.visible'), note: 'find widget' })],
  ['Replace', null, async (p) => ({ ok: await visible(p, '.find-widget.visible .replace-part') || await visible(p, '.find-widget.visible'), note: 'find/replace widget' })],
  ['Search Entire Project', null, async (p) => ({ ok: await visible(p, 'input[placeholder*="Search" i]'), note: 'search panel' })],
  ['Replace Project', null, async (p) => ({ ok: await visible(p, 'input[placeholder*="Search" i]'), note: 'search panel' })],
  ['Find Next', async (p) => { await setPos(p, 1); await evalEd(p, '(ed) => { ed.getAction("actions.find").run(); }'); await p.waitForTimeout(200); await p.keyboard.type('count'); await p.waitForTimeout(200); return { s: await sel(p) }; }, async (p, b) => ({ ok: JSON.stringify(await sel(p)) !== JSON.stringify(b.s), note: `${JSON.stringify(b.s)} → ${JSON.stringify(await sel(p))}` })],
  ['Find Previous', async (p) => { await setPos(p, 1); await evalEd(p, '(ed) => { ed.getAction("actions.find").run(); }'); await p.waitForTimeout(200); await p.keyboard.type('count'); await p.waitForTimeout(200); return { s: await sel(p) }; }, async (p, b) => ({ ok: JSON.stringify(await sel(p)) !== JSON.stringify(b.s), note: `${JSON.stringify(b.s)} → ${JSON.stringify(await sel(p))}` })],
  ['Comment Line', async (p) => { await setPos(p, 3); return {}; }, async (p) => ({ ok: /^\s*\/\/ ?export function greet/m.test(await value(p)), note: 'line 3 commented' })],
  ['Block Comment', async (p) => { await evalEd(p, '(ed) => { ed.setSelection({startLineNumber:3,startColumn:1,endLineNumber:5,endColumn:2}); ed.focus(); }'); return {}; }, async (p) => ({ ok: (await value(p)).includes('/*'), note: 'block comment inserted' })],
  ['Move Line Up', async (p) => { await setPos(p, 3); return {}; }, async (p) => ({ ok: (await value(p)).startsWith("import React, { useState } from 'react';\n") === false || (await evalEd(p, '(ed) => ed.getModel().getLineContent(2)')).includes('export function greet'), note: 'line 3 moved to 2' })],
  ['Move Line Down', async (p) => { await setPos(p, 3); return {}; }, async (p) => ({ ok: (await evalEd(p, '(ed) => ed.getModel().getLineContent(4)')).includes('export function greet'), note: 'line 3 moved to 4' })],
  ['Copy Line Up', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n + 1, note: 'line duplicated' })],
  ['Copy Line Down', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n + 1, note: 'line duplicated' })],
  ['Delete Line', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n - 1, note: 'line removed' })],
  ['Insert Line Below', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n + 1 && (await pos(p))[0] === 4, note: `pos ${JSON.stringify(await pos(p))}` })],
  ['Insert Line Above', async (p) => { await setPos(p, 3); return { n: await lineCount(p) }; }, async (p, b) => ({ ok: (await lineCount(p)) === b.n + 1 && (await pos(p))[0] === 3, note: `pos ${JSON.stringify(await pos(p))}` })],
  ['Select Next Word', async (p) => { await evalEd(p, '(ed) => { ed.setSelection({startLineNumber:8,startColumn:10,endLineNumber:8,endColumn:15}); ed.focus(); }'); return {}; }, async (p) => ({ ok: (await selCount(p)) === 2, note: `selections=${await selCount(p)}` })],
  ['Select All Match', async (p) => { await evalEd(p, '(ed) => { ed.setSelection({startLineNumber:8,startColumn:10,endLineNumber:8,endColumn:15}); ed.focus(); }'); return {}; }, async (p) => ({ ok: (await selCount(p)) >= 3, note: `selections=${await selCount(p)}` })],
  ['Select Current Line', async (p) => { await setPos(p, 3, 5); return {}; }, async (p) => ({ ok: JSON.stringify(await sel(p)) === JSON.stringify([3, 1, 4, 1]), note: JSON.stringify(await sel(p)) })],
  ['Undo Cursor', async (p) => { await setPos(p, 2); await setPos(p, 9); return {}; }, async (p) => ({ ok: (await pos(p))[0] !== 9, note: `pos ${JSON.stringify(await pos(p))}` })],
  ['Cursor Above', async (p) => { await setPos(p, 5); return {}; }, async (p) => ({ ok: (await selCount(p)) === 2, note: `selections=${await selCount(p)}` })],
  ['Cursor Below', async (p) => { await setPos(p, 5); return {}; }, async (p) => ({ ok: (await selCount(p)) === 2, note: `selections=${await selCount(p)}` })],
  ['Go to Definition', async (p) => { await setPos(p, 9, 18); await p.waitForTimeout(1500); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: (await pos(p))[0] === 3, note: `pos ${JSON.stringify(await pos(p))}` }; }],
  ['Peek Definition', async (p) => { await setPos(p, 9, 18); await p.waitForTimeout(1500); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: await visible(p, '.peekview-widget'), note: 'peek widget' }; }],
  ['Find References', async (p) => { await setPos(p, 3, 19); await p.waitForTimeout(1500); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: await visible(p, '.peekview-widget'), note: 'references widget' }; }],
  ['Go to Symbol', null, async (p) => ({ ok: await visible(p, '.quick-input-widget'), note: 'quick input' })],
  ['Go to Line', null, async (p) => ({ ok: await visible(p, '.quick-input-widget'), note: 'quick input' })],
  ['Search Symbols in File', null, async (p) => ({ ok: await visible(p, '.quick-input-widget'), note: 'quick input' })],
  ['Go Back (previous cursor spot)', async (p) => { await setPos(p, 2); await setPos(p, 9); return {}; }, async (p) => ({ ok: (await pos(p))[0] !== 9 && !(await calls(p)).includes('history.back'), note: `pos ${JSON.stringify(await pos(p))} calls=${(await calls(p)).filter((c) => c.startsWith('history')).join(',') || 'none'}` })],
  ['Go Forward (next cursor spot)', async (p) => { await setPos(p, 2); await setPos(p, 9); await evalEd(p, '(ed) => ed.trigger("t","cursorUndo",{})'); return {}; }, async (p) => ({ ok: (await pos(p))[0] === 9 && !(await calls(p)).includes('history.forward'), note: `pos ${JSON.stringify(await pos(p))}` })],
  ['Format Document', async (p) => { await evalEd(p, '(ed) => ed.getModel().setValue("const   x=1;\\nfunction f( a,b ){return a+b}\\n")'); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: (await value(p)).includes('const x = 1;'), note: (await value(p)).split('\n')[0] }; }],
  ['Format Selection', async (p) => { await evalEd(p, '(ed) => { ed.getModel().setValue("const   x=1;\\nfunction f( a,b ){return a+b}\\n"); ed.setSelection({startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:13}); ed.focus(); }'); await p.waitForTimeout(1500); return {}; }, async (p) => { await p.waitForTimeout(3000); return { ok: (await value(p)).includes('const x = 1;'), note: (await value(p)).split('\n')[0] }; }],
  ['IntelliSense Suggestions', async (p) => { await setPos(p, 8, 30); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: await visible(p, '.suggest-widget.visible'), note: 'suggest widget' }; }],
  ['Parameter Hints', async (p) => { await evalEd(p, '(ed) => { ed.setPosition({lineNumber:9,column:24}); ed.focus(); }'); return {}; }, async (p) => { await p.waitForTimeout(800); return { ok: await visible(p, '.parameter-hints-widget.visible'), note: 'hints widget' }; }],
  ['New Terminal', null, async (p) => ({ ok: await panelOpen(p), note: 'panel open' })],
  ['Start Debugging', null, async (p) => ({ ok: await textVisible(p, 'Breakpoints') || await textVisible(p, 'Debug'), note: 'debug panel' })],
  ['Stop Debugging', async (p) => { await pressShortcut(p, 'Start Debugging'); return { was: await textVisible(p, 'Breakpoints') }; }, async (p, b) => ({ ok: b.was && !(await textVisible(p, 'Breakpoints')), note: `was=${b.was}` })],
  ['Toggle Breakpoint', async (p) => { await setPos(p, 4); return {}; }, async (p) => { await p.waitForTimeout(400); return { ok: (await p.locator('.nbai-breakpoint-glyph').count()) > 0, note: `glyphs=${await p.locator('.nbai-breakpoint-glyph').count()}` }; }],
  ['Debug Panel', null, async (p) => ({ ok: await textVisible(p, 'Breakpoints') || await textVisible(p, 'Debug'), note: 'debug panel' })],
  ['Source Control', null, async (p) => ({ ok: await textVisible(p, 'Source Control') || await textVisible(p, 'Connect GitHub') || await textVisible(p, 'GitHub'), note: 'git panel' })],
  ['Extensions', null, async (p) => ({ ok: await textVisible(p, 'Extension') , note: 'extensions panel' })],
  ['Settings', null, async (p) => ({ ok: await textVisible(p, 'User Preferences'), note: 'settings panel' })],
  ['Keyboard Shortcuts', null, async (p) => ({ ok: await textVisible(p, 'VS Code – Master Keyboard Shortcuts'), note: 'popup' })],
  ['Problems Panel', null, async (p) => ({ ok: await textVisible(p, 'Problems') || await textVisible(p, 'No problems'), note: 'problems panel' })],
  ['Output Panel', async (p) => ({ before: await panelOpen(p) }), async (p, b) => { const now = await panelOpen(p); return { ok: now !== b.before, note: `panel before=${b.before} after=${now}` }; }],
  ['Toggle Bottom Panel', async (p) => ({ before: await panelOpen(p) }), async (p, b) => { const now = await panelOpen(p); return { ok: now !== b.before, note: `panel before=${b.before} after=${now}` }; }],
  ['Zen Mode', null, async (p) => ({ ok: await p.evaluate(() => !!document.fullscreenElement), note: `fullscreen=${await p.evaluate(() => !!document.fullscreenElement)}` })],
  ['Split Editor', null, async (p) => ({ ok: MOBILE ? (await p.evaluate(() => window.monaco.editor.getEditors().length)) === 1 : (await p.evaluate(() => window.monaco.editor.getEditors().length)) === 2, note: `editors=${await p.evaluate(() => window.monaco.editor.getEditors().length)} (phone: must stay 1)` })],
  ['Focus First Group', async (p) => { await p.evaluate(() => document.activeElement && document.activeElement.blur()); return {}; }, async (p) => ({ ok: await evalEd(p, '(ed) => ed.hasTextFocus()'), note: 'editor focused' })],
  ['Fold Code', async (p) => { await setPos(p, 3); return { v: await evalEd(p, '(ed) => ed.getVisibleRanges().length') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getVisibleRanges().length')) > b.v, note: `ranges ${b.v} → ${await evalEd(p, '(ed) => ed.getVisibleRanges().length')}` })],
  ['Unfold Code', async (p) => { await setPos(p, 3); await evalEd(p, '(ed) => ed.trigger("t","editor.fold",{})'); await p.waitForTimeout(200); return { v: await evalEd(p, '(ed) => ed.getVisibleRanges().length') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getVisibleRanges().length')) < b.v, note: `ranges ${b.v} → ${await evalEd(p, '(ed) => ed.getVisibleRanges().length')}` })],
  ['Fold All', null, async (p) => ({ ok: (await evalEd(p, '(ed) => ed.getVisibleRanges().length')) >= 2, note: `ranges=${await evalEd(p, '(ed) => ed.getVisibleRanges().length')}` })],
  ['Unfold All', async (p) => { await evalEd(p, '(ed) => ed.trigger("t","editor.foldAll",{})'); await p.waitForTimeout(200); return { v: await evalEd(p, '(ed) => ed.getVisibleRanges().length') }; }, async (p, b) => ({ ok: (await evalEd(p, '(ed) => ed.getVisibleRanges().length')) === 1, note: `ranges ${b.v} → 1?` })],
  ['Markdown Preview', null, async (p) => ({ ok: (await calls(p)).includes('onPreviewClick') || await textVisible(p, 'Preview'), note: 'preview surface' })],
  ['Rename Variable', async (p) => { await setPos(p, 8, 12); await p.waitForTimeout(1200); return {}; }, async (p) => { await p.waitForTimeout(600); return { ok: await visible(p, '.rename-box'), note: 'rename box' }; }],
  ['Quick Fix', async (p) => { await setPos(p, 8, 12); await p.waitForTimeout(1200); return {}; }, async (p) => { await p.waitForTimeout(600); return { ok: await visible(p, '.action-widget') || await textVisible(p, 'No code actions'), note: 'code-action widget or honest message' }; }],
  ['Line Start', async (p) => { await setPos(p, 4, 10); return {}; }, async (p) => ({ ok: (await pos(p))[1] <= 3, note: `pos ${JSON.stringify(await pos(p))}` })],
  ['Line End', async (p) => { await setPos(p, 4, 2); return {}; }, async (p) => ({ ok: (await pos(p))[1] > 10, note: `pos ${JSON.stringify(await pos(p))}` })],
  ['File Start', async (p) => { await setPos(p, 9, 5); return {}; }, async (p) => ({ ok: JSON.stringify(await pos(p)) === '[1,1]', note: `pos ${JSON.stringify(await pos(p))}` })],
  ['File End', async (p) => { await setPos(p, 2, 1); return {}; }, async (p) => ({ ok: (await pos(p))[0] === (await lineCount(p)), note: `pos ${JSON.stringify(await pos(p))}` })],
];

const results = [];
for (const [label, setup, probe] of CHECKS) {
  if (ONLY && !ONLY.includes(label)) continue;
  const { page, errors } = await fresh();
  let line;
  try {
    const b = setup ? await setup(page) : {};
    await pressShortcut(page, label);
    const r = await probe(page, b);
    line = `${r.ok ? 'OK  ' : 'DEAD'} ${label.padEnd(26)} ${r.note}${errors.length ? '  ⚠ ' + errors[0] : ''}`;
  } catch (e) {
    line = `ERR  ${label.padEnd(26)} ${String(e).split('\n')[0].slice(0, 140)}`;
  }
  results.push(line);
  console.log(line);
  await page.close();
}
console.log(`\n${results.filter((l) => l.startsWith('OK')).length} OK · ${results.filter((l) => l.startsWith('DEAD')).length} DEAD · ${results.filter((l) => l.startsWith('ERR')).length} ERR of ${results.length}`);
await browser.close(); srv.close();

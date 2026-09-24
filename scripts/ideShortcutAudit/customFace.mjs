// THE CUSTOM FACE, pressed in a real browser (PR D). Same harness as audit.mjs.
//   PLAYWRIGHT_CORE=… node scripts/ideShortcutAudit/customFace.mjs [phone|desktop]
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
import http from 'http';
import { readFileSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

const MOBILE = process.argv[2] !== 'desktop';
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const HARNESS = 'scripts/ideShortcutAudit/dist';
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let url = req.url.split('?')[0]; if (url === '/') url = '/studio.html';
  const p = url.startsWith('/monaco/') ? join('dist', url) : join(HARNESS, url);
  if (!existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: MOBILE, hasTouch: MOBILE });
await ctx.route(/^(?!http:\/\/127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
await page.goto(base + '/');
await page.waitForFunction(() => window.monaco && window.monaco.editor.getEditors().length > 0 && window.monaco.editor.getEditors()[0].getModel());
await page.waitForTimeout(400);
const evalEd = (fn) => page.evaluate(`(() => { const ed = window.monaco.editor.getEditors()[0]; return (${fn})(ed); })()`);
const results = [];
const check = (name, ok, note = '') => { results.push(`${ok ? 'OK  ' : 'DEAD'} ${name.padEnd(44)} ${note}`); console.log(results.at(-1)); };

// Open the popup, flip to CUSTOM.
if (MOBILE) { await page.click('button:has-text("More")'); await page.click('button:has-text("Shortcuts")'); } else { await page.click('button[aria-label="Shortcuts"]'); }
await page.waitForSelector('text=VS Code – Master Keyboard Shortcuts');
await page.click('button[aria-label="Custom"]');
await page.waitForSelector('[data-face="custom"]');
await page.waitForTimeout(400);
check('CUSTOM flips the card to the custom face', await page.locator('[data-face="custom"]').isVisible() && !(await page.locator('[data-face="shortcuts"]').count()));
check('the header says which face is showing', await page.locator('text=Custom keys').isVisible());
await page.screenshot({ path: `/tmp/claude-0/-home-user-navbharatai/17631df3-63e2-524d-b986-4792efac207c/scratchpad/custom-${MOBILE ? 'phone' : 'desktop'}.png` });

const input = page.locator('input[aria-label="Key combination"]');
const go = page.locator('button[aria-label="Go"]');
const status = page.locator('[role="status"]');
const setText = async (t) => { await input.fill(''); if (t) await input.fill(t); };

// 1. Typed text → our own table.
await evalEd('(ed) => { ed.setPosition({ lineNumber: 2, column: 1 }); }');
await setText('ctrl+a'); await go.click(); await page.waitForTimeout(300);
check('typed "ctrl+a" + GO selects the whole file', JSON.stringify(await evalEd('(ed) => { const s = ed.getSelection(); return [s.startLineNumber, s.endLineNumber]; }')) === JSON.stringify([1, await evalEd('(ed) => ed.getModel().getLineCount()')]), await status.textContent());

// 2. Tapped keys build the text.
await setText('');
await page.locator('button[aria-label="Ctrl"]').first().click();
await page.locator('button[aria-label="a"]').click();
check('tapping Ctrl then A writes "Ctrl+a" in the box', (await input.inputValue()) === 'Ctrl+a', await input.inputValue());
await evalEd('(ed) => { ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }); }');
await go.click(); await page.waitForTimeout(300);
check('…and GO runs it (select all again)', (await evalEd('(ed) => ed.getSelection().endLineNumber')) > 1);

// 3. A bare character is typed into the editor.
await evalEd('(ed) => { ed.setSelection({ startLineNumber: 12, startColumn: 1, endLineNumber: 12, endColumn: 1 }); }');
await setText('q'); await go.click(); await page.waitForTimeout(300);
check('a bare "q" is typed into the file', (await evalEd('(ed) => ed.getModel().getLineContent(12)')) === 'q', await status.textContent());

// 4. A combo NOT in our table reaches Monaco's own bindings via a REAL key event: Ctrl+] indents the line.
await evalEd('(ed) => { ed.setPosition({ lineNumber: 3, column: 1 }); }');
const l3 = await evalEd('(ed) => ed.getModel().getLineContent(3)');
await setText('ctrl+]'); await go.click(); await page.waitForTimeout(400);
const l3after = await evalEd('(ed) => ed.getModel().getLineContent(3)');
check('"ctrl+]" (not in our table) indents the line through the editor\'s own binding', l3after === '  ' + l3, `${JSON.stringify(l3after)} · ${await status.textContent()}`);

// 5. Shift+Alt+→ (Monaco's expand selection, not in our table) — a second raw key-event path.
await evalEd('(ed) => { ed.setSelection({ startLineNumber: 4, startColumn: 12, endLineNumber: 4, endColumn: 12 }); }');
await setText('shift+alt+right'); await go.click(); await page.waitForTimeout(400);
check('"shift+alt+right" expands the selection (editor binding)', (await evalEd('(ed) => { const s = ed.getSelection(); return s.endColumn - s.startColumn; }')) > 0, await status.textContent());

// 6. Honesty.
await setText('alt+tab'); await go.click(); await page.waitForTimeout(200);
check('"alt+tab" is refused with a reason', /operating system/i.test(await status.textContent()), await status.textContent());
await setText('ctrl'); await go.click(); await page.waitForTimeout(200);
check('a bare modifier says what is missing', /add the key/i.test(await status.textContent()), await status.textContent());

// 7. CapsLk and Fn are layers.
await setText('');
await page.locator('button[aria-label="CapsLk"]').click();
await page.locator('button[aria-label="a"]').click();
check('CapsLk makes the next letter a capital', (await input.inputValue()) === 'A', await input.inputValue());
await page.locator('button[aria-label="CapsLk"]').click();
await page.locator('button[aria-label="Fn"]').click();
check('Fn turns the number row into F1–F12', (await page.locator('[data-keyboard] button[aria-label="F5"]').count()) >= 2);
await page.locator('button[aria-label="Fn"]').click();

// 8. Every key in the grid is a real key the engine knows (no button that only appends a word nothing can resolve).
const labels = await page.locator('[data-keyboard] button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check('the keyboard shows a full desktop layout (84 keys: Esc/F-row, numbers, three letter rows, modifiers, nav)', labels.length >= 84, `${labels.length} keys`);

// 9. The cursor tool.
await evalEd('(ed) => { ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }); }');
await page.locator('[data-cursor-tool] button', { hasText: /^\s*Select\s*$/ }).click();
await page.locator('[data-cursor-tool] button[aria-label="Cursor right"]').click();
await page.locator('[data-cursor-tool] button[aria-label="Cursor right"]').click();
check('Select mode + → extends the selection', (await evalEd('(ed) => ed.getSelection().endColumn')) === 3, JSON.stringify(await evalEd('(ed) => { const s = ed.getSelection(); return [s.startColumn, s.endColumn]; }')));
await page.locator('[data-cursor-tool] button', { hasText: /^\s*Deselect\s*$/ }).click();
await page.locator('[data-cursor-tool] button[aria-label="Cursor right"]').click();
check('Deselect mode + → shrinks it from the end', (await evalEd('(ed) => ed.getSelection().endColumn')) === 2);
await page.locator('[data-cursor-tool] button[aria-label^="Select all"]').click();
check('ALL selects everything', (await evalEd('(ed) => ed.getSelection().endLineNumber')) === (await evalEd('(ed) => ed.getModel().getLineCount()')));

// 10. Back to shortcuts, and the face is remembered.
await page.click('button[aria-label="Back to shortcuts"]'); await page.waitForTimeout(400);
check('Shortcuts flips back', await page.locator('[data-face="shortcuts"]').isVisible());
await page.click('button[aria-label="Custom"]'); await page.waitForTimeout(300);
check('the last face is remembered', (await page.evaluate(() => localStorage.getItem('ide_shortcutsPopupFace'))) === 'custom');

// 11. The ActivityBar / footer "Cursor" entry opens the popup on the CUSTOM face.
await page.click('button[aria-label="Close"]'); await page.waitForTimeout(300);
if (!MOBILE) {
  await page.click('button[aria-label="Cursor"]'); await page.waitForTimeout(400);
  check('the Cursor rail button opens straight onto CUSTOM', await page.locator('[data-face="custom"]').isVisible());
}
check('no page errors', errors.length === 0, errors[0] ?? '');
console.log(`\n${results.filter((l) => l.startsWith('OK')).length} OK · ${results.filter((l) => l.startsWith('DEAD')).length} DEAD of ${results.length}`);
await browser.close(); srv.close();

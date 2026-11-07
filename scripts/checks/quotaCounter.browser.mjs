// Offline browser regression. Use an external Playwright install; no production credentials or API calls.
// node scripts/checks/quotaCounter.browser.mjs /path/to/playwright /tmp/quota-evidence
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const { chromium } = await import(pathToFileURL(resolve(process.argv[2], 'index.mjs')).href);
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'quota-counter-'));
const source = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NBIChatPanel} from './src/components/panels/NBIChatPanel';
function App(){const [visible,setVisible]=useState(true);const [session,setSession]=useState('one');
window.fixture={setVisible,setSession};
return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}>
<button id="outside">Outside navigation</button>
{visible && <NBIChatPanel sessions={[]} currentSessionId={session} user={null} messages={[]} input="" setInput={()=>{}} onSend={()=>{}} setTeachMode={()=>{}} onNewChat={()=>setSession('next')} />}
</div>}
createRoot(document.getElementById('root')).render(<App/>);`;
await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', outfile: join(scratch, 'fixture.js'), jsx: 'automatic', plugins: [{ name: 'offline-fixtures', setup(b) {
  b.onResolve({ filter: /useFreeAnswerStatus$/ }, () => ({ path: 'quota', namespace: 'fixture' }));
  b.onResolve({ filter: /\/ide\/AIChat$/ }, () => ({ path: 'chat', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents: args.path === 'chat'
    ? `export function AIChat(){return <main id="chat-space" style={{flex:1,minHeight:0}}><textarea aria-label="Message"/><button id="other">Other control</button></main>}`
    : `import {useEffect,useState} from 'react';
let value={limit:50,remaining:47,used:3,reserved:0,inProgress:false};
export function useFreeAnswerStatus(){const [status,setStatus]=useState(value);useEffect(()=>{window.setQuota=v=>{value=v;setStatus(v)};return()=>{delete window.setQuota}},[]);return status}`,
    resolveDir: process.cwd() }));
} }] });
const assets = await readdir('dist/assets');
const css = (await Promise.all(assets.filter(x => x.endsWith('.css')).map(x => readFile(join('dist/assets', x), 'utf8')))).join('\n');
const js = await readFile(join(scratch, 'fixture.js'));
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(js); }
  else if (req.url === '/fixture.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
  else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const url = `http://127.0.0.1:${server.address().port}`;
  const counter = () => page.getByRole('button', { name: /^Free daily quota:/ });
  const dialog = () => page.getByRole('dialog', { name: 'Free daily quota details' });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 }); await page.goto(url);
    await counter().waitFor();
    assert.equal(await counter().innerText(), '47/50');
    assert.equal(await dialog().count(), 0);
    const before = await page.locator('#chat-space').boundingBox();
    const title = await page.getByText('AI chat', { exact: true }).boundingBox();
    const count = await counter().boundingBox();
    const plus = await page.getByTitle('Start a new chat — this conversation stays saved in History').boundingBox();
    assert(title.x + title.width <= count.x && count.x + count.width <= plus.x, 'counter is between title and +');
    assert(Math.abs(count.y - plus.y) < 2, 'single header row');
    assert(before.y < 100, 'no extra quota banner row');
    if (width === 390) await page.screenshot({ path: join(output, 'mobile-closed.png') });
    await counter().click(); await dialog().waitFor();
    assert.equal(await counter().getAttribute('aria-expanded'), 'true');
    assert.match(await dialog().innerText(), /47\/50 remaining.*3 used.*12:00 AM IST/s);
    assert.deepEqual(await page.locator('#chat-space').boundingBox(), before, 'overlay consumes no chat space');
    const box = await dialog().boundingBox(); assert(box.x >= 0 && box.x + box.width <= width);
    assert(box.y >= count.y + count.height, 'details do not cover their toggle');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 390) await page.screenshot({ path: join(output, 'mobile-open.png') });
    await page.keyboard.press('Escape'); assert.equal(await dialog().count(), 0);
    assert.equal(await counter().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter'); await dialog().waitFor();
    await counter().click(); assert.equal(await dialog().count(), 0, 'toggle closes');
    for (let i=0;i<3;i++){await counter().click();await dialog().waitFor();await page.locator('#outside').click();assert.equal(await dialog().count(),0);}
    await counter().click(); await dialog().waitFor();
    await page.getByRole('button',{name:'Close quota details'}).click();
    assert.equal(await counter().evaluate(el => el === document.activeElement),true);
    await counter().click(); await dialog().waitFor();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); assert.equal(await dialog().count(),0,'keyboard exit dismisses');
    await counter().click(); await dialog().waitFor();
    await page.keyboard.press('Shift+Tab'); assert.equal(await dialog().count(),0,'backward keyboard exit dismisses');
    await counter().click(); await dialog().waitFor();
    await page.setViewportSize({width,height:700});
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.setViewportSize({width,height:800});
    await counter().click(); await dialog().waitFor();
    await page.evaluate(() => window.setQuota({limit:10,remaining:8,used:1,reserved:1,inProgress:true}));
    await page.waitForFunction(() => document.querySelector('[aria-haspopup="dialog"]').textContent === '8/10');
    assert.match(await dialog().innerText(), /1 in progress/);
    await page.evaluate(() => window.setQuota(null));
    await page.waitForFunction(() => document.querySelector('[aria-haspopup="dialog"]').textContent === '—/—');
    assert.match(await dialog().innerText(), /Status unavailable/);
    await page.evaluate(() => window.fixture.setSession('different'));
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await counter().click(); await dialog().waitFor();
    await page.evaluate(() => window.fixture.setVisible(false));
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.fixture.setVisible(true)); await counter().waitFor();
    assert.equal(await counter().getAttribute('aria-expanded'), 'false');
  }
  assert.deepEqual(errors, []); await writeFile(join(output,'results.json'), JSON.stringify({passed:true,widths:[320,390,768,1280],externalRequestsAllowed:false},null,2));
  console.log('PASS: quota counts, keyboard/focus, toggle/outside dismissal, refresh, navigation/unmount, mobile layout and unchanged chat area.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(scratch,{recursive:true,force:true}); }

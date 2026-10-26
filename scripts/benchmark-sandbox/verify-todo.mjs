// One restricted synthetic todo journey, not a generic app-quality verdict.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '/opt/nbai-canary/node_modules/playwright/index.mjs';
const root = '/home/user/canary-app/dist';
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + '/')) throw Error('Invalid path');
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': type }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('textbox').first().fill('Synthetic benchmark task');
  await page.getByRole('button', { name: /^(add|add task)$/i }).click();
  await page.reload();
  await page.getByText('Synthetic benchmark task', { exact: true }).waitFor();
  await page.getByRole('checkbox').first().check();
  assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: '/home/user/canary-app/mobile-proof.png', fullPage: true });
  await page.getByRole('button', { name: /delete/i }).first().click();
  assert.equal(await page.getByText('Synthetic benchmark task', { exact: true }).count(), 0);
  console.log(JSON.stringify({ fixture: 'todo-en-accessible', reloadPersistence: true, complete: true, delete: true, mobileOverflow: false }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

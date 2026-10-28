import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Pass an independently installed Happy DOM entry; no production dependency is added.
if (!process.argv[2]) throw new Error('Usage: node scripts/providerDiagnostics.dom.check.mjs /absolute/path/to/happy-dom/lib/index.js');
const { Window } = await import(pathToFileURL(resolve(process.argv[2])).href);
const repo = fileURLToPath(new URL('..', import.meta.url));
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const window = new Window({ url: 'http://localhost' });
for (const name of ['window','document','navigator','HTMLElement','HTMLTextAreaElement','Event','MouseEvent','sessionStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(resolve(repo, 'package.json'));
const React = require('react'); const { createRoot } = require('react-dom/client');
const bundle = resolve(repo, 'node_modules/.cache/providerDiagnosticPanels.dom.mjs');
require('esbuild').buildSync({ entryPoints: [resolve(repo, 'src/components/admin/ProviderDiagnosticPanels.tsx')], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react/jsx-runtime'], outfile: bundle });
const { ProviderDiagnosticPanels: Panels, ProviderDiagnosticBot: Bot } = await import(pathToFileURL(bundle).href);
let calls = []; let answer = { dispatchReady: false }; let ok = true;
globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok, json: async () => answer }; };
let container, root;
async function mount(Component, props) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); await React.act(async () => root.render(React.createElement(Component, props))); }
async function unmount() { await React.act(async () => root.unmount()); container.remove(); }
async function click(label, twice = false) { const button = [...container.querySelectorAll('button')].find(b => b.textContent === label); assert(button, label); await React.act(async () => { button.click(); if (twice) button.click(); }); }
await mount(Panels, { adminToken: '' }); assert.equal(container.innerHTML, ''); assert.equal(calls.length, 0); await unmount();
await mount(Panels, { adminToken: 'synthetic-admin' }); assert.equal(calls.length, 0); assert.equal(container.querySelectorAll('textarea').length, 0);
await click('Verify admin and read test status'); assert.equal(calls.length, 1); assert.equal(container.querySelectorAll('textarea').length, 2); assert(container.textContent.includes('Dispatch blocked')); assert([...container.querySelectorAll('button')].filter(b => b.textContent.startsWith('Run ')).every(b => b.disabled)); await unmount();
ok = false; await mount(Panels, { adminToken: 'invalid-admin' }); await click('Verify admin and read test status'); assert.equal(container.querySelectorAll('textarea').length, 0); await unmount(); ok = true;
const id = '11111111-1111-4111-8111-111111111111';
sessionStorage.setItem('admin-diagnostic-pending:surplus', id); answer = { run: { runId: id, provider: 'surplus', state: 'unknown_liability', actualCostNanoUsd: null, reservedNanoUsd: 1000 } };
await mount(Bot, { adminToken: 'synthetic-admin', provider: 'surplus', ready: true }); const before = calls.length;
await click('Recover original run', true); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).options.method, 'GET'); assert.equal(calls.at(-1).options.body, undefined); assert(container.textContent.includes('Actual cost unavailable')); assert([...container.querySelectorAll('button')].find(b => b.textContent === 'Prepare another test').disabled); await unmount();
answer = { run: { runId: id, provider: 'surplus', state: 'settled', actualCostNanoUsd: 5, reservedNanoUsd: 1000 } };
await mount(Bot, { adminToken: 'synthetic-admin', provider: 'surplus', ready: true }); await click('Recover original run'); await click('Prepare another test'); assert.equal(sessionStorage.getItem('admin-diagnostic-pending:surplus'), null); await unmount();
await mount(Bot, { adminToken: 'synthetic-admin', provider: 'surplus', ready: true });
const textarea = container.querySelector('textarea');
await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Reply hello'); textarea.dispatchEvent(new window.Event('input', { bubbles: true })); textarea.dispatchEvent(new window.Event('change', { bubbles: true })); });
const runButton = [...container.querySelectorAll('button')].find(b => b.textContent === 'Run surplus test');
assert.equal(runButton.disabled, false, 'real input enables a bounded manual test');
answer = { runId: id, provider: 'surplus', model: 'test', startedAt: '2026-10-28T00:00:00Z', elapsedMs: 10, firstByteMs: null, firstTokenMs: null, outputTokensPerSecond: null, retryCount: 0, text: '<script>escaped</script>', usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null }, supplierCost: { status: 'unavailable' }, walletCharge: { status: 'not_charged' }, accounting: 'unknown_liability', timeline: [{ elapsedMs: 10, stage: 'accounting', reason: 'receipt_unavailable' }], provesBuilderHealth: false };
const postsBefore = calls.length; await click('Run surplus test', true); assert.equal(calls.length, postsBefore + 1); assert.equal(calls.at(-1).options.method, 'POST'); assert.equal(container.querySelector('script'), null); assert(container.textContent.includes('Actual cost unavailable')); await unmount();
console.log('PASS real React/Happy DOM: empty-admin exclusion, manual verified visibility, auth-failure hiding, no mount calls, duplicate recovery, remount same-key GET, unknown hold and settled recovery, real prompt input and duplicate POST suppression.');
await window.happyDOM.close();

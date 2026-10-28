#!/usr/bin/env node
/** Real Firestore admission/accounting plus real OpenAI SDK parsing; inference is fixture-only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const endpoint = process.argv[process.argv.indexOf('--emulator') + 1];
assert.match(endpoint ?? '', /^127\.0\.0\.1:\d+$/, 'Explicit loopback emulator required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint, 'No production fallback');
process.env.NODE_ENV = 'test'; process.env.FREE_CHAIN_DEEPINFRA_API_KEY = 'synthetic-emulator-only';
const { Firestore } = require('firebase-admin/firestore');
const db = new Firestore({ projectId: 'demo-navbharatai-phase2', databaseId: `comparison-${randomUUID()}`, host: endpoint, ssl: false });
const { setServerDb } = await import('../src/server/lib/serverDb.ts'); setServerDb(db);
const { FreeChainStore } = await import('../src/server/AI/FreeChain/store.ts');
const { comparisonStatus, runComparison, comparisonTariffDigest, readComparisonRates } = await import('../src/server/lib/deepinfraComparison.ts');
const { DEEPINFRA_COMPARISON_MODELS } = await import('../src/lib/deepinfraComparison.ts');
const catalog = DEEPINFRA_COMPARISON_MODELS.map((model_name, i) => ({ model_name, type: 'text-generation', max_tokens: 1048576, tags: ['tools', 'json', 'can-disable-reasoning'],
  pricing: { type: 'tokens', cents_per_input_token: i ? .00002 : .000006, cents_per_output_token: i ? .00006 : .000018 } }));
let calls = 0, omitUsage = false, releaseFirst, firstStarted;
const firstReady = new Promise(resolve => { firstStarted = resolve; });
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://api.deepinfra.com/models/list') return new Response(JSON.stringify(catalog));
  assert.equal(String(url), 'https://api.deepinfra.com/v1/openai/chat/completions', 'No real provider or arbitrary network access');
  calls++; if (calls === 1) { firstStarted(); await firstGate; }
  const body = JSON.parse(init.body);
  const usage = omitUsage ? {} : { usage: { prompt_tokens: 20, completion_tokens: 10 } };
  if (body.stream) return new Response([
    { model: body.model, choices: [{ delta: { content: 'NAVBHARAT_OK' }, finish_reason: 'stop' }] },
    { model: body.model, choices: [], ...usage },
  ].map(row => `data: ${JSON.stringify(row)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  let content = body.response_format ? '{"name":"NavbharatAI","languages":["hi","en"]}'
    : body.messages[0].content.includes('17 * 23') ? '391'
    : body.messages[0].content.includes('TypeScript') ? 'export function add(a:number,b:number):number{return a+b;}' : 'भारत की राजधानी नई दिल्ली है।';
  const message = body.tools ? { role: 'assistant', content: null, tool_calls: [{ id: 'synthetic-call', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Jaipur"}' } }] }
    : { role: 'assistant', content };
  return new Response(JSON.stringify({ id: 'synthetic', object: 'chat.completion', model: body.model, choices: [{ index: 0, finish_reason: body.tools ? 'tool_calls' : 'stop', message }], ...usage }), { headers: { 'Content-Type': 'application/json' } });
};
let passed = 0;
const check = label => { passed++; console.log(`PASS ${passed}: ${label}`); };
try {
  const store = new FreeChainStore(db);
  const initial = await comparisonStatus(); assert.equal(initial.budgetAvailable, false); assert.equal(calls, 0);
  assert.equal(await store.readPaidBudgetPolicy(), null); check('status performs no inference and never initializes paid authority');
  const policy = await store.setPaidBudgetPolicy({ capNanoUsd: 2e9, expectedRevision: 0, actorUid: 'synthetic-admin', reason: 'Initialize isolated comparison test budget' }); assert.equal(policy.ok, true);
  const digest = comparisonTariffDigest((await readComparisonRates()).rates), runId = randomUUID();
  const first = runComparison(runId, 'synthetic-admin', new AbortController().signal, digest);
  await firstReady;
  await assert.rejects(runComparison(randomUUID(), 'synthetic-admin', new AbortController().signal, digest), /comparison-already-running/);
  assert.equal(calls, 1); check('real transaction admits one global run while a competing run dispatches nothing');
  releaseFirst(); const report = await first; assert.equal(report.completed, true); assert.equal(calls, 12);
  assert.equal(report.results.every(r => r.passed && r.settlementConfirmed && r.costUsd > 0), true);
  const settled = await store.spendSnapshot(); assert.equal(settled.heldNanoUsd, 0); assert.ok(settled.spentNanoUsd > 0); check('all twelve SDK fixture calls settle real daily budget reservations with measured tokens');
  assert.deepEqual(await runComparison(runId, 'synthetic-admin', new AbortController().signal, digest), report); assert.equal(calls, 12); check('saved replay sends no extra inference');
  await assert.rejects(runComparison(randomUUID(), 'synthetic-admin', new AbortController().signal, '0'.repeat(64)), /rates-changed/); assert.equal(calls, 12); check('stale tariff review cannot dispatch');
  omitUsage = true;
  const unknown = await runComparison(randomUUID(), 'second-synthetic-admin', new AbortController().signal, digest);
  assert.equal(unknown.results.length, 12); assert.equal(unknown.results.every(r => r.costUsd === null && !r.settlementConfirmed), true);
  const held = await store.spendSnapshot(); assert.equal(held.pending, 12); assert.ok(held.heldNanoUsd > 1e9); check('unknown SDK usage retains full real shared reservations rather than inventing zero spend');
  await assert.rejects(runComparison(randomUUID(), 'third-synthetic-admin', new AbortController().signal, digest), /shared-budget/); assert.equal(calls, 24); check('committed unknown spend prevents another run before provider dispatch');
  const state = (await db.doc('free_chat_chain/deepinfra_comparison').get()).data(); assert.equal(state.report.runId, unknown.runId);
  assert.equal(JSON.stringify(state).includes('synthetic-emulator-only'), false); assert.equal(JSON.stringify(state).includes('NAVBHARAT_OK'), false); check('saved state contains bounded metrics, no credential or generated output');
  console.log(`DeepInfra comparison emulator drills: ${passed} passed; 0 failed. Provider responses were synthetic; no paid inference or production data used.`);
} finally { globalThis.fetch = previousFetch; await db.recursiveDelete(db.collection('free_chat_chain')); await db.terminate(); }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createMitrifyClient, mitrifyConfig, withMitrifyChatPrivacyBoundary } from '../../src/server/lib/mitrify.ts';

const input = { model: 'ignored', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello.' }], temperature: 0.2, max_tokens: 12 };
const chunk = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const reply = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] })); };
async function fixture(t, handle) {
  const key = randomUUID(); // Ephemeral mock credential, never a fixture or environment secret.
  const logs = []; const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const parts = []; for await (const part of req) parts.push(part);
      const body = Buffer.concat(parts).toString();
      requests.push({ body: body ? JSON.parse(body) : null, authorization: req.headers.authorization, url: req.url });
      await handle(req, res, requests.length, key);
    } catch { res.destroy(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const env = { MITRIFY_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, MITRIFY_API_KEY: key };
  return { env, key, requests, logs, client: createMitrifyClient(env, record => logs.push(record)), signal: AbortSignal.timeout(15000) };
}

test('normal response preserves standard parameters; overrides only model and credentials', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('X-Mitrify-Provider', 'unknown-future-upstream'); reply(res); });
  const result = await f.client.chat(input, { signal: f.signal });
  assert.equal(result.data.choices[0].message.content, 'Hello');
  assert.deepEqual(f.requests[0].body, { ...input, model: mitrifyConfig({}).model });
  assert.equal(f.requests[0].authorization, `Bearer ${f.key}`);
  assert.equal(f.logs[0]['X-Mitrify-Provider'], 'unknown-future-upstream');
  assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('stream order and incremental delivery: server waits for first consumer chunk', async t => {
  let release; const firstConsumed = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.write(chunk('one'));
    await firstConsumed;
    res.end(chunk('two') + 'data: [DONE]\n\n');
  });
  const received = [];
  await f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { received.push(Buffer.from(bytes).toString()); release(); } });
  assert.deepEqual(received, [chunk('one'), chunk('two'), 'data: [DONE]\n\n']);
  assert.deepEqual(f.requests[0].body.stream_options, { include_usage: true });
});

for (const status of [429, 503]) test(`${status} retries with backoff then returns one result`, async t => {
  const times = [];
  const f = await fixture(t, (_req, res, n) => {
    times.push(Date.now()); if (n === 1) { res.writeHead(status, { 'Retry-After': '1.4' }); res.end('{}'); } else reply(res);
  });
  const result = await f.client.chat(input, { signal: f.signal });
  assert.equal(result.data.choices[0].message.content, 'Hello');
  assert.equal(f.requests.length, 2); assert.ok(times[1] - times[0] >= 1300);
  assert.ok(f.logs.some(x => x.code === 'MITRIFY_RETRY' && x.delayMs >= 1400));
});

test('at most three retries', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(429); res.end('{}'); });
  await assert.rejects(f.client.chat(input, { signal: f.signal }), { status: 429 });
  assert.equal(f.requests.length, 4);
  const waits = f.logs.filter(x => x.code === 'MITRIFY_RETRY').map(x => x.delayMs);
  assert.ok(waits[0] >= 1000 && waits[1] >= 2000 && waits[2] >= 4000);
});

for (const failure of ['disconnect', 'error-event', 'missing-done']) test(`partial stream ${failure} is never replayed`, async t => {
  let release; const seen = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.write(chunk('partial')); await seen;
    if (failure === 'disconnect') res.destroy();
    else if (failure === 'error-event') res.end('data: {"error":{"message":"upstream failed"}}\n\n');
    else res.end();
  });
  let received = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { received += Buffer.from(bytes).toString(); release(); } }), error => error.partial && /incomplete/.test(error.message));
  assert.equal(f.requests.length, 1); assert.equal(received, chunk('partial'));
});

test('user cancellation closes upstream connection', async t => {
  let disconnected; const closed = new Promise(resolve => { disconnected = resolve; });
  const f = await fixture(t, (_req, res) => {
    res.on('close', disconnected); res.setHeader('Content-Type', 'text/event-stream'); res.write(chunk('first'));
  });
  const controller = new AbortController();
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: controller.signal, onChunk: () => controller.abort() }));
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Upstream still open')), 2000); timer.unref(); })]);
  assert.equal(f.requests.length, 1);
});

test('cancellation after first buffered event discards later events and cannot report success', async t => {
  const f = await fixture(t, (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(chunk('first') + chunk('must-not-send') + 'data: [DONE]\n\n');
  });
  const controller = new AbortController(); const received = [];
  await assert.rejects(f.client.chat({ ...input, stream: true }, {
    signal: controller.signal,
    onChunk: bytes => { received.push(Buffer.from(bytes).toString()); controller.abort(); },
  }), { code: 'MITRIFY_CANCELLED', partial: true });
  assert.deepEqual(received, [chunk('first')]);
  assert.equal(f.requests.length, 1);
});

for (const status of [400, 401, 403, 500]) test(`${status} does not retry or disclose echoed secrets/content`, async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    res.writeHead(status, { 'X-Mitrify-Trail': key });
    res.end(JSON.stringify({ error: { source: 'mitrify', type: 'test', message: `${key} PRIVATE_MESSAGE` } }));
  });
  await assert.rejects(f.client.chat(input, { signal: f.signal }), error => {
    assert.ok(!String(error).includes(f.key)); assert.ok(!String(error).includes('PRIVATE_MESSAGE')); return error.status === status;
  });
  assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key)); assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_MESSAGE'));
});

test('direct/default keeps the exact existing callback; mitrify fails closed for general chat', async () => {
  for (const env of [{}, { AI_PROVIDER: 'direct' }, { AI_PROVIDER: 'mitrify' }, { AI_PROVIDER: 'invalid' }]) {
    const original = { result: 'unchanged' }; let calls = 0; const logs = [];
    const result = await withMitrifyChatPrivacyBoundary(async () => { calls++; return original; }, env, m => logs.push(m));
    assert.equal(result, original); assert.equal(calls, 1);
    assert.equal(logs.length, env.AI_PROVIDER === 'mitrify' ? 1 : 0);
  }
  const source = readFileSync(new URL('../../src/server/routes/chat.ts', import.meta.url), 'utf8');
  assert.equal(source.split("withMitrifyChatPrivacyBoundary(() => chatHandler(req, res, 'navbharat'))").length - 1, 2);
  assert.ok(source.includes("qualityTier: 'clinical', dataClass: 'health'"));
});

test('reject unsupported capabilities, provider fields and oversized bodies before dispatch', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  for (const extra of [{ tools: [] }, { response_format: { type: 'json_object' } }, { provider: {} }, { route: 'fallback' }, { messages: [{ role: 'user', content: [] }] }]) {
    await assert.rejects(f.client.chat({ ...input, ...extra }, { signal: f.signal }), { code: 'MITRIFY_UNSUPPORTED_REQUEST' });
  }
  await assert.rejects(f.client.chat({ ...input, messages: [{ role: 'user', content: 'a'.repeat(8 * 1024 * 1024) }] }, { signal: f.signal }), { code: 'MITRIFY_BODY_TOO_LARGE' });
  assert.equal(f.requests.length, 0);
});

test('missing key fails without dispatch; HTML is not accepted as API JSON', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html>website</html>'); });
  await assert.rejects(createMitrifyClient({ ...f.env, MITRIFY_API_KEY: '' }, () => {}).chat(input, { signal: f.signal }), { code: 'MITRIFY_CONFIGURATION' });
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.client.models(f.signal), { code: 'MITRIFY_INVALID_RESPONSE' });
  await assert.rejects(f.client.chat(input, { signal: f.signal }), { code: 'MITRIFY_INVALID_RESPONSE' });
});

test('existing stream options and all requested standard parameters survive', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.end(chunk('ok') + 'data: [DONE]\n\n'); });
  const request = { ...input, stream: true, top_p: 0.5, seed: 17, stop: ['END'], stream_options: { include_usage: false, include_obfuscation: false } };
  await f.client.chat(request, { signal: f.signal, onChunk: () => {} });
  assert.deepEqual(f.requests[0].body, { ...request, model: mitrifyConfig({}).model, stream_options: { include_usage: true, include_obfuscation: false } });
  assert.equal(request.stream_options.include_usage, false);
});

test('cancellation during a Retry-After wait prevents another request', async t => {
  const controller = new AbortController();
  const f = await fixture(t, (_req, res) => { res.writeHead(503, { 'Retry-After': '100' }); res.end('{}'); });
  const client = createMitrifyClient(f.env, record => { if (record.code === 'MITRIFY_RETRY') controller.abort(); });
  await assert.rejects(client.chat(input, { signal: controller.signal }), { code: 'MITRIFY_CANCELLED' });
  assert.equal(f.requests.length, 1);
});

test('HTTP-date Retry-After is respected', async t => {
  const next = new Date(Date.now() + 4000).toUTCString();
  const controller = new AbortController(); let wait = 0;
  const f = await fixture(t, (_req, res) => { res.writeHead(429, { 'Retry-After': next }); res.end('{}'); });
  const client = createMitrifyClient(f.env, record => { if (record.code === 'MITRIFY_RETRY') { wait = record.delayMs; controller.abort(); } });
  await assert.rejects(client.chat(input, { signal: controller.signal }));
  assert.ok(wait >= 2000); assert.equal(f.requests.length, 1);
});

test('redirects never forward credentials to another endpoint', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(302, { Location: '/another-endpoint' }); res.end(); });
  await assert.rejects(f.client.chat(input, { signal: f.signal }), { code: 'MITRIFY_NETWORK' });
  assert.equal(f.requests.length, 1);
});

test('models accepts an unknown runtime catalogue without pinning entries', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"data":[{"id":"future-policy"}]}'); });
  const result = await f.client.models(f.signal);
  assert.equal(result.status, 200); assert.equal(f.requests[0].url, '/v1/models');
  assert.deepEqual(Object.keys(result), ['status', 'headers']);
});

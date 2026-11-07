import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createMitrifyClient, mitrifyConfig, withMitrifyChatPrivacyBoundary, runMitrifyPublicTest, mitrifyPublicBotStatus, runMitrifyPublicBot, MitrifyError } from '../../src/server/lib/mitrify.ts';

const input = { model: 'ignored', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello.' }], temperature: 0.2, max_tokens: 12 };
const chunk = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const reply = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] })); };

test('typed public text is sent unchanged, alone, only after explicit confirmation', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  const identify = async () => ({ uid: 'local-only', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true });
  const message = '  Explain why the sky is blue.\nUse simple words.  ';
  const send = body => runMitrifyPublicBot({ body, identify, signal: f.signal }, env, metadata => f.logs.push(metadata));
  for (const body of [{ message }, { message, publicContentConfirmed: false }, { message, publicContentConfirmed: 'true' }, { message: ' ', publicContentConfirmed: true }, { message: 'a'.repeat(2001), publicContentConfirmed: true }, { message, publicContentConfirmed: true, history: [] }]) {
    await assert.rejects(send(body), { code: 'MITRIFY_BOT_REVIEW_REQUIRED' });
  }
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await send({ message, publicContentConfirmed: true }), { reply: 'Hello' });
  assert.deepEqual(f.requests[0].body.messages, [{ role: 'user', content: message }]);
  assert.equal(f.requests[0].body.max_tokens, 256);
  assert.equal(JSON.stringify(f.logs).includes(message), false);
  assert.equal(JSON.stringify(f.requests[0].body).includes('local-only'), false);
});

test('recognizable sensitive patterns are blocked before upstream dispatch without logging text', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  const identify = async () => ({ uid: 'local-only', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true });
  for (const message of ['Contact sample@example.invalid', 'Call 123-456-7890', 'password=example-placeholder', 'Patient lab report for review', 'Health records for review', 'My name is Example Person', 'मेरा नाम उदाहरण है']) {
    await assert.rejects(runMitrifyPublicBot({ body: { message, publicContentConfirmed: true }, identify, signal: f.signal }, env, metadata => f.logs.push(metadata)), { code: 'MITRIFY_BOT_SENSITIVE_CONTENT' });
  }
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.logs, []);
});

test('typed-message confirmation cannot authorize an unrelated or unverified account', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  for (const identity of [null, { uid: 'other', email: 'other@example.invalid', emailVerified: true }, { uid: 'local-only', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: false }]) {
    await assert.rejects(runMitrifyPublicBot({ body: { message: 'Explain rainbows.', publicContentConfirmed: true }, identify: async () => identity, signal: f.signal }, env), { code: 'MITRIFY_BOT_FORBIDDEN' });
  }
  assert.equal(f.requests.length, 0);
});

test('separate bot verifies account on visibility and send; caller identity cannot grant access', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  for (const identity of [null, { uid: 'outsider', email: 'other@example.invalid', emailVerified: true }, { uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: false }]) {
    const identify = async () => identity;
    await assert.rejects(mitrifyPublicBotStatus(identify, f.signal, env), { code: 'MITRIFY_BOT_FORBIDDEN' });
    await assert.rejects(runMitrifyPublicBot({ identify, signal: f.signal, body: { questionId: 'arithmetic', uid: 'tester' } }, env), { code: 'MITRIFY_BOT_FORBIDDEN' });
  }
  assert.equal(f.requests.length, 0);
});

test('separate bot sends only server public text and rejects any private fields', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  const identify = async () => ({ uid: 'private-local-uid', email: 'TESTER@example.invalid', emailVerified: true });
  const status = await mitrifyPublicBotStatus(identify, f.signal, env);
  assert.equal(status.available, true); assert.equal(status.questions.length, 3);
  for (const body of [null, [], {}, { questionId: 'unknown' }, ...['messages', 'history', 'profile', 'attachments', 'email', 'temperature'].map(field => ({ questionId: 'arithmetic', [field]: 'not allowed' }))]) {
    await assert.rejects(runMitrifyPublicBot({ body, identify, signal: f.signal }, env), { code: 'MITRIFY_BOT_PUBLIC_QUESTION_REQUIRED' });
  }
  assert.equal(f.requests.length, 0);
  assert.deepEqual(await runMitrifyPublicBot({ body: { questionId: 'arithmetic' }, identify, signal: f.signal }, env, metadata => f.logs.push(metadata)), { reply: 'Hello' });
  assert.deepEqual(f.requests[0].body, { messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }], max_tokens: 256, stream: false, model: 'mitrify/auto-cheap' });
  assert.equal(JSON.stringify(f.requests[0].body).includes('private-local-uid'), false);
  assert.equal(JSON.stringify(f.logs).includes(env.MITRIFY_CHAT_ACCOUNT_EMAIL), false);
});

test('separate bot default direct disables sends and missing key reports unavailable', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  const identify = async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true });
  assert.equal((await mitrifyPublicBotStatus(identify, f.signal, env)).available, false);
  assert.equal((await mitrifyPublicBotStatus(identify, f.signal, { ...env, AI_BACKEND: 'mitrify', MITRIFY_API_KEY: '' })).available, false);
  await assert.rejects(runMitrifyPublicBot({ body: { questionId: 'arithmetic' }, identify, signal: f.signal }, env), { code: 'MITRIFY_BOT_DISABLED' });
  assert.equal(f.requests.length, 0);
});

test('separate bot failure has no direct fallback and cancellation bounds identity lookup', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(401); res.end('{}'); });
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  const identify = async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true });
  await assert.rejects(runMitrifyPublicBot({ body: { questionId: 'rainbow' }, identify, signal: f.signal }, env, () => {}), { status: 401 });
  assert.equal(f.requests.length, 1);
  const controller = new AbortController();
  const pending = mitrifyPublicBotStatus(() => new Promise(() => {}), controller.signal, env);
  controller.abort();
  await assert.rejects(pending, { code: 'MITRIFY_CANCELLED' });
});
async function fixture(t, handle, keyPrefix = 'mock-') {
  const key = `${keyPrefix}${randomUUID()}`; // Ephemeral mock credential, never a fixture or environment secret.
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

test('AI_BACKEND has explicit precedence over the legacy alias; direct remains unchanged', async () => {
  for (const env of [{}, { AI_BACKEND: 'direct', AI_PROVIDER: 'mitrify' }, { AI_BACKEND: 'invalid', AI_PROVIDER: 'mitrify' }]) {
    let called = 0; const result = {};
    assert.equal(mitrifyConfig(env).enabled, false);
    assert.equal(await withMitrifyChatPrivacyBoundary(async () => { called++; return result; }, env, () => {}), result);
    assert.equal(called, 1);
  }
  assert.equal(mitrifyConfig({ AI_BACKEND: 'mitrify', AI_PROVIDER: 'direct' }).enabled, true);
  assert.equal(mitrifyConfig({ AI_PROVIDER: 'mitrify' }).enabled, true);
  assert.equal(mitrifyConfig({ AI_BACKEND: ' ', AI_PROVIDER: 'mitrify' }).enabled, true);
  assert.equal(mitrifyConfig({}).maxInflight, 200);
  assert.equal(await withMitrifyChatPrivacyBoundary(async () => 'unchanged', { AI_BACKEND: 'direct', MITRIFY_MAX_INFLIGHT: 'invalid' }), 'unchanged');
  for (const value of ['0', '-1', 'Infinity', 'NaN', '2.5', '1001']) assert.throws(() => mitrifyConfig({ MITRIFY_MAX_INFLIGHT: value }), { code: 'MITRIFY_CONFIGURATION' });
});

test('canonical backend uses the opaque model and logs Attempts metadata without rewriting reply', async t => {
  const expected = { choices: [{ message: { content: '  A different response style.\n' } }], usage: { total_tokens: 4 } };
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Mitrify-Attempts', '3'); res.end(JSON.stringify(expected)); });
  const client = createMitrifyClient({ ...f.env, AI_BACKEND: 'mitrify' }, m => f.logs.push(m));
  const result = await client.chat(input, { signal: f.signal });
  assert.deepEqual(result.data, expected); assert.equal(f.requests[0].url, '/v1/chat/completions');
  assert.equal(f.requests[0].authorization, `Bearer ${f.key}`);
  assert.equal(result.headers['X-Mitrify-Attempts'], '3'); assert.ok(f.logs.some(m => m['X-Mitrify-Attempts'] === '3'));
});

test('one FIFO cap is shared across clients and holds requests until the response is read', async t => {
  let start; const started = new Promise(resolve => { start = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  let active = 0; let peak = 0;
  const f = await fixture(t, async (_req, res, n) => { active++; peak = Math.max(peak, active); if (n === 1) { start(); await held; } reply(res); active--; });
  const clients = [0, 1].map(() => createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, m => f.logs.push(m)));
  const request = n => ({ ...input, messages: [{ role: 'user', content: String(n) }] });
  const first = clients[0].chat(request(1), { signal: f.signal }); await started;
  const second = clients[1].chat(request(2), { signal: f.signal });
  const third = clients[0].chat(request(3), { signal: f.signal });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.requests.length, 1);
  release(); await Promise.all([first, second, third]);
  assert.equal(peak, 1); assert.deepEqual(f.requests.map(r => r.body.messages[0].content), ['1', '2', '3']);
});

test('queued cancellation removes only that request, never dispatches it, and frees capacity', async t => {
  let start; const started = new Promise(resolve => { start = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async (_req, res, n) => { if (n === 1) { start(); await held; } reply(res); });
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, m => f.logs.push(m));
  const first = client.chat(input, { signal: f.signal }); await started;
  const cancelled = new AbortController();
  const second = client.chat({ ...input, messages: [{ role: 'user', content: 'must not send' }] }, { signal: cancelled.signal });
  const rejection = assert.rejects(second, error => error.code === 'MITRIFY_CANCELLED' && !String(error).includes(f.key));
  const third = client.chat(input, { signal: f.signal }); cancelled.abort(f.key); await rejection;
  assert.equal(f.requests.length, 1); release(); await Promise.all([first, third]);
  assert.equal(f.requests.length, 2); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('a streaming permit remains held while a downstream chunk callback is pending', async t => {
  let seen; const visible = new Promise(resolve => { seen = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, (_req, res, n) => {
    if (n === 1) { res.setHeader('Content-Type', 'text/event-stream'); res.end(chunk('one') + 'data: [DONE]\n\n'); } else reply(res);
  });
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, m => f.logs.push(m));
  const first = client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: async () => { seen(); await held; } }); await visible;
  const second = client.chat(input, { signal: f.signal });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.requests.length, 1);
  release(); await Promise.all([first, second]); assert.equal(f.requests.length, 2);
});

test('a credential echoed in a stream is never forwarded or retried', async t => {
  const f = await fixture(t, (_req, res, _n, key) => { res.setHeader('Content-Type', 'text/event-stream'); res.end(chunk(key) + 'data: [DONE]\n\n'); });
  let output = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { output += Buffer.from(bytes).toString(); } }), error => !String(error).includes(f.key));
  assert.equal(output, ''); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

for (const mode of ['comment', 'split-delta']) test(`credential protection covers ${mode}`, async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(mode === 'comment' ? `: ${key}\n\n${chunk('safe')}data: [DONE]\n\n`
      : chunk(key.slice(0, 12)) + chunk(key.slice(12)) + 'data: [DONE]\n\n');
  });
  let output = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal,
    onChunk: bytes => { output += Buffer.from(bytes).toString(); } }));
  assert.equal(output, ''); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('abort while downstream callback hangs rejects promptly and releases the global permit', async t => {
  let seen; const visible = new Promise(resolve => { seen = resolve; });
  const f = await fixture(t, (_req, res, n) => {
    if (n === 1) { res.setHeader('Content-Type', 'text/event-stream'); res.write(chunk('safe')); }
    else reply(res);
  });
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, m => f.logs.push(m));
  const controller = new AbortController();
  let release; const held = new Promise(resolve => { release = resolve; }); t.after(release);
  const first = client.chat({ ...input, stream: true }, { signal: controller.signal, onChunk: () => { seen(); return held; } });
  const rejected = assert.rejects(first, { code: 'MITRIFY_CANCELLED' });
  await visible; const second = client.chat(input, { signal: AbortSignal.timeout(1500) });
  controller.abort();
  await second; await rejected;
  assert.equal(f.requests.length, 2);
});

for (const field of ['refusal', 'reasoning_content', 'metadata']) test(`split credential in forwarded ${field} never reaches the consumer`, async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    const event = text => `data: ${JSON.stringify(field === 'metadata' ? { id: text, choices: [] }
      : { choices: [{ index: 0, delta: { [field]: text } }] })}\n\n`;
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(event(key.slice(0, 10)) + event(key.slice(10)) + 'data: [DONE]\n\n');
  });
  let output = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal,
    onChunk: bytes => { output += Buffer.from(bytes).toString(); } }));
  assert.equal(output, ''); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('nested array string fields cannot expose credential fragments', async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const body = { choices: [{ index: 0, delta: { content: 'safe' }, logprobs: { content: [{ token: key.slice(0, 10) }, { token: key.slice(10) }] } }] };
    res.end(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`);
  });
  let output = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { output += Buffer.from(bytes).toString(); } }));
  assert.equal(output, ''); assert.equal(f.requests.length, 1);
});

test('repeated metadata prefixes release earlier safe events before stream completion', async t => {
  let consumed; const seen = new Promise(resolve => { consumed = resolve; });
  const event = text => `data: ${JSON.stringify({ id: 'm', choices: [{ index: 0, delta: { content: text } }] })}\n\n`;
  const f = await fixture(t, async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.write(event('one') + event('two'));
    await seen; res.end('data: [DONE]\n\n');
  });
  let output = '';
  await f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { output += Buffer.from(bytes).toString(); consumed(); } });
  assert.equal(output, event('one') + event('two') + 'data: [DONE]\n\n');
});

test('one-time role ending with a credential prefix cannot buffer a large ordinary stream', async t => {
  let consumed; const seen = new Promise(resolve => { consumed = resolve; });
  const role = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`;
  const text = 'ordinary answer '.repeat(1024);
  const f = await fixture(t, async (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.write(role);
    await seen;
    for (let n = 0; n < 100; n++) res.write(chunk(text));
    res.end('data: [DONE]\n\n');
  }, 't');
  let bytesSeen = 0; let chunksSeen = 0;
  await f.client.chat({ ...input, stream: true }, { signal: AbortSignal.timeout(2000), onChunk: bytes => {
    bytesSeen += bytes.length; chunksSeen++; consumed();
  } });
  assert.ok(bytesSeen > 1.5 * 1024 * 1024); assert.equal(chunksSeen, 102); assert.equal(f.requests.length, 1);
});

test('single-character credential fragments fail before a substantial prefix is disclosed', async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end([...key].map(chunk).join('') + 'data: [DONE]\n\n');
  });
  let disclosed = '';
  await assert.rejects(f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => {
    const event = Buffer.from(bytes).toString().trim().slice(6);
    disclosed += JSON.parse(event).choices[0].delta.content;
  } }), error => error.partial && error.code === 'MITRIFY_STREAM_ERROR');
  assert.ok(disclosed.length < 8); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('queue count is bounded and cancellation releases every waiting entry', async t => {
  let start; const started = new Promise(resolve => { start = resolve; });
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); start(); });
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, () => {});
  const controller = new AbortController();
  const first = client.chat(input, { signal: controller.signal }).catch(e => e); await started;
  const waiting = Array.from({ length: 1000 }, () => client.chat(input, { signal: controller.signal }).catch(e => e));
  await assert.rejects(client.chat(input, { signal: controller.signal }), { code: 'MITRIFY_QUEUE_FULL' });
  controller.abort(); const results = await Promise.all([first, ...waiting]);
  assert.ok(results.every(r => r.code === 'MITRIFY_CANCELLED')); assert.equal(f.requests.length, 1);
});

test('retained serialized request bytes are bounded independently of queue count', async t => {
  let start; const started = new Promise(resolve => { start = resolve; });
  const f = await fixture(t, (_req, _res) => start());
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, () => {});
  const controller = new AbortController(); const large = { messages: [{ role: 'user', content: 'x'.repeat(7 * 1024 * 1024) }] };
  const first = client.chat(large, { signal: controller.signal }).catch(e => e); await started;
  const waiting = Array.from({ length: 8 }, () => client.chat(large, { signal: controller.signal }).catch(e => e));
  await assert.rejects(client.chat(large, { signal: controller.signal }), { code: 'MITRIFY_QUEUE_FULL' });
  controller.abort(); await Promise.all([first, ...waiting]); assert.equal(f.requests.length, 1);
});

test('backoff holds one logical permit, so a queued call cannot jump ahead of its retry', async t => {
  let start; const started = new Promise(resolve => { start = resolve; });
  const f = await fixture(t, (_req, res, n) => { if (n === 1) { start(); res.writeHead(429); res.end('{}'); } else reply(res); });
  const client = createMitrifyClient({ ...f.env, MITRIFY_MAX_INFLIGHT: '1' }, m => f.logs.push(m));
  const first = client.chat({ ...input, messages: [{ role: 'user', content: 'first' }] }, { signal: f.signal }); await started;
  const second = client.chat({ ...input, messages: [{ role: 'user', content: 'second' }] }, { signal: f.signal });
  await Promise.all([first, second]); assert.deepEqual(f.requests.map(r => r.body.messages[0].content), ['first', 'first', 'second']);
});

test('normal response preserves standard parameters; overrides only model and credentials', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('X-Mitrify-Provider', 'unknown-future-upstream'); reply(res); });
  const result = await f.client.chat(input, { signal: f.signal });
  assert.equal(result.data.choices[0].message.content, 'Hello');
  assert.deepEqual(f.requests[0].body, { ...input, model: mitrifyConfig({}).model });
  assert.equal(f.requests[0].authorization, `Bearer ${f.key}`);
  assert.equal(f.logs[0]['X-Mitrify-Provider'], 'unknown-future-upstream');
  assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

const publicIdentity = async () => ({ uid: 'synthetic-account', email: 'tester@example.invalid', emailVerified: true });
const publicEnv = env => ({ ...env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' });
test('public-test cancellation does not wait for unresolved identity verification', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const controller = new AbortController(); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const request = runMitrifyPublicTest({ body: {}, signal: controller.signal,
    identify: () => { entered(); return new Promise(() => {}); } }, publicEnv(f.env));
  const rejected = assert.rejects(request, { code: 'MITRIFY_CANCELLED' });
  await started; controller.abort();
  let timer;
  try { await Promise.race([rejected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Identity cancellation did not settle')), 500); })]); }
  finally { clearTimeout(timer); }
  assert.equal(f.requests.length, 0);
});

test('safe delta sharing a short credential prefix is forwarded unchanged', async t => {
  const f = await fixture(t, (_req, res, _n, key) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(chunk(key.slice(0, 5)) + chunk('ordinary answer') + 'data: [DONE]\n\n');
  });
  let output = '';
  await f.client.chat({ ...input, stream: true }, { signal: f.signal, onChunk: bytes => { output += Buffer.from(bytes).toString(); } });
  assert.equal(output, chunk(f.key.slice(0, 5)) + chunk('ordinary answer') + 'data: [DONE]\n\n');
});
test('cancelled pending admission settles promptly and a late execute cannot dispatch', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const controller = new AbortController(); let execute; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const request = runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: controller.signal,
    admission: { maxTotalInr: 0, runOnce: (_claim, run) => { execute = run; entered(); return new Promise(() => {}); } } }, publicEnv(f.env));
  const rejected = assert.rejects(request, { code: 'MITRIFY_CANCELLED' });
  await started; controller.abort();
  let timer;
  try { await Promise.race([rejected, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Admission cancellation did not settle')), 500); })]); }
  finally { clearTimeout(timer); }
  await assert.rejects(execute()); assert.equal(f.requests.length, 0);
});
const publicReply = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '4' } }] })); };
// Local mock only. Production has no admission adapter and cannot execute the test.
function mockPublicAdmission() {
  let used = false; const claims = [];
  return { maxTotalInr: 10, claims, async runOnce(claim, execute) {
    if (used) throw new MitrifyError('MITRIFY_TEST_ALREADY_USED', 409);
    used = true; claims.push(claim); return execute();
  } };
}

test('isolated public test sends only fixed text, binds cost admission, and consumes one logical test', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  const admission = mockPublicAdmission();
  const options = { body: {}, identify: publicIdentity, signal: f.signal, admission };
  const result = await runMitrifyPublicTest(options, publicEnv(f.env), x => f.logs.push(x));
  assert.equal(result.data.choices[0].message.content, '4');
  assert.deepEqual(f.requests[0].body, { model: mitrifyConfig({}).model,
    messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }], max_tokens: 16, temperature: 0, stream: false });
  assert.equal(admission.claims[0].maxTotalInr, 10); assert.equal(admission.claims[0].includesAllAttempts, true);
  assert.equal(admission.claims[0].gateway.baseURL, f.env.MITRIFY_BASE_URL);
  assert.equal(admission.claims[0].gateway.credentialFingerprint.length, 64);
  await assert.rejects(runMitrifyPublicTest(options, publicEnv(f.env)), { code: 'MITRIFY_TEST_ALREADY_USED' });
  assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify(f.requests[0].body).includes('synthetic-account'));
  assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('public test denies missing admission even with identity, key, and configured switch', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  await assert.rejects(runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal }, publicEnv(f.env)), { code: 'MITRIFY_TEST_BUDGET_UNVERIFIED' });
  assert.equal(f.requests.length, 0);
});

test('public test preserves provider wording, usage and metadata without response rewriting', async t => {
  const expected = { choices: [{ message: { content: '  The sum is four.\n' } }], usage: { total_tokens: 9 } };
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Mitrify-Provider', 'opaque-upstream'); res.end(JSON.stringify(expected)); });
  const result = await runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission: mockPublicAdmission() }, publicEnv(f.env), x => f.logs.push(x));
  assert.deepEqual(result.data, expected); assert.equal(result.headers['X-Mitrify-Provider'], 'opaque-upstream');
  assert.ok(!JSON.stringify(f.logs).includes('What is 2 + 2'));
});

test('public test rejects caller content and parameters before reading identity or invoking admission', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  for (const body of [null, [], { message: 'PRIVATE' }, { history: [] }, { userProfile: {} }, { fileAttachments: [] }, { stream: true }, { maxTotalInr: 100 }, { admission: true }]) {
    await assert.rejects(runMitrifyPublicTest({ body, signal: f.signal,
      identify: async () => { throw new Error('must not read identity'); }, admission: mockPublicAdmission() }, publicEnv(f.env)), { code: 'MITRIFY_TEST_EMPTY_BODY_REQUIRED' });
  }
  assert.equal(f.requests.length, 0);
});

test('public test rejects unrelated, unsigned and unverified identity without spending', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  for (const identity of [null, { uid: 'other', email: 'other@example.invalid', emailVerified: true }, { uid: 'synthetic-account', email: 'tester@example.invalid', emailVerified: false }]) {
    const admission = mockPublicAdmission();
    await assert.rejects(runMitrifyPublicTest({ body: {}, identify: async () => identity, signal: f.signal, admission }, publicEnv(f.env)), { code: 'MITRIFY_TEST_FORBIDDEN' });
    assert.equal(admission.claims.length, 0);
  }
  assert.equal(f.requests.length, 0);
});

test('public test is off by default without touching identity or network', async () => {
  await assert.rejects(runMitrifyPublicTest({ body: {}, identify: async () => { throw new Error('unexpected identity read'); }, signal: new AbortController().signal }, {}), { code: 'MITRIFY_TEST_DISABLED' });
});

test('public test includes retries within the same single-use admission', async t => {
  const f = await fixture(t, (_req, res, n) => { if (n === 1) { res.writeHead(429); res.end('{}'); } else publicReply(res); });
  const admission = mockPublicAdmission();
  await runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission }, publicEnv(f.env), x => f.logs.push(x));
  assert.equal(f.requests.length, 2); assert.equal(admission.claims.length, 1);
});

test('concurrent public test requests consume only one mock admission; failed calls remain consumed', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(400); res.end('{}'); });
  const admission = mockPublicAdmission();
  const run = () => runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission }, publicEnv(f.env), x => f.logs.push(x));
  const results = await Promise.allSettled([run(), run()]);
  assert.ok(results.every(r => r.status === 'rejected'));
  assert.deepEqual(results.map(r => r.reason.code).sort(), ['MITRIFY_BAD_REQUEST', 'MITRIFY_TEST_ALREADY_USED'].sort());
  await assert.rejects(run(), { code: 'MITRIFY_TEST_ALREADY_USED' });
  assert.equal(f.requests.length, 1);
});

test('public test freezes gateway binding and cannot expose an unexpected upstream reply', async t => {
  const f = await fixture(t, (_req, res, _n, key) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: key } }] })); });
  const env = publicEnv(f.env);
  const admission = { maxTotalInr: 10, async runOnce(_claim, execute) { env.MITRIFY_BASE_URL = 'https://must-not-contact.invalid/v1'; return execute(); } };
  await assert.rejects(runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission }, env, x => f.logs.push(x)), error => {
    assert.equal(error.code, 'MITRIFY_INVALID_RESPONSE'); assert.ok(!String(error).includes(f.key)); return true;
  });
  assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.logs).includes(f.key));
});

test('public test cancellation after admission never dispatches or refunds the one-use mock permit', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  const controller = new AbortController();
  const once = mockPublicAdmission();
  const admission = { maxTotalInr: once.maxTotalInr, runOnce: (claim, execute) => once.runOnce(claim, () => { controller.abort(); return execute(); }) };
  await assert.rejects(runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: controller.signal, admission }, publicEnv(f.env)));
  assert.equal(once.claims.length, 1); assert.equal(f.requests.length, 0);
});

test('public test cannot use an unbounded or invalid execution authorization', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  for (const maxTotalInr of [Infinity, NaN, -1]) {
    const admission = { maxTotalInr, runOnce() { throw new Error('must not execute'); } };
    await assert.rejects(runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission }, publicEnv(f.env)), { code: 'MITRIFY_TEST_BUDGET_UNVERIFIED' });
  }
  assert.equal(f.requests.length, 0);
});

test('a server-verified zero-cost mock admission can run the public test', async t => {
  const f = await fixture(t, (_req, res) => publicReply(res));
  const admission = mockPublicAdmission(); admission.maxTotalInr = 0;
  const result = await runMitrifyPublicTest({ body: {}, identify: publicIdentity, signal: f.signal, admission }, publicEnv(f.env), x => f.logs.push(x));
  assert.equal(result.data.choices[0].message.content, '4'); assert.equal(admission.claims[0].maxTotalInr, 0);
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

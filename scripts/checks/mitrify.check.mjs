import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mitrifyChainBinding, runApprovedMitrifyChain, mitrifyGuestTestTokenValid, runMitrifyGuestTest, createMitrifyClient, mitrifyConfig, withMitrifyChatPrivacyBoundary, runMitrifyPublicTest, mitrifyPublicBotStatus, runMitrifyPublicBot, MitrifyError } from '../../src/server/lib/mitrify.ts';

const input = { model: 'ignored', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello.' }], temperature: 0.2, max_tokens: 12 };
const chunk = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const reply = res => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] })); };

test('verified access admits different verified accounts without a selected email', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_BOT_ACCESS: 'verified' };
  for (const email of ['first@example.invalid', 'second@example.invalid']) {
    const identify = async () => ({ uid: email, email, emailVerified: true });
    assert.equal((await mitrifyPublicBotStatus(identify, f.signal, env)).available, true);
    assert.deepEqual(await runMitrifyPublicBot({ identify, signal: f.signal, body: { message: 'Explain rainbows.', publicContentConfirmed: true } }, env, () => {}), { reply: 'Hello', completion: 'complete' });
  }
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(r => !JSON.stringify(r.body).includes('@')));
});

test('verified access still denies unsigned, unverified and missing-email identities', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_BOT_ACCESS: 'verified' };
  for (const identity of [null, { uid: '', email: 'first@example.invalid', emailVerified: true }, { uid: 'first', email: null, emailVerified: true }, { uid: 'first', email: ' ', emailVerified: true }, { uid: 'first', email: 'first@example.invalid', emailVerified: false }]) {
    const identify = async () => identity;
    await assert.rejects(mitrifyPublicBotStatus(identify, f.signal, env), { code: 'MITRIFY_BOT_FORBIDDEN' });
    await assert.rejects(runMitrifyPublicBot({ identify, signal: f.signal, body: { message: 'Explain rainbows.', publicContentConfirmed: true } }, env), { code: 'MITRIFY_BOT_FORBIDDEN' });
  }
  assert.equal(f.requests.length, 0);
});

test('default, rollback and invalid access modes cannot widen account access', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const identify = async () => ({ uid: 'other', email: 'other@example.invalid', emailVerified: true });
  for (const mode of [undefined, '', ' ', 'selected']) {
    for (const target of [undefined, 'selected@example.invalid']) {
      await assert.rejects(mitrifyPublicBotStatus(identify, f.signal, { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_BOT_ACCESS: mode, MITRIFY_CHAT_ACCOUNT_EMAIL: target }), { code: 'MITRIFY_BOT_FORBIDDEN' });
    }
  }
  for (const mode of ['public', 'anonymous', 'VERIFIED', '*']) {
    await assert.rejects(mitrifyPublicBotStatus(identify, f.signal, { ...f.env, MITRIFY_BOT_ACCESS: mode }), { code: 'MITRIFY_CONFIGURATION' });
  }
  const env = { ...f.env, AI_BACKEND: 'direct', MITRIFY_BOT_ACCESS: 'verified' };
  assert.equal((await mitrifyPublicBotStatus(identify, f.signal, env)).available, false);
  await assert.rejects(runMitrifyPublicBot({ identify, signal: f.signal, body: { message: 'Explain rainbows.', publicContentConfirmed: true } }, env), { code: 'MITRIFY_BOT_DISABLED' });
  assert.equal(f.requests.length, 0);
});

test('verified access does not bypass content review, sensitive checks or the main-chat boundary', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_BOT_ACCESS: 'verified' };
  const identify = async () => ({ uid: 'first', email: 'first@example.invalid', emailVerified: true });
  for (const [body, code] of [[{ message: 'Explain rainbows.' }, 'MITRIFY_BOT_REVIEW_REQUIRED'], [{ message: 'Contact sample@example.invalid', publicContentConfirmed: true }, 'MITRIFY_BOT_SENSITIVE_CONTENT']]) {
    await assert.rejects(runMitrifyPublicBot({ identify, signal: f.signal, body }, env), { code });
  }
  let direct = 0;
  assert.equal(await withMitrifyChatPrivacyBoundary(async () => { direct++; return 'unchanged'; }, env, () => {}), 'unchanged');
  assert.equal(direct, 1);
  await assert.rejects(runMitrifyPublicTest({ identify, signal: f.signal, body: {} }, env), { code: 'MITRIFY_TEST_DISABLED' });
  assert.equal(f.requests.length, 0);
});

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
  assert.deepEqual(await send({ message, publicContentConfirmed: true }), { reply: 'Hello', completion: 'complete' });
  assert.deepEqual(f.requests[0].body.messages, [{ role: 'user', content: message }]);
  assert.equal(f.requests[0].body.max_tokens, 2048);
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
  assert.deepEqual(await runMitrifyPublicBot({ body: { questionId: 'arithmetic' }, identify, signal: f.signal }, env, metadata => f.logs.push(metadata)), { reply: 'Hello', completion: 'complete' });
  assert.deepEqual(f.requests[0].body, { messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }], max_tokens: 2048, stream: false, model: 'mitrify/auto-cheap' });
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

function guestCampaign(env) {
  const digest = value => createHash('sha256').update(value).digest('hex');
  const record = { enabled: true, createdAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 300_000,
    baseURL: env.MITRIFY_BASE_URL, model: mitrifyConfig(env).model,
    credentialFingerprint: digest(env.MITRIFY_API_KEY), tokenFingerprint: digest(env.MITRIFY_GUEST_TEST_TOKEN),
    maxTotalUsd: 10, includesAllCharges: true, hardCapConfirmed: true };
  const claims = new Map();
  let tail = Promise.resolve();
  // Serialize commits to model a shared transactional store across independent callers.
  const db = { doc: path => ({ path }), runTransaction: fn => {
    const result = tail.then(async () => {
      const pending = [];
      const value = await fn({ get: async ref => ref.path.includes('/claims/')
        ? { exists: claims.has(ref.path) } : { data: () => ({ ...record }) },
      create: (ref, data) => pending.push([ref.path, data]) });
      for (const [path, data] of pending) { assert.equal(claims.has(path), false); claims.set(path, data); }
      return value;
    });
    tail = result.catch(() => {}); return result;
  } };
  return { db, record, claims };
}
function guestEnv(f) { return { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_GUEST_TEST_ENABLED: '1',
  MITRIFY_GUEST_TEST_CAMPAIGN: 'loopback-campaign', MITRIFY_GUEST_TEST_TOKEN: randomUUID() }; }
function guestCall(f, env, campaign, body = { batch: 10, slot: 0 }, extra = {}) {
  return runMitrifyGuestTest({ body, token: env.MITRIFY_GUEST_TEST_TOKEN, signal: f.signal, db: campaign.db, ...extra }, env, () => {});
}

test('guest campaign is default-off, denies invalid tokens and needs shared admission', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  for (const token of [undefined, '', randomUUID(), 'x'.repeat(513)]) {
    assert.equal(mitrifyGuestTestTokenValid(token, env), false);
    await assert.rejects(guestCall(f, env, c, undefined, { token }), { code: 'MITRIFY_GUEST_TEST_FORBIDDEN' });
  }
  await assert.rejects(guestCall(f, { ...env, MITRIFY_GUEST_TEST_ENABLED: undefined }, c), { code: 'MITRIFY_GUEST_TEST_FORBIDDEN' });
  await assert.rejects(guestCall(f, { ...env, AI_BACKEND: 'direct' }, c), { code: 'MITRIFY_GUEST_TEST_UNAVAILABLE' });
  await assert.rejects(guestCall(f, env, c, undefined, { db: null }), { code: 'MITRIFY_GUEST_TEST_UNAVAILABLE' });
  assert.equal(f.requests.length, 0); assert.equal(c.claims.size, 0);
});

test('guest campaign rejects arbitrary content, parameters and invalid slot ranges', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  for (const body of [null, [], {}, { batch: 10, slot: 10 }, { batch: 1000, slot: -1 }, { batch: 10, slot: 0.5 },
    { batch: 1110, slot: 0 }, { batch: '10', slot: 0 }, { batch: 10, slot: 0, message: 'untrusted' }]) {
    await assert.rejects(guestCall(f, env, c, body), { code: 'MITRIFY_GUEST_TEST_INVALID_SLOT' });
  }
  assert.equal(f.requests.length, 0); assert.equal(c.claims.size, 0);
});

test('guest admission binds inclusive cap, exact gateway configuration, token and expiry', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f);
  for (const patch of [{ enabled: false }, { expiresAtMs: Date.now() - 1 }, { createdAtMs: Date.now() + 99_999 },
    { expiresAtMs: Date.now() + 7_200_000 }, { maxTotalUsd: 11 }, { maxTotalUsd: NaN }, { maxTotalUsd: 0 },
    { includesAllCharges: false }, { hardCapConfirmed: false }, { credentialFingerprint: 'wrong' },
    { baseURL: 'https://invalid.example/v1' }, { model: 'wrong' }, { tokenFingerprint: 'wrong' }]) {
    const c = guestCampaign(env); Object.assign(c.record, patch);
    await assert.rejects(guestCall(f, env, c), { code: 'MITRIFY_GUEST_TEST_UNAVAILABLE' });
    assert.equal(c.claims.size, 0);
  }
  assert.equal(f.requests.length, 0);
});

test('guest shared slots allow only one dispatch under concurrent replay from separate callers', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => guestCall(f, { ...env }, c)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'MITRIFY_GUEST_TEST_REPLAY'));
  assert.equal(c.claims.size, 1); assert.equal(f.requests.length, 1);
});

test('guest 10/100/1000 barrier-start loopback batches use exactly 1110 immutable slots', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  for (const batch of [10, 100, 1000]) {
    let release; const barrier = new Promise(resolve => { release = resolve; });
    const calls = Array.from({ length: batch }, (_, slot) => barrier.then(() => guestCall(f, env, c, { batch, slot })));
    release(); const results = await Promise.all(calls);
    assert.ok(results.every(result => result.status === 200));
  }
  assert.equal(f.requests.length, 1110); assert.equal(c.claims.size, 1110);
  assert.ok(f.requests.every(r => JSON.stringify(r.body.messages) === JSON.stringify([{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }])));
  await assert.rejects(guestCall(f, env, c, { batch: 1000, slot: 999 }), { code: 'MITRIFY_GUEST_TEST_REPLAY' });
});

test('guest failed dispatch is not refundable and transport retry consumes only one slot', async t => {
  let attempts = 0;
  const f = await fixture(t, (_req, res) => { if (++attempts === 1) { res.writeHead(429, { 'Retry-After': '0' }); res.end('{}'); } else reply(res); });
  const env = guestEnv(f); const c = guestCampaign(env);
  assert.equal((await guestCall(f, env, c)).status, 200); assert.equal(attempts, 2); assert.equal(c.claims.size, 1);
  await assert.rejects(guestCall(f, env, c), { code: 'MITRIFY_GUEST_TEST_REPLAY' });
  const failed = await fixture(t, (_req, res) => { res.writeHead(400); res.end('{}'); });
  const failedEnv = guestEnv(failed); const fc = guestCampaign(failedEnv);
  await assert.rejects(guestCall(failed, failedEnv, fc)); assert.equal(fc.claims.size, 1);
  await assert.rejects(guestCall(failed, failedEnv, fc), { code: 'MITRIFY_GUEST_TEST_REPLAY' });
});

test('guest cancellation while admission is pending never dispatches after late completion', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  let resolve; const gate = new Promise(r => { resolve = r; });
  const controller = new AbortController();
  const call = guestCall(f, env, c, undefined, { signal: controller.signal,
    db: { ...c.db, runTransaction: async fn => { await gate; return c.db.runTransaction(fn); } } });
  controller.abort(); await assert.rejects(call); resolve();
  await new Promise(r => setImmediate(r)); assert.equal(f.requests.length, 0); assert.equal(c.claims.size, 0);
});

test('guest shared store outage fails closed and does not expose its error', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const env = guestEnv(f); const c = guestCampaign(env);
  await assert.rejects(guestCall(f, env, c, undefined, { db: { ...c.db, runTransaction: async () => { throw new Error('offline'); } } }));
  assert.equal(f.requests.length, 0);
});

test('guest runner starts three concurrent batches without login and prints metadata only', async t => {
  const { runGuestLoadTest } = await import('../mitrify-guest-load.mjs');
  const token = randomUUID(); const seen = []; let active = 0; let peak = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['x-mitrify-test-token'], token);
    assert.equal(req.url, '/api/v1/chat/mitrify-guest-test');
    let data = ''; req.on('data', chunk => { data += chunk; });
    req.on('end', () => { seen.push(JSON.parse(data)); active++; peak = Math.max(peak, active);
      setTimeout(() => { active--; res.setHeader('Content-Type', 'application/json'); res.end('{"completed":true}'); }, 5); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const printed = [];
  const result = await runGuestLoadTest({ target: `http://127.0.0.1:${server.address().port}`, token }, line => printed.push(line));
  assert.deepEqual(result.map(r => [r.batch, r.completed, r.peakClientPending]), [[10, 10, 10], [100, 100, 100], [1000, 1000, 1000]]);
  assert.equal(seen.length, 1110); assert.ok(peak > 1); assert.equal(JSON.stringify(printed).includes(token), false);
  for (const [index, batch] of [10, 100, 1000].entries()) {
    const start = [0, 10, 110][index]; assert.ok(seen.slice(start, start + batch).every(body => body.batch === batch && Object.keys(body).length === 2));
  }
});


function approvedChain(f, body = input) {
  const env = { ...f.env, MITRIFY_CHAIN_ENABLED: '1' };
  const binding = mitrifyChainBinding('verified-user', body, env);
  const docs = new Map(); let serial = Promise.resolve(); let held = 0; let released = 0;
  const path = `mitrify_chain_approvals/${binding.id}`;
  docs.set(path, { kind: 'mitrify-exact-public-approval-v1', uid: 'verified-user', payloadDigest: binding.payloadDigest,
    gateway: binding.gateway, state: 'approved', reviewedAtMs: Date.now() - 100, expiresAtMs: Date.now() + 30000,
    publicReview: { entirePayloadReviewed: true, containsSensitiveData: false, reviewRef: 'synthetic-public-review' },
    supplierContract: { currency: 'USD', hardCeilingEnforced: true, includesInternalRetriesFailoversAndFees: true, evidenceRef: 'synthetic-contract-not-live', perHttpRequestCeilingNanoUsd: 100 } });
  const db = { doc: path => ({ path }), runTransaction: fn => {
    const p = serial.then(() => fn({ get: async ref => ({ data: () => structuredClone(docs.get(ref.path)) }), update: (ref, patch) => docs.set(ref.path, { ...docs.get(ref.path), ...patch }) }));
    serial = p.catch(() => {}); return p;
  } };
  const options = { db, uid: 'verified-user', requestId: randomUUID(), body, privateTurn: false, healthTurn: false, signal: f.signal,
    reserve: async maximum => { held += maximum; return { releaseUndispatched: async () => { released++; } }; } };
  return { env, docs, path, options, get held() { return held; }, get released() { return released; }, run: overrides => runApprovedMitrifyChain({ ...options, ...overrides }, env, x => f.logs.push(x)) };
}

test('exact reviewed main-chain payload dispatches once with a four-attempt monetary hold', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  assert.deepEqual(await a.run(), { kind: 'response', content: 'Hello', model: 'mitrify/auto-cheap' });
  assert.equal(a.held, 400); assert.equal(a.released, 0);
  assert.deepEqual(f.requests[0].body, { ...input, model: 'mitrify/auto-cheap' });
  assert.equal(a.docs.get(a.path).attemptsStarted, 1);
  assert.equal((await a.run()).kind, 'skipped'); assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify(f.logs).includes(f.key)); assert.ok(!JSON.stringify(f.logs).includes('Be brief.'));
});

test('two competing claims cannot spend the same public approval twice', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  const results = await Promise.all([a.run({ requestId: 'one' }), a.run({ requestId: 'two' })]);
  assert.equal(results.filter(r => r.kind === 'response').length, 1); assert.equal(f.requests.length, 1); assert.equal(a.held, 400);
});

test('private, health and unsupported requests are not downgraded by an approval', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  for (const overrides of [{ privateTurn: true }, { healthTurn: true }, { body: { ...input, tools: [] } }, { body: { ...input, response_format: { type: 'json_object' } } }]) assert.equal((await a.run(overrides)).kind, 'skipped');
  assert.equal(a.held, 0); assert.equal(f.requests.length, 0);
});

test('changed payload, identity, credential, alias and missing ceiling cannot reuse approval', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  assert.equal((await a.run({ body: { ...input, temperature: 0.9 } })).kind, 'skipped');
  assert.equal((await a.run({ uid: 'other' })).kind, 'skipped');
  for (const env of [{ ...a.env, MITRIFY_API_KEY: randomUUID() }, { ...a.env, MITRIFY_MODEL: 'different-policy' }]) assert.equal((await runApprovedMitrifyChain(a.options, env, () => {})).kind, 'skipped');
  a.docs.get(a.path).supplierContract.hardCeilingEnforced = false;
  assert.equal((await a.run()).kind, 'skipped'); assert.equal(f.requests.length, 0); assert.equal(a.held, 0);
});

test('shared budget denial makes no HTTP request and consumes no supplier cost', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  assert.deepEqual(await a.run({ reserve: async () => null }), { kind: 'skipped', reason: 'mitrify-budget' });
  assert.equal(f.requests.length, 0);
});

test('cancel during delayed monetary admission returns promptly and releases its eventual unused hold once', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f); const controller = new AbortController();
  let resolveHold; let releaseCount = 0; let started; const reserved = new Promise(r => { started = r; });
  const task = a.run({ signal: controller.signal, reserve: async () => { started(); return new Promise(r => { resolveHold = r; }); } });
  await reserved; controller.abort(); await assert.rejects(task, { code: 'MITRIFY_CANCELLED' });
  resolveHold({ releaseUndispatched: async () => { releaseCount++; } }); await new Promise(r => setImmediate(r));
  assert.equal(releaseCount, 1); assert.equal(f.requests.length, 0);
});

test('admitted stream forwards before completion and preserves order', async t => {
  let finish; const pending = new Promise(r => { finish = r; });
  const f = await fixture(t, async (_req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(chunk('one')); await pending; res.end(chunk('two') + 'data: [DONE]\n\n'); });
  const a = approvedChain(f, { ...input, stream: true }); const chunks = []; let first; const seen = new Promise(r => { first = r; });
  const task = a.run({ onChunk: text => { chunks.push(text); first(); } }); await seen;
  assert.deepEqual(chunks, ['one']); finish(); assert.equal((await task).content, 'onetwo'); assert.deepEqual(chunks, ['one', 'two']);
  assert.deepEqual(f.requests[0].body.stream_options, { include_usage: true });
});

test('admitted partial stream failure is terminal and keeps the maximum hold', async t => {
  const f = await fixture(t, (_req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.end(chunk('partial')); });
  const a = approvedChain(f, { ...input, stream: true }); const chunks = [];
  await assert.rejects(a.run({ onChunk: t => chunks.push(t) }), { code: 'MITRIFY_INCOMPLETE_STREAM', partial: true });
  assert.deepEqual(chunks, ['partial']); assert.equal(f.requests.length, 1); assert.equal(a.released, 0);
});

test('remaining physical-attempt budget bounds HTTP retries and reserved liability', async t => {
  const f = await fixture(t, (_req, res, n) => { if (n === 1) { res.statusCode = 503; res.end(); } else reply(res); });
  const a = approvedChain(f); assert.equal((await a.run({ maxHttpAttempts: 2 })).kind, 'response');
  assert.equal(a.held, 200); assert.equal(f.requests.length, 2); assert.equal(a.docs.get(a.path).attemptsStarted, 2);
});

test('approval revocation during backoff prevents a second HTTP attempt without refunding uncertainty', async t => {
  let a; const f = await fixture(t, (_req, res) => { a.docs.get(a.path).state = 'revoked'; res.statusCode = 503; res.end(); });
  a = approvedChain(f); await assert.rejects(a.run(), { code: 'MITRIFY_APPROVAL_REVOKED' });
  assert.equal(f.requests.length, 1); assert.equal(a.released, 0);
});

test('revoked configuration prevents retry and retains the original liability', async t => {
  let a; const f = await fixture(t, (_req, res) => { a.env.MITRIFY_CHAIN_ENABLED = '0'; res.statusCode = 503; res.end(); });
  a = approvedChain(f); await assert.rejects(a.run(), { code: 'MITRIFY_APPROVAL_REVOKED' });
  assert.equal(f.requests.length, 1); assert.equal(a.released, 0);
});

test('shared control revocation before dispatch releases an unused hold', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  await assert.rejects(a.run({ revalidate: async () => { throw new MitrifyError('MITRIFY_APPROVAL_REVOKED'); } }), { code: 'MITRIFY_APPROVAL_REVOKED' });
  assert.equal(f.requests.length, 0); assert.equal(a.released, 1);
});

test('admission database errors cannot disclose supplier credentials', async t => {
  const f = await fixture(t, (_req, res) => reply(res)); const a = approvedChain(f);
  a.options.db.runTransaction = async () => { throw new Error(f.key); };
  await assert.rejects(a.run(), error => error.code === 'MITRIFY_ADMISSION_FAILED' && !String(error).includes(f.key));
  assert.equal(f.requests.length, 0);
});

for (const [reason, completion] of [['stop', 'complete'], ['length', 'length'], ['content_filter', 'filtered'], [undefined, 'unconfirmed'], [null, 'unconfirmed'], ['unexpected-provider-reason', 'unconfirmed']]) {
  test(`separate bot preserves longer reply and classifies finish reason ${String(reason)} without continuation`, async t => {
    const answer = 'A public explanation about the solar system. '.repeat(100) + 'Final sentence.';
    const f = await fixture(t, (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: answer }, ...(reason === undefined ? {} : { finish_reason: reason }) }] }));
    });
    const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
    const result = await runMitrifyPublicBot({ body: { message: 'Explain the solar system.', publicContentConfirmed: true },
      identify: async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true }), signal: f.signal }, env, () => {});
    assert.deepEqual(result, { reply: answer, completion });
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].body.max_tokens, 2048);
    assert.equal(f.requests[0].body.stream, false);
    assert.deepEqual(f.requests[0].body.messages, [{ role: 'user', content: 'Explain the solar system.' }]);
  });
}

test('separate bot deadline aborts an unfinished response body without returning partial JSON or replaying', async t => {
  let closed; const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const f = await fixture(t, (_req, res) => {
    res.on('close', closed);
    res.setHeader('Content-Type', 'application/json'); res.write('{"choices":[{"message":{"content":"unfinished');
  });
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  await assert.rejects(runMitrifyPublicBot({ body: { questionId: 'rainbow' },
    identify: async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true }),
    signal: AbortSignal.timeout(250) }, env, () => {}), { code: 'MITRIFY_CANCELLED' });
  await upstreamClosed; assert.equal(f.requests.length, 1);
});

test('separate bot rejects a broken non-streaming response rather than presenting it as complete', async t => {
  const f = await fixture(t, (_req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.end('{"choices":[{"message":{"content":"cut');
  });
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid' };
  await assert.rejects(runMitrifyPublicBot({ body: { questionId: 'rainbow' },
    identify: async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true }),
    signal: f.signal }, env, () => {}), { code: 'MITRIFY_INVALID_RESPONSE' });
  assert.equal(f.requests.length, 1);
});

test('separate bot output allowance is server configured and finite; browser cannot increase it', async t => {
  const f = await fixture(t, (_req, res) => reply(res));
  const env = { ...f.env, AI_BACKEND: 'mitrify', MITRIFY_CHAT_ACCOUNT_EMAIL: 'tester@example.invalid', MITRIFY_BOT_MAX_OUTPUT_TOKENS: '8192' };
  const options = { body: { message: 'Explain rainbows.', publicContentConfirmed: true },
    identify: async () => ({ uid: 'tester', email: env.MITRIFY_CHAT_ACCOUNT_EMAIL, emailVerified: true }), signal: f.signal };
  assert.equal((await runMitrifyPublicBot(options, env, () => {})).completion, 'complete');
  assert.equal(f.requests[0].body.max_tokens, 8192);
  for (const value of ['Infinity', 'unlimited', '0', '-1', '32769', '2.5', 'NaN']) {
    await assert.rejects(runMitrifyPublicBot(options, { ...env, MITRIFY_BOT_MAX_OUTPUT_TOKENS: value }, () => {}), { code: 'MITRIFY_CONFIGURATION' });
  }
  await assert.rejects(runMitrifyPublicBot({ ...options, body: { ...options.body, max_tokens: 32768 } }, env, () => {}), { code: 'MITRIFY_BOT_REVIEW_REQUIRED' });
  assert.equal(f.requests.length, 1);
});

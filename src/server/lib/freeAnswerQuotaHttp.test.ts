import { afterEach, expect, it, vi } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { gunzipSync } from 'node:zlib';
import { responseCompression } from './responseCompression';
import { setServerDb } from './serverDb';
import { FreeAnswerQuotaStore } from './freeAnswerQuotaStore';
import { freeAnswerSignal, markFreeAnswer, withFreeAnswerQuota } from './freeAnswerQuota';
import { chatAvailabilityMessage } from './chatAvailabilityMessage';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
/** Two independent HTTP entry points share only this transactional persistence boundary. */
function database() {
  const docs = new Map<string, unknown>();
  let serial = Promise.resolve();
  return {
    doc: (path: string) => ({ path }),
    runTransaction: (run: (tx: any) => Promise<unknown>) => {
      const result = serial.then(async () => {
        const writes = new Map<string, unknown>();
        const value = await run({
          get: async ({ path }: { path: string }) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
          set: ({ path }: { path: string }, data: unknown) => writes.set(path, structuredClone(data)),
        });
        for (const [key, value] of writes) docs.set(key, value);
        return value;
      });
      serial = result.then(() => {}, () => {});
      return result;
    },
  };
}
const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  setServerDb(null);
});
async function listen(run?: (req: Request, res: Response) => Promise<void>, uid: string | null = null) {
  let dispatched = 0;
  const app = express();
  app.use(express.json());
  app.use(responseCompression());
  app.post('/answer', async (req, res) => withFreeAnswerQuota(req, res, async () => {
    dispatched++;
    if (run) return run(req, res);
    markFreeAnswer(req);
    res.json({ reply: `Synthetic answer to ${String(req.body.message)}` });
  }, { uid, surface: 'chat' }));
  const server = await new Promise<http.Server>(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  servers.push(server);
  return { port: (server.address() as { port: number }).port, dispatched: () => dispatched };
}
function question(port: number, message: string, id = randomUUID(), input: Record<string, unknown> = {}) {
  return new Promise<{ status: number; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/answer', method: 'POST', headers: {
      'content-type': 'application/json', 'accept-encoding': 'gzip', 'x-nb-guest': 'synthetic-settlement-http-guest', 'x-nb-answer-request': id,
    } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const body = res.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
        resolve({ status: res.statusCode!, body: JSON.parse(body), headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify({ message, ...input }));
  });
}
it('publishes JSON completion only after durable settlement, then admits four immediate distinct guest turns', async () => {
  const db = database();
  setServerDb(db as never);
  const entered = deferred();
  const release = deferred();
  const settle = FreeAnswerQuotaStore.prototype.settle;
  vi.spyOn(FreeAnswerQuotaStore.prototype, 'settle').mockImplementationOnce(async function (...args) {
    entered.resolve();
    await release.promise;
    return settle.apply(this, args);
  });
  const firstServer = await listen();
  const otherServer = await listen();
  let firstCompleted = false;
  const first = question(firstServer.port, 'Name a three-sided polygon.').then(result => { firstCompleted = true; return result; });
  try {
    await entered.promise;
    // Genuine overlap must remain blocked: the durable transaction has not committed.
    const overlap = await question(otherServer.port, 'This concurrent request must not dispatch.');
    expect(overlap.status).toBe(429);
    expect(overlap.body.code).toBe('FREE_ANSWER_BUSY');
    expect(otherServer.dispatched()).toBe(0);
    expect(firstCompleted, 'HTTP completion must not precede durable quota settlement').toBe(false);
    release.resolve();
    expect((await first).status).toBe(200);
    for (const message of ['How many sides does a square have?', 'Explain a five-sided polygon.', 'Count the sides of a hexagon.']) {
      expect((await question(otherServer.port, message)).status).toBe(200);
    }
    expect(firstServer.dispatched() + otherServer.dispatched()).toBe(4);
    expect(await new FreeAnswerQuotaStore(db as never).status({ key: 'guest-device:synthetic-settlement-http-guest', limit: 10, ipKey: 'ip:127.0.0.1', guest: true }))
      .toMatchObject({ used: 4, reserved: 0, remaining: 6, inProgress: false });
    for (let index = 0; index < 6; index++) expect((await question(otherServer.port, `Name polygon number ${index}.`)).status).toBe(200);
    expect((await question(otherServer.port, 'This exceeds ten guest credits.')).body.code).toBe('FREE_ANSWER_DAILY_LIMIT');
  } finally {
    release.resolve();
    await first;
  }
});


it('retains the signed-in 50 daily limit with immediate sequential responses', async () => {
  setServerDb(database() as never);
  const server = await listen(undefined, 'synthetic-signed-in-settlement-user');
  for (let index = 0; index < 50; index++) expect((await question(server.port, `Explain synthetic topic ${index}.`)).status).toBe(200);
  expect((await question(server.port, 'The fifty-first question.')).body.code).toBe('FREE_ANSWER_DAILY_LIMIT');
  expect(server.dispatched()).toBe(50);
});
it('waits for a known no-answer refund before publishing failure and admits the immediate next turn', async () => {
  const db = database(); setServerDb(db as never);
  const entered = deferred(); const release = deferred();
  const actual = FreeAnswerQuotaStore.prototype.settle;
  const settle = vi.spyOn(FreeAnswerQuotaStore.prototype, 'settle').mockImplementationOnce(async function (...args) {
    entered.resolve(); await release.promise; return actual.apply(this, args);
  });
  const server = await listen(async (req, res) => {
    if (req.body.message === 'failure') { res.status(503).json({ error: 'Synthetic no-output provider failure.' }); return; }
    markFreeAnswer(req); res.json({ reply: 'The next fresh answer.' });
  });
  let completed = false; const failed = question(server.port, 'failure').then(r => { completed = true; return r; });
  try {
    await entered.promise;
    expect((await question(server.port, 'overlap')).body.code).toBe('FREE_ANSWER_BUSY');
    expect(completed).toBe(false); release.resolve();
    expect((await failed).status).toBe(503);
    expect((await question(server.port, 'success')).status).toBe(200);
    expect(settle.mock.calls.map(call => call[1])).toEqual(['provider-failed', 'answered']);
    expect(await new FreeAnswerQuotaStore(db as never).status({ key: 'guest-device:synthetic-settlement-http-guest', limit: 10 }))
      .toMatchObject({ used: 1, reserved: 0, inProgress: false });
  } finally { release.resolve(); await failed; }
});
it.each(['false', 'reject'] as const)('fails honestly on %s settlement without releasing the durable owner or replaying', async failure => {
  const db = database(); setServerDb(db as never);
  const settle = vi.spyOn(FreeAnswerQuotaStore.prototype, 'settle');
  if (failure === 'false') settle.mockResolvedValue(false); else settle.mockRejectedValue(new Error('Synthetic storage failure'));
  const server = await listen(async (req, res) => { markFreeAnswer(req); res.json({ reply: 'Large staged answer. '.repeat(500) }); });
  const result = await question(server.port, 'first');
  expect(result.status).toBe(503); expect(result.body.code).toBe('FREE_ANSWER_UNAVAILABLE');
  expect(result.body.reply).not.toContain('Large staged answer.');
  expect(Number(result.headers['content-length'])).toBe(Buffer.byteLength(JSON.stringify(result.body)));
  expect((await question(server.port, 'next')).body.code).toBe('FREE_ANSWER_BUSY');
  expect(server.dispatched()).toBe(1); expect(settle).toHaveBeenCalledOnce();
  expect(await new FreeAnswerQuotaStore(db as never).status({ key: 'guest-device:synthetic-settlement-http-guest', limit: 10 }))
    .toMatchObject({ used: 0, reserved: 1, remaining: 9, inProgress: true });
});
it('publishes a compressed JSON body intact after successful durable completion', async () => {
  setServerDb(database() as never);
  const answer = 'Synthetic content worth compressing. '.repeat(500);
  const server = await listen(async (req, res) => { markFreeAnswer(req); res.json({ reply: answer }); });
  const result = await question(server.port, 'compressed');
  expect(result.status).toBe(200); expect(result.headers['content-encoding']).toBe('gzip'); expect(result.body.reply).toBe(answer);
});
it.each([false, true])('keeps cancellation accounting and does not settle before upstream returns, partial %s', async partial => {
  const db = database(); setServerDb(db as never);
  const closed = deferred(); const release = deferred(); const settled = deferred();
  const actual = FreeAnswerQuotaStore.prototype.settle;
  const settle = vi.spyOn(FreeAnswerQuotaStore.prototype, 'settle').mockImplementation(async function (...args) {
    try { return await actual.apply(this, args); } finally { settled.resolve(); }
  });
  let signal: AbortSignal | undefined;
  const server = await listen(async (req, res) => {
    signal = freeAnswerSignal(req); res.once('close', closed.resolve);
    res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
    if (partial) { markFreeAnswer(req); res.write('data: {"c":"partial answer"}\n\n'); }
    await release.promise;
  });
  const request = http.request({ hostname: '127.0.0.1', port: server.port, path: '/answer', method: 'POST', headers: {
    'content-type': 'application/json', 'x-nb-guest': 'synthetic-settlement-http-guest', 'x-nb-answer-request': randomUUID(),
  } }, response => { response.resume(); request.destroy(); });
  request.on('error', () => {}); request.end(JSON.stringify({ message: 'Cancellation fixture.' }));
  try {
    await closed.promise; expect(signal?.aborted).toBe(true); expect(settle).not.toHaveBeenCalled();
    release.resolve(); await settled.promise;
    expect(settle).toHaveBeenCalledOnce(); expect(settle.mock.calls[0][1]).toBe(partial ? 'answered' : 'uncertain');
    expect(await new FreeAnswerQuotaStore(db as never).status({ key: 'guest-device:synthetic-settlement-http-guest', limit: 10 }))
      .toMatchObject({ used: 1, reserved: 0, remaining: 9, inProgress: false });
  } finally { request.destroy(); release.resolve(); }
});

it('does not execute a completed logical request twice through a second HTTP entry point', async () => {
  const db = database(); setServerDb(db as never);
  const first = await listen(); const second = await listen(); const id = randomUUID();
  expect((await question(first.port, 'One logical question.', id)).status).toBe(200);
  const duplicate = await question(second.port, 'The same request cannot execute again.', id);
  expect(duplicate.status).toBe(429); expect(duplicate.body.code).toBe('FREE_ANSWER_DUPLICATE');
  expect(first.dispatched() + second.dispatched()).toBe(1);
});


it.each(['hi', 'ta'].flatMap(replyLanguage => ['false', 'reject'].map(failure => ({ replyLanguage, failure }))))(
  'localizes unconfirmed JSON settlement in $replyLanguage after $failure without publishing the staged answer', async ({ replyLanguage, failure }) => {
    const db = database(); setServerDb(db as never);
    const settle = vi.spyOn(FreeAnswerQuotaStore.prototype, 'settle');
    if (failure === 'false') settle.mockResolvedValue(false);
    else settle.mockRejectedValue(new Error('Synthetic API provider budget diagnostic'));
    const server = await listen(async (req, res) => { markFreeAnswer(req); res.json({ reply: 'Synthetic answer that must stay staged.' }); });
    const message = 'mujhe ek sawal poochna hai';
    const reply = chatAvailabilityMessage('temporary', { message, replyLanguage });
    const result = await question(server.port, message, randomUUID(), { replyLanguage });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ code: 'FREE_ANSWER_UNAVAILABLE', error: reply, reply });
    expect(JSON.stringify(result.body)).not.toMatch(/API|provider|budget|diagnostic|stay staged|traffic|busy/i);
    expect(settle).toHaveBeenCalledOnce(); expect(settle.mock.calls[0][1]).toBe('answered');
    expect(server.dispatched()).toBe(1);
    expect(await new FreeAnswerQuotaStore(db as never).status({ key: 'guest-device:synthetic-settlement-http-guest', limit: 10 }))
      .toMatchObject({ used: 0, reserved: 1, inProgress: true });
  },
);

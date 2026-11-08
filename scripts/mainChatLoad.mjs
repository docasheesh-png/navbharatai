#!/usr/bin/env node
/** Offline preparation only. No HTTP client, credentials, auth bypass or model dispatch. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const endpoint = '/api/v1/chat/navbharat';
export const stages = [10, 100, 1000, 5000, 1000, 1000, 1000, 1000];
const kinds = ['inventory', 'units', 'ordering', 'code-tracing'];

export function manifest() {
  let sequence = 0;
  return stages.map((size, stage) => Array.from({ length: size }, (_, user) => {
    const id = sequence++, n = id + 17, kind = stage < 4 ? id % 4 : stage - 4;
    // Different operands change the actual problem, not merely a cache-busting nonce.
    const questions = [
      [`A public puzzle depot has ${n} boxes, each with 7 tiles, and removes 13 tiles. How many tiles remain? Return only the integer.`, String(n * 7 - 13)],
      [`A fictional timer runs for ${n} minutes and 23 seconds. How many seconds is that? Return only the integer.`, String(n * 60 + 23)],
      [`Sort these integers in ascending order: ${n + 9}, ${-n}, ${n + 2}. Return only three comma-separated integers.`, `${-n},${n + 2},${n + 9}`],
      [`Without executing tools, trace JavaScript: let x = ${n}; for (let i = 0; i < 3; i++) x = x * 2 + 1; What is x? Return only the integer.`, String(n * 8 + 7)],
    ];
    return { requestId: `request-${id}`, stage, userId: stage < 4 ? `burst-${stage}-${user}` : `conversation-${user}`,
      turn: stage < 4 ? 1 : stage - 3, taskType: kinds[kind], prompt: questions[kind][0], expected: questions[kind][1] };
  }));
}

export function grade(task, answer) {
  return typeof answer === 'string' && answer.length <= 4096 &&
    answer.trim().replace(/\s*,\s*/g, ',') === task.expected;
}
const percentiles = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return Object.fromEntries([50, 95, 99].map(p => [`p${p}`, sorted.length ? sorted[Math.ceil(sorted.length * p / 100) - 1] : null]));
};

/** Injected offline fixture transport. Never use as a production admission mechanism. */
export async function rehearse(transport, { signal, deadlineMs = 60_000 } = {}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) throw Error('Invalid deadline');
  const plan = manifest(), histories = new Map(), records = [], batches = [];
  let stopped = false;
  for (const tasks of plan) {
    if (stopped || signal?.aborted) break;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let pending = 0, peakPending = 0;
    const started = performance.now();
    const jobs = tasks.map(async task => {
      await barrier;
      const launch = performance.now();
      peakPending = Math.max(peakPending, ++pending);
      const history = structuredClone(histories.get(task.userId) ?? []);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let timer, first = null, chunks = '', result, state = 'failed';
      try {
        const cancelled = new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
          if (controller.signal.aborted) reject(Error('cancelled'));
        });
        timer = setTimeout(abort, deadlineMs);
        // Only the public prompt and this user's history enter the request; never expected answers.
        const request = { endpoint, requestId: task.requestId, syntheticUser: task.userId,
          body: { message: task.prompt, history, stream: true }, signal: controller.signal,
          onChunk(text) { if (!controller.signal.aborted && typeof text === 'string' && text) {
            if (first === null) first = performance.now() - launch;
            chunks += text;
            if (chunks.length > 16_384) controller.abort();
          } } };
        result = await Promise.race([cancelled, Promise.resolve().then(() => {
          if (controller.signal.aborted) throw Error('cancelled');
          return transport(request);
        })]);
        state = ['complete', 'partial', 'refused', 'cancelled', 'failed'].includes(result?.outcome) ? result.outcome : 'failed';
        if (state === 'complete' && (!chunks.trim() || result?.httpStatus !== 200)) state = chunks ? 'partial' : 'failed';
      } catch {
        state = controller.signal.aborted ? 'cancelled' : chunks ? 'partial' : 'failed';
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); pending--;
      }
      // Do not silently feed a partial/refused/error response into later conversation turns.
      if (state === 'complete') histories.set(task.userId, [...history, { role: 'user', content: task.prompt }, { role: 'assistant', content: chunks }]);
      const correct = state === 'complete' && grade(task, chunks);
      records.push({ requestId: task.requestId, userId: task.userId, stage: task.stage, turn: task.turn,
        taskType: task.taskType, outcome: state, correct, httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
        launchMs: launch - started, latencyMs: performance.now() - launch, ttftMs: first,
        historyMessages: history.length });
      if (state !== 'complete' || !correct) stopped = true;
    });
    release();
    await Promise.all(jobs); // Global barrier: never overlap successive stages/rounds.
    const rows = records.filter(row => row.stage === tasks[0].stage);
    const counts = Object.fromEntries(['complete', 'partial', 'refused', 'cancelled', 'failed'].map(key => [key, rows.filter(row => row.outcome === key).length]));
    batches.push({ stage: tasks[0].stage, requested: tasks.length, clientPeakPending: peakPending,
      launchSpreadMs: Math.max(...rows.map(row => row.launchMs)) - Math.min(...rows.map(row => row.launchMs)),
      outcomes: counts, http429: rows.filter(row => row.httpStatus === 429).length, http503: rows.filter(row => row.httpStatus === 503).length,
      latencyMs: percentiles(rows.map(row => row.latencyMs)), ttftMs: percentiles(rows.map(row => row.ttftMs).filter(x => x !== null)),
      correct: rows.filter(row => row.correct).length,
      admittedConcurrency: null, providerConcurrency: null, actualProviderRequests: null, cacheEvidence: 'unmeasured', costs: null });
  }
  const conversationRows = records.filter(row => row.stage >= 4);
  const usersAllFourCorrect = Array.from({ length: 1000 }, (_, user) => {
    const rows = conversationRows.filter(row => row.userId === `conversation-${user}`);
    return rows.length === 4 && rows.every(row => row.correct);
  }).filter(Boolean).length;
  return { mode: 'offline-scheduler-rehearsal', liveRequests: 0, planned: 10110, attempted: records.length,
    notAttempted: 10110 - records.length, automaticReplays: 0, usersAllFourCorrect,
    accuracyScope: 'Deterministic closed-answer fixtures only; no production accuracy or capacity measured.',
    budget: { authorizedINR: 1000, runtimeEnforcementVerified: false, measuredSpend: null }, batches, records };
}

export async function simulate() {
  const answers = new Map(manifest().flat().map(task => [task.requestId, task.expected]));
  return rehearse(async request => {
    await new Promise(resolve => setImmediate(resolve));
    request.onChunk(answers.get(request.requestId));
    return { outcome: 'complete', httpStatus: 200 };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, output, ...extra] = process.argv.slice(2);
  if (!['manifest', 'simulate'].includes(mode) || !output || extra.length) throw Error('Offline only: mainChatLoad.mjs manifest|simulate OUTPUT.json');
  const tasks = manifest();
  const value = mode === 'manifest' ? { endpoint, mode: 'offline-plan', stages, total: 10110, authorizedINR: 1000, tasks,
    sha256: createHash('sha256').update(JSON.stringify(tasks)).digest('hex') } : await simulate();
  writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
  console.log(JSON.stringify({ mode, output, liveRequests: 0 }));
}

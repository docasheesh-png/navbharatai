#!/usr/bin/env node
// Run explicitly with Node 22.23.4: node --experimental-strip-types scripts/mitrify-smoke.mjs
// This is the only live diagnostic caller. It is never run by CI or server boot.
import { createMitrifyClient } from '../src/server/lib/mitrify.ts';

const key = process.env.MITRIFY_API_KEY?.trim();
if (!key) {
  console.error('MITRIFY_API_KEY is not set.');
  process.exitCode = 1;
} else {
  let metadata = {};
  const client = createMitrifyClient(process.env, record => {
    if ('X-Mitrify-Request-Id' in record) metadata = record;
  });
  const clean = text => text.split(key).join('[REDACTED]').slice(0, 100);
  async function run(operation) {
    metadata = {};
    try { await operation(); }
    catch (error) {
      console.log(JSON.stringify({ status: error.status || metadata.status || 0,
        headers: Object.fromEntries(Object.entries(metadata).filter(([name]) => name.startsWith('X-Mitrify-'))) }));
      process.exitCode = 1;
      return false;
    }
    return true;
  }
  const modelsOk = await run(async () => {
    console.log(JSON.stringify(await client.models(AbortSignal.timeout(30_000))));
  });
  // Do not spend on inference when /models still returns HTML or an authentication error.
  if (modelsOk) {
    const request = { messages: [{ role: 'user', content: 'Reply with Hello.' }], max_tokens: 12 };
    const chatOk = await run(async () => {
      const result = await client.chat(request, { signal: AbortSignal.timeout(30_000) });
      console.log(JSON.stringify({ status: result.status, headers: result.headers, reply: clean(result.data.choices[0].message.content) }));
    });
    if (chatOk) await run(async () => {
      let firstChunkMs = null; let reply = ''; const start = performance.now();
      const result = await client.chat({ ...request, stream: true }, {
        signal: AbortSignal.timeout(30_000),
        onChunk: bytes => {
          if (firstChunkMs === null) firstChunkMs = Math.round(performance.now() - start);
          const event = new TextDecoder().decode(bytes);
          const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (payload && payload !== '[DONE]' && reply.length < 100 + key.length) {
            reply += JSON.parse(payload).choices?.[0]?.delta?.content ?? '';
          }
        },
      });
      console.log(JSON.stringify({ status: result.status, headers: result.headers, firstChunkMs, reply: clean(reply) }));
    });
  }
}

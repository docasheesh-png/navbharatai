#!/usr/bin/env node
// Standalone Nova Sonic connection check — run this with your AWS keys to confirm the
// Bedrock bidirectional stream opens and the model is reachable, BEFORE testing the full
// voice UI. It sends a short burst of silence as "audio" and prints whatever events come
// back (or the exact auth/access error), so you can isolate a credentials/region/model
// problem from a browser-audio problem.
//
// Usage:
//   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
//   node scripts/sonic-test.mjs
//
// Expected on success: a "✅ stream opened" line and one or more event lines, then "done".
// Expected on a creds/region/model problem: a clear ❌ error naming the cause.

import { randomUUID } from 'crypto';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION || 'us-east-1';
const modelId = process.env.SONIC_MODEL_ID || 'amazon.nova-2-sonic-v1:0';

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('❌ Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY first.');
  process.exit(1);
}

const promptName = randomUUID();
const audioName = randomUUID();
const sysName = randomUUID();
const enc = (event) => ({ chunk: { bytes: new TextEncoder().encode(JSON.stringify({ event })) } });

async function* input() {
  yield enc({ sessionStart: { inferenceConfiguration: { maxTokens: 512, topP: 0.9, temperature: 0.7 } } });
  yield enc({ promptStart: { promptName, textOutputConfiguration: { mediaType: 'text/plain' }, audioOutputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId: 'matthew', encoding: 'base64', audioType: 'SPEECH' } } });
  yield enc({ contentStart: { promptName, contentName: sysName, type: 'TEXT', interactive: true, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } });
  yield enc({ textInput: { promptName, contentName: sysName, content: 'You are a test. Say hello.' } });
  yield enc({ contentEnd: { promptName, contentName: sysName } });
  yield enc({ contentStart: { promptName, contentName: audioName, type: 'AUDIO', interactive: true, role: 'USER', audioInputConfiguration: { mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1, audioType: 'SPEECH', encoding: 'base64' } } });
  // ~0.5s of silence (16000 * 0.5 samples * 2 bytes) as base64.
  const silence = Buffer.alloc(16000).toString('base64');
  yield enc({ audioInput: { promptName, contentName: audioName, content: silence } });
  yield enc({ contentEnd: { promptName, contentName: audioName } });
  yield enc({ promptEnd: { promptName } });
  yield enc({ sessionEnd: {} });
}

const client = new BedrockRuntimeClient({ region });

try {
  console.log(`→ connecting to Nova Sonic (${modelId}) in ${region}…`);
  const res = await client.send(new InvokeModelWithBidirectionalStreamCommand({ modelId, body: input() }));
  console.log('✅ stream opened');
  let events = 0;
  for await (const item of res.body) {
    const bytes = item.chunk?.bytes;
    if (!bytes) continue;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      const key = parsed.event ? Object.keys(parsed.event)[0] : '?';
      events++;
      if (key === 'audioOutput') console.log('  event: audioOutput (voice bytes received)');
      else if (key === 'textOutput') console.log('  event: textOutput →', parsed.event.textOutput?.content);
      else console.log('  event:', key);
    } catch { /* non-JSON frame */ }
  }
  console.log(`done — received ${events} event(s). ${events > 0 ? '✅ Nova Sonic is reachable.' : '⚠️ opened but no events (check model access).'}`);
} catch (err) {
  console.error('❌ Sonic connection failed:', err?.name || '', err?.message || err);
  process.exit(1);
}

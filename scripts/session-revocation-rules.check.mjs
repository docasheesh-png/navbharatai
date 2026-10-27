#!/usr/bin/env node
/** Credential-free executable rules matrix. ONLY an isolated loopback Firestore emulator. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const PROJECT = process.argv.includes('--project') ? process.argv[process.argv.indexOf('--project') + 1] : 'demo-navbharatai-session-revocation';
if (!['demo-navbharatai-session-revocation', 'demo-navbharatai-phase2'].includes(PROJECT)) throw new Error('Only the fixed synthetic test projects are allowed');
const endpoint = process.argv[process.argv.indexOf('--emulator') + 1];
if (!process.argv.includes('--emulator') || !/^127\.0\.0\.1:\d+$/.test(endpoint ?? '')) throw new Error('An explicit loopback --emulator is required');
const base = `http://${endpoint}`;
const docs = `${base}/v1/projects/${PROJECT}/databases/(default)/documents`;
const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const enc = value => typeof value === 'string' ? { stringValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { booleanValue: value };
const fields = data => ({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) });
const jwt = (uid, authTime, extras = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, auth_time: authTime, email_verified: true, firebase: { sign_in_provider: 'password' }, ...extras })}.`;
};
let checks = 0;
async function request(path, token, expected, method = 'GET', body) {
  const res = await fetch(`${docs}/${path}`, { method, headers: headers(token), ...(body ? { body: JSON.stringify(fields(body)) } : {}), signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  assert.equal(res.status, expected, `${method} ${path}: ${res.status} ${text.slice(0,250)}`);
  checks++;
}
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const rulesResponse = await fetch(`${base}/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', headers: headers('owner'), body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }), signal: AbortSignal.timeout(15_000) });
const result = await rulesResponse.json();
assert.equal(rulesResponse.ok, true, JSON.stringify(result));
assert.equal((result.issues ?? []).filter(x => x.severity === 'ERROR').length, 0, JSON.stringify(result));
const seed = {
  'users/alice': { uid: 'alice' },
  'user_token_wallets/alice': { balance: 1 },
  'user_workspaces/alice': { userId: 'alice' },
  'payment_transactions/payment-alice': { userId: 'alice' },
  'chat_sessions/chat-alice': { userId: 'alice' },
  'chat_agent_history/history-alice': { userId: 'alice' },
  'reports/report-alice': { userId: 'alice' },
  'collab_rooms/alice-room': { createdBy: 'alice' },
  'collab_rooms/alice-room/content/code': { code: 'synthetic' },
  'collab_rooms/alice-room/members/alice': { status: 'approved' },
  'collab_rooms/bob-room': { createdBy: 'bob' },
  'collab_rooms/bob-room/content/code': { code: 'synthetic' },
  'collab_rooms/bob-room/members/alice': { status: 'approved' },
  'users/bob': { uid: 'bob' },
};
for (const [path, data] of Object.entries(seed)) await request(path, 'owner', 200, 'PATCH', data);
const old = jwt('alice', 1000), fresh = jwt('alice', 1002), equal = jwt('alice', 1001), bob = jwt('bob', 1);
const ownPaths = Object.keys(seed).filter(path => path !== 'users/bob');
for (const path of ownPaths) await request(path, old, 200);
await request('session_revocations/alice', 'owner', 200, 'PATCH', { revokeTime: 0, window: 0, count: 1 });
await request('users/alice', jwt('alice', 1000, { firebase: { sign_in_provider: 'custom' } }), 200);
await request('session_revocations/alice', 'owner', 200, 'PATCH', { revokeTime: 1001, window: 0, count: 1 });
for (const path of ownPaths) {
  await request(path, old, 403);
  await request(path, fresh, 200);
}
await request('users/alice', equal, 200); // EXACT installed Admin SDK equality boundary
await request('users/bob', bob, 200);
await request('users/alice', bob, 403); // ownership is not loosened
for (const token of [old, fresh]) {
  await request('session_revocations/alice', token, 403);
  await request('session_revocations/alice', token, 403, 'PATCH', { revokeTime: 0 });
}
await request('chat_sessions/new-chat', old, 403, 'PATCH', { userId: 'alice' });
await request('chat_sessions/new-chat', fresh, 200, 'PATCH', { userId: 'alice' });
await request('collab_rooms/alice-room/content/code', old, 403, 'PATCH', { code: 'denied' });
await request('collab_rooms/alice-room/content/code', fresh, 200, 'PATCH', { code: 'allowed' });
await request('collab_rooms/bob-room/content/code', old, 403, 'PATCH', { code: 'denied' });
await request('collab_rooms/bob-room/content/code', fresh, 200, 'PATCH', { code: 'allowed' });
await request('collab_rooms/bob-room/members/alice', old, 403, 'DELETE');
await request('collab_rooms/bob-room/members/alice', fresh, 200, 'DELETE');
for (const claims of [
  { firebase: { sign_in_provider: 'custom' } },
  { firebase: { sign_in_provider: 'custom' }, session_auth_time: 999 },
]) await request('users/alice', jwt('alice', 2000, claims), 403);
await request('users/alice', jwt('alice', 2000, { firebase: { sign_in_provider: 'custom' }, session_auth_time: 1002 }), 200);
for (const corrupt of [-1, 'yesterday']) {
  await request('session_revocations/alice', 'owner', 200, 'PATCH', { revokeTime: corrupt });
  await request('users/alice', fresh, 403);
}
console.log(`Session revocation rules: ${checks} emulator assertions passed; synthetic accounts only.`);

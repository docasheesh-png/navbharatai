// Dependency-free protocol/security checks: node --experimental-strip-types --test scripts/failedReportOAuth.check.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reportOAuthService, validReportRedirect, normalizeReportScope, hasReportScope, REPORT_RESOURCE, REPORT_SCOPE, REPORT_AUTOPSY_SCOPE } from '../src/server/lib/failedReportOAuth.ts';

// Serial, copy-on-write transactions mimic Firestore's atomic commit/rollback, including reads
// before writes. No production database, client credentials or network access are used.
function fixture() {
  let rows = new Map(); let clock = 1_800_000_000_000; let owner = 'owner'; let queue = Promise.resolve();
  const snapshot = (key, source = rows) => ({ ref: { key }, data: () => source.get(key), exists: source.has(key) });
  const db = {
    collection(name) {
      return {
        doc(id) { return { key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`), delete: async () => { rows.delete(`${name}/${id}`); } }; },
        limit(n) { return { prefix: `${name}/`, n }; },
      };
    },
    runTransaction(fn) {
      const result = queue.then(async () => {
        const copy = new Map(rows); let written = false;
        const result = await fn({
          async get(ref) {
            assert.equal(written, false, 'all transaction reads must precede writes');
            if (ref.key) return snapshot(ref.key, copy);
            const docs = [...copy.keys()].filter(k => k.startsWith(ref.prefix)).slice(0, ref.n).map(k => snapshot(k, copy));
            return { docs, size: docs.length };
          },
          create(ref, data) { written = true; assert.equal(copy.has(ref.key), false); copy.set(ref.key, data); },
          update(ref, data) { written = true; assert.ok(copy.has(ref.key)); copy.set(ref.key, { ...copy.get(ref.key), ...data }); },
          delete(ref) { written = true; copy.delete(ref.key); },
        });
        rows = copy; return result;
      });
      queue = result.catch(() => {}); return result;
    },
  };
  return { service: reportOAuthService(() => db, () => owner, () => clock), rows: () => rows, advance: ms => { clock += ms; }, changeOwner: () => { owner = 'new-owner'; }, revoke: id => rows.delete(`admin_failed_report_access/${id}`) };
}
const verifier = 'a'.repeat(64);
const redirect = 'https://client.example/callback?existing=yes';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const dualScope = `${REPORT_SCOPE} ${REPORT_AUTOPSY_SCOPE}`;
async function start(f, method = 'none', scope = REPORT_SCOPE) {
  const client = await f.service.register({ redirect_uris: [redirect], client_name: 'Test AI', token_endpoint_auth_method: method, scope });
  const auth = { client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-&=value', resource: REPORT_RESOURCE };
  const url = await f.service.authorize(auth);
  const id = new URL(url).searchParams.get('oauth_request');
  return { client, auth, id };
}
async function approved(f, method = 'none', scope = REPORT_SCOPE) {
  const s = await start(f, method, scope); const uri = new URL(await f.service.decide(s.id, true, scope));
  assert.equal(uri.searchParams.get('state'), 'state-&=value'); assert.equal(uri.searchParams.get('existing'), 'yes');
  return { ...s, body: { grant_type: 'authorization_code', client_id: s.client.client_id, redirect_uri: redirect, code_verifier: verifier, code: uri.searchParams.get('code'), resource: REPORT_RESOURCE } };
}
const rejects = (promise, error) => assert.rejects(promise, e => e.error === error);

test('registered client → admin consent → code exchange → read-only token → rotating refresh → revoke', async () => {
  const f = fixture(); const s = await approved(f);
  const t = await f.service.token(s.body);
  assert.equal(t.scope, REPORT_SCOPE); assert.equal(t.expires_in, 3600);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), true);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  assert.equal(await f.service.tokenPrincipal(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), null);
  await rejects(f.service.token(s.body), 'invalid_grant');
  const fresh = await f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token });
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), false);
  assert.equal(await f.service.tokenOk(`Bearer ${fresh.access_token}`), true);
  await rejects(f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token }), 'invalid_grant');
  await f.service.revoke({ client_id: s.client.client_id, token: fresh.refresh_token });
  assert.equal(await f.service.tokenOk(`Bearer ${fresh.access_token}`), false);
  await rejects(f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: fresh.refresh_token }), 'invalid_grant');
});
test('no plaintext client secrets, authorization codes, access tokens or refresh tokens persisted', async () => {
  const f = fixture(); const s = await approved(f, 'client_secret_post');
  s.body.client_secret = s.client.client_secret;
  const t = await f.service.token(s.body); const persisted = JSON.stringify([...f.rows()]);
  for (const secret of [s.client.client_secret, s.body.code, t.access_token, t.refresh_token]) assert.equal(persisted.includes(secret), false);
});
test('confidential clients support post/basic authentication; missing/wrong methods fail', async () => {
  for (const method of ['client_secret_post', 'client_secret_basic']) {
    const f = fixture(); const s = await approved(f, method);
    await rejects(f.service.token(s.body), 'invalid_client');
    const basic = `Basic ${Buffer.from(`${s.client.client_id}:${s.client.client_secret}`).toString('base64')}`;
    if (method === 'client_secret_post') s.body.client_secret = s.client.client_secret;
    const t = await f.service.token(s.body, method === 'client_secret_basic' ? basic : undefined);
    assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), true);
  }
});
test('code is unusable before approval, after denial, and after expiry', async () => {
  const f = fixture(); const s = await start(f);
  assert.equal((await f.service.pending(s.id)).clientName, 'Test AI');
  const denied = new URL(await f.service.decide(s.id, false));
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.has('code'), false);
  await rejects(f.service.pending(s.id), 'invalid_request');
  const a = await approved(f); f.advance(121_000);
  await rejects(f.service.token(a.body), 'invalid_grant');
  const pending = await start(f); f.advance(601_000);
  await rejects(f.service.decide(pending.id, true), 'invalid_request');
});
test('PKCE, exact redirect, resource, client binding and narrow scope cannot be bypassed', async () => {
  const f = fixture(); const s = await approved(f);
  const other = await f.service.register({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
  for (const patch of [{ code_verifier: 'b'.repeat(64) }, { redirect_uri: redirect + '&injected=true' }, { client_id: other.client_id }]) await rejects(f.service.token({ ...s.body, ...patch }), 'invalid_grant');
  await rejects(f.service.token({ ...s.body, resource: 'https://other.example/mcp' }), 'invalid_target');
  for (const patch of [{ code_challenge_method: 'plain' }, { redirect_uri: 'https://attacker.example' }]) await rejects(f.service.authorize({ ...s.auth, ...patch }), 'invalid_request');
  await rejects(f.service.authorize({ ...s.auth, scope: 'admin' }), 'invalid_scope');
  await rejects(f.service.authorize({ ...s.auth, resource: 'https://other.example' }), 'invalid_target');
  assert.equal(await f.service.tokenOk(`Bearer ${(await f.service.token(s.body)).access_token}`), true);
});
test('expired access can refresh, but grant expiry, owner changes and admin revocation block it', async () => {
  for (const action of ['expiry', 'owner', 'revoke']) {
    const f = fixture(); const s = await approved(f); const t = await f.service.token(s.body);
    f.advance(3_600_001); assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), false);
    const fresh = await f.service.token({ client_id: s.client.client_id, grant_type: 'refresh_token', refresh_token: t.refresh_token });
    if (action === 'expiry') f.advance(30 * 86_400_000);
    if (action === 'owner') f.changeOwner();
    if (action === 'revoke') f.revoke(fresh.access_token.split('_')[1].split('.')[0]);
    assert.equal(await f.service.tokenOk(`Bearer ${fresh.access_token}`), false);
    await assert.rejects(f.service.token({ client_id: s.client.client_id, grant_type: 'refresh_token', refresh_token: fresh.refresh_token }));
  }
});
test('concurrent code redemption and refresh rotation each have exactly one winner', async () => {
  const f = fixture(); const s = await approved(f);
  const results = await Promise.allSettled([f.service.token(s.body), f.service.token(s.body)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const t = results.find(x => x.status === 'fulfilled').value;
  const refresh = { client_id: s.client.client_id, grant_type: 'refresh_token', refresh_token: t.refresh_token };
  const refreshResults = await Promise.allSettled([f.service.token(refresh), f.service.token(refresh)]);
  assert.equal(refreshResults.filter(x => x.status === 'fulfilled').length, 1);
});
test('bad redirect schemes, credentials, fragments, malformed fields and unsupported auth are rejected', async () => {
  const f = fixture();
  // A password in the redirect is built at run time rather than written as a literal, so the
  // repository's own secret census (tests/thePlatformKeepsItsSecretsOutOfGit.test.ts) sees no credential.
  const withPassword = new URL('https://client.example/callback'); withPassword.password = 'x';
  for (const uri of ['javascript:alert(1)', 'https://user@client.example/callback', withPassword.href, 'http://client.example/callback', 'https://client.example/#fragment', 'not-a-url']) assert.throws(() => validReportRedirect(uri));
  assert.equal(validReportRedirect('http://127.0.0.1:1234/callback'), 'http://127.0.0.1:1234/callback');
  await rejects(f.service.register({ redirect_uris: [redirect], token_endpoint_auth_method: 'invalid' }), 'invalid_client_metadata');
  await rejects(f.service.register({ redirect_uris: [redirect], scope: 'admin' }), 'invalid_scope');
  assert.equal(await f.service.tokenOk('Bearer nbfo_bad'), false);
  assert.equal(await f.service.tokenOk('Bearer ordinary-user-token'), false);
});
test('registration/request caps are enforced; expired slots can be reused', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) await f.service.register({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
  await rejects(f.service.register({ redirect_uris: [redirect] }), 'temporarily_unavailable');
  f.advance(31 * 86_400_000); assert.ok((await start(f)).id);
  const s = await start(f);
  for (let i = 0; i < 98; i++) await f.service.authorize(s.auth);
  await rejects(f.service.authorize(s.auth), 'temporarily_unavailable');
  f.advance(601_000); assert.ok(await f.service.authorize(s.auth));
});
test('database failure is an error and never grants access', async () => {
  const s = reportOAuthService(() => null, () => 'owner');
  await assert.rejects(s.register({ redirect_uris: [redirect] }), /unavailable/);
  await assert.rejects(s.tokenOk(`Bearer nbfo_${'a'.repeat(64)}.${'b'.repeat(43)}`), /unavailable/);
});

test('autopsy writes require registered capability, explicit authorization scope, and matching displayed consent', async () => {
  const f = fixture(); const read = await start(f);
  await rejects(f.service.authorize({ ...read.auth, scope: dualScope }), 'invalid_scope');
  const s = await start(f, 'none', dualScope);
  assert.equal(s.client.scope, dualScope);
  assert.equal((await f.service.pending(s.id)).scope, dualScope);
  for (const displayed of [undefined, REPORT_SCOPE, REPORT_AUTOPSY_SCOPE, 'admin']) {
    await rejects(f.service.decide(s.id, true, displayed), 'invalid_scope');
    assert.equal((await f.service.pending(s.id)).scope, dualScope);
  }
  const uri = new URL(await f.service.decide(s.id, true, dualScope));
  const t = await f.service.token({ grant_type: 'authorization_code', client_id: s.client.client_id, redirect_uri: redirect, code_verifier: verifier, code: uri.searchParams.get('code') });
  assert.equal(t.scope, dualScope);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), true);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), true);
  const principal = await f.service.tokenPrincipal(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE);
  assert.deepEqual(principal, { grantId: t.access_token.slice(5).split('.')[0], owner: 'owner', clientId: s.client.client_id, scope: dualScope });
  assert.equal(await f.service.tokenPrincipal(`Bearer ${t.access_token}`, 'admin'), null);

  // Registration is only a ceiling, never implicit approval or an implicit authorization scope.
  const defaultUrl = await f.service.authorize({ ...s.auth, scope: undefined });
  const defaultId = new URL(defaultUrl).searchParams.get('oauth_request');
  assert.equal((await f.service.pending(defaultId)).scope, REPORT_SCOPE);
  const defaultCode = new URL(await f.service.decide(defaultId, true)).searchParams.get('code');
  const readToken = await f.service.token({ grant_type: 'authorization_code', client_id: s.client.client_id, redirect_uri: redirect, code_verifier: verifier, code: defaultCode });
  assert.equal(readToken.scope, REPORT_SCOPE);
  assert.equal(await f.service.tokenOk(`Bearer ${readToken.access_token}`, REPORT_AUTOPSY_SCOPE), false);
});

test('new dynamic registration may omit capability scope, but no authorization scope still means read-only', async () => {
  const f = fixture();
  const c = await f.service.register({ redirect_uris: [redirect], token_endpoint_auth_method: 'none' });
  assert.equal(c.scope, dualScope, 'server-provisioned client metadata must be returned honestly');
  assert.equal(f.rows().get(`admin_failed_report_oauth_clients/${c.client_id}`).scope, dualScope);
  assert.equal([...f.rows().keys()].some(key => key.startsWith('admin_failed_report_access/')), false, 'registration is not a resource-owner grant');
  const auth = { client_id: c.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
  const readId = new URL(await f.service.authorize(auth)).searchParams.get('oauth_request');
  assert.equal((await f.service.pending(readId)).scope, REPORT_SCOPE);
  const readCode = new URL(await f.service.decide(readId, true)).searchParams.get('code');
  const body = { grant_type: 'authorization_code', client_id: c.client_id, redirect_uri: redirect, code_verifier: verifier, code: readCode };
  const readToken = await f.service.token(body);
  assert.equal(readToken.scope, REPORT_SCOPE);
  assert.equal(await f.service.tokenOk(`Bearer ${readToken.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  await rejects(f.service.token({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: readToken.refresh_token, scope: dualScope }), 'invalid_scope');

  // The same client can explicitly request a separate consent, without rewriting its old grant.
  const writeId = new URL(await f.service.authorize({ ...auth, scope: dualScope })).searchParams.get('oauth_request');
  assert.equal((await f.service.pending(writeId)).scope, dualScope);
  await rejects(f.service.decide(writeId, true), 'invalid_scope');
  const writeCode = new URL(await f.service.decide(writeId, true, dualScope)).searchParams.get('code');
  const writeToken = await f.service.token({ ...body, code: writeCode });
  assert.equal(writeToken.scope, dualScope);
  assert.equal(await f.service.tokenOk(`Bearer ${writeToken.access_token}`, REPORT_AUTOPSY_SCOPE), true);
  assert.equal(await f.service.tokenOk(`Bearer ${readToken.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  const stillRead = await f.service.token({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: readToken.refresh_token });
  assert.equal(stillRead.scope, REPORT_SCOPE);
  assert.equal(await f.service.tokenOk(`Bearer ${stillRead.access_token}`, REPORT_AUTOPSY_SCOPE), false);
});

test('historical clients and pending/approved requests with no stored scope remain read-only', async () => {
  for (const historicalStatus of ['pending', 'approved']) {
    const f = fixture(); const s = await start(f);
    delete f.rows().get(`admin_failed_report_oauth_clients/${s.client.client_id}`).scope;
    await rejects(f.service.authorize({ ...s.auth, scope: dualScope }), 'invalid_scope');
    const url = await f.service.authorize({ ...s.auth, scope: undefined });
    const id = new URL(url).searchParams.get('oauth_request');
    delete f.rows().get(`admin_failed_report_oauth_requests/${id}`).scope;
    assert.equal((await f.service.pending(id)).scope, REPORT_SCOPE);
    const code = new URL(await f.service.decide(id, true)).searchParams.get('code');
    if (historicalStatus === 'approved') delete f.rows().get(`admin_failed_report_oauth_requests/${id}`).scope;
    const body = { grant_type: 'authorization_code', client_id: s.client.client_id, redirect_uri: redirect, code_verifier: verifier, code };
    await rejects(f.service.token({ ...body, scope: dualScope }), 'invalid_scope');
    const t = await f.service.token(body);
    assert.equal(t.scope, REPORT_SCOPE);
    assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), true);
    assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), false);
    await rejects(f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token, scope: dualScope }), 'invalid_scope');
    const fresh = await f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token });
    assert.equal(fresh.scope, REPORT_SCOPE);
    assert.equal(await f.service.tokenOk(`Bearer ${fresh.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  }
});

test('refresh preserves the exact grant, permanently narrows on request, and never re-escalates', async () => {
  const f = fixture(); const s = await approved(f, 'none', dualScope); const t = await f.service.token(s.body);
  const refresh = raw => ({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: raw });
  const preserved = await f.service.token(refresh(t.refresh_token));
  assert.equal(preserved.scope, dualScope);
  assert.equal(await f.service.tokenOk(`Bearer ${preserved.access_token}`, REPORT_AUTOPSY_SCOPE), true);
  const narrow = await f.service.token({ ...refresh(preserved.refresh_token), scope: REPORT_SCOPE });
  assert.equal(narrow.scope, REPORT_SCOPE);
  assert.equal(await f.service.tokenOk(`Bearer ${preserved.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  assert.equal(await f.service.tokenOk(`Bearer ${narrow.access_token}`), true);
  assert.equal(await f.service.tokenOk(`Bearer ${narrow.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  assert.equal(f.rows().get(`admin_failed_report_access/${narrow.access_token.slice(5).split('.')[0]}`).scope, REPORT_SCOPE);
  await rejects(f.service.token({ ...refresh(narrow.refresh_token), scope: dualScope }), 'invalid_scope');
  const again = await f.service.token(refresh(narrow.refresh_token));
  assert.equal(again.scope, REPORT_SCOPE);
  assert.equal(await f.service.tokenOk(`Bearer ${again.access_token}`, REPORT_AUTOPSY_SCOPE), false);
});

test('unknown, malformed and autopsy-only scopes fail closed across every scope entry point', async () => {
  const f = fixture(); const s = await approved(f, 'none', dualScope); const t = await f.service.token(s.body);
  const malformed = ['', null, 1, [], [REPORT_SCOPE], {}, 'admin', REPORT_AUTOPSY_SCOPE, `${REPORT_SCOPE} admin`, ` ${REPORT_SCOPE}`, `${REPORT_SCOPE} `, `${REPORT_SCOPE}\t${REPORT_AUTOPSY_SCOPE}`, `${REPORT_SCOPE}\n${REPORT_AUTOPSY_SCOPE}`, `${REPORT_SCOPE}  ${REPORT_AUTOPSY_SCOPE}`, `${REPORT_SCOPE} ${REPORT_SCOPE}`, `${dualScope} ${REPORT_AUTOPSY_SCOPE}`];
  for (const scope of malformed) {
    assert.throws(() => normalizeReportScope(scope), e => e.error === 'invalid_scope');
    assert.equal(hasReportScope(scope), false);
    assert.equal(hasReportScope(scope, REPORT_AUTOPSY_SCOPE), false);
    await rejects(f.service.register({ redirect_uris: [redirect], scope }), 'invalid_scope');
    await rejects(f.service.authorize({ ...s.auth, scope }), 'invalid_scope');
    await rejects(f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token, scope }), 'invalid_scope');
  }
  assert.equal(normalizeReportScope(undefined), REPORT_SCOPE);
  assert.equal(hasReportScope(undefined), false, 'missing persisted grant scope is not an authorization');
  assert.equal(normalizeReportScope(`${REPORT_AUTOPSY_SCOPE} ${REPORT_SCOPE}`), dualScope);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), true, 'failed escalation must not rotate or destroy the valid grant');
});

test('code exchange cannot widen read consent, and refresh cannot widen any read grant', async () => {
  const f = fixture(); const s = await approved(f);
  await rejects(f.service.token({ ...s.body, scope: dualScope }), 'invalid_scope');
  const t = await f.service.token(s.body);
  for (const scope of [dualScope, REPORT_AUTOPSY_SCOPE, 'admin']) {
    await rejects(f.service.token({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token, scope }), 'invalid_scope');
  }
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`), true);
  assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, REPORT_AUTOPSY_SCOPE), false);
});

test('dual-scope grants preserve revocation, owner, resource, expiry, client and token-hash boundaries', async () => {
  for (const action of ['revoke', 'owner', 'resource', 'expired', 'accessExpired', 'client', 'scope', 'missingScope', 'hash', 'nonfiniteExpiry']) {
    const f = fixture(); const s = await approved(f, 'none', dualScope); const t = await f.service.token(s.body);
    const id = t.access_token.slice(5).split('.')[0]; const grant = f.rows().get(`admin_failed_report_access/${id}`);
    if (action === 'revoke') await f.service.revoke({ client_id: s.client.client_id, token: t.access_token });
    if (action === 'owner') f.changeOwner();
    if (action === 'resource') grant.resource = 'https://other.example/mcp';
    if (action === 'expired') f.advance(30 * 86_400_000);
    if (action === 'accessExpired') f.advance(3_600_000);
    if (action === 'client') grant.clientId = null;
    if (action === 'scope') grant.scope = 'admin';
    if (action === 'missingScope') delete grant.scope;
    if (action === 'hash') { grant.accessHash = 'bad'; grant.refreshHash = 'bad'; }
    if (action === 'nonfiniteExpiry') grant.expiresAt = Infinity;
    for (const scope of [REPORT_SCOPE, REPORT_AUTOPSY_SCOPE]) {
      assert.equal(await f.service.tokenOk(`Bearer ${t.access_token}`, scope), false, `${action}: ${scope}`);
      assert.equal(await f.service.tokenPrincipal(`Bearer ${t.access_token}`, scope), null, `${action}: principal`);
    }
    const refresh = { grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: t.refresh_token };
    if (action === 'accessExpired') {
      const fresh = await f.service.token(refresh);
      assert.equal(await f.service.tokenOk(`Bearer ${fresh.access_token}`, REPORT_AUTOPSY_SCOPE), true);
    } else await assert.rejects(f.service.token(refresh));
  }
});

// Real route transaction drill. Refuses every non-loopback database destination.
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback emulator required.');
process.env.VITEST = 'true';
process.env.SECRET_ENCRYPTION_KEY = 'synthetic-emulator-only-key-123456';
process.env.ADMIN_USERNAME = 'synthetic-shield-owner';
process.env.ADMIN_PASSWORD = 'synthetic-owner-password';
process.env.ADMIN_SESSION_SIGNING_KEY = 'a1'.repeat(32);
delete process.env.ADMIN_TOTP_SECRET;
const app = initializeApp({ projectId: 'demo-navbharatai-phase2' }, 'admin-shield-drill');
const db = getFirestore(app);
const { setServerDb } = await import('../src/server/lib/serverDb.ts');
const { encrypt, decrypt } = await import('../src/server/lib/secrets.ts');
const { generateTotp } = await import('../src/server/lib/totp.ts');
const { captureRoutes, mockReq, mockRes } = await import('../tests/helpers/routeTestUtils.ts');
const { registerAdminRoutes } = await import('../src/server/routes/admin.ts');
setServerDb(db);
// Capture real business handlers; middleware/auth is exercised separately by adminAuth/route tests.
const routes = captureRoutes(registerAdminRoutes, (_req: unknown, _res: unknown, next: () => void) => next());
const ref = db.doc('admin_mfa/config');
const current = 'JBSWY3DPEHPK3PXP';
const replacement = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
async function call(action: string, body: object = {}) {
  const res = mockRes();
  await routes.get(`POST /api/admin/mfa/${action}`)!(mockReq({ body, ip: '127.0.0.1' }), res);
  return res;
}
try {
  await ref.set({ enabled: true, encrypted_secret: encrypt(current), encrypted_pending: encrypt(replacement), pending_expires_at_ms: Date.now() + 600_000 });
  assert.equal((await call('enroll')).statusCode, 409);
  assert.equal((await call('verify', { code: generateTotp(replacement) })).statusCode, 409);
  assert.equal(decrypt((await ref.get()).data()!.encrypted_secret), current);

  await ref.set({ enabled: false });
  const begin = await call('enroll');
  assert.equal(begin.statusCode, 200);
  assert.equal((await ref.get()).data()!.enabled, false);
  const confirmations = await Promise.all([call('verify', { code: generateTotp(begin.body.secret) }), call('verify', { code: generateTotp(begin.body.secret) })]);
  assert.deepEqual(confirmations.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await ref.get()).data()!.encrypted_pending, '');

  await ref.set({ enabled: false, encrypted_pending: encrypt(current), pending_expires_at_ms: Date.now() - 1 });
  assert.equal((await call('verify', { code: generateTotp(current) })).statusCode, 400);
  assert.equal((await ref.get()).data()!.enabled, false);

  await ref.set({ enabled: true, encrypted_secret: encrypt(current) });
  // Commit a replacement AFTER the handler's initial read but BEFORE its transaction.
  // The actual transaction must check the replacement rather than trusting the stale read.
  let replaced = false;
  setServerDb({ doc: (path: string) => db.doc(path), collection: (path: string) => db.collection(path),
    runTransaction: async (fn: any) => {
      if (!replaced) { replaced = true; await ref.set({ enabled: true, encrypted_secret: encrypt(replacement) }); }
      return db.runTransaction(fn);
    },
  } as any);
  assert.equal((await call('disable', { code: generateTotp(current) })).statusCode, 401);
  assert.equal(decrypt((await ref.get()).data()!.encrypted_secret), replacement);
  setServerDb(db);
  assert.equal((await call('disable', { code: generateTotp(replacement) })).statusCode, 200);
  assert.equal((await ref.get()).data()!.enabled, false);
  console.log('PASS real MFA routes: active-factor containment, concurrent confirmation, expiry, stale disable race and current-factor disable.');
} finally {
  setServerDb(null);
  await ref.delete(); // Only synthetic fixture in the verified loopback emulator.
  await db.terminate();
  await deleteApp(app);
}

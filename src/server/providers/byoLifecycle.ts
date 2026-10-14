/**
 * Go-live PR 16 — connect-your-own Supabase: test, rotate, disconnect.
 *
 * ROTATE is the risky one: a new key is PROBED before it replaces the old one, and the old one is
 * only dropped after the new one is stored, so a typo or a revoked key can never leave the app with
 * no working key. Disconnect only forgets OUR copy of the connection; the user's project and data
 * stay in their own account. Secrets go only to the injected store; results never carry them.
 * Deps-injected and not routed yet (a route behind BYO_LIFECYCLE_V1, default off, is a follow-up).
 */
export interface ByoLifecycleDeps {
  /** Calls the project with this key; true when it answers as that project. */
  probe: (projectRef: string, key: string) => Promise<boolean>;
  currentKeyVersion: (uid: string, projectRef: string) => Promise<number | null>;
  /** Stores `key` as version `version`; must be atomic and reject if `version` already exists. */
  storeKey: (uid: string, projectRef: string, version: number, key: string) => Promise<void>;
  /** Makes `version` the one the app uses. */
  activate: (uid: string, projectRef: string, version: number) => Promise<void>;
  retireKey: (uid: string, projectRef: string, version: number) => Promise<void>;
  forgetConnection: (uid: string) => Promise<boolean>;
  audit: (uid: string, action: 'byo_test' | 'byo_rotate' | 'byo_disconnect', ok: boolean, detail: string) => Promise<void>;
}

export type LifecycleResult = { ok: true; detail: string } | { ok: false; detail: string };

const safe = async (p: Promise<unknown>) => { try { await p; } catch { /* audit is best-effort */ } };

export async function testConnection(d: ByoLifecycleDeps, uid: string, projectRef: string, key: string): Promise<LifecycleResult> {
  const ok = await d.probe(projectRef, key).catch(() => false);
  await safe(d.audit(uid, 'byo_test', ok, projectRef));
  return ok ? { ok: true, detail: 'Your database answered.' } : { ok: false, detail: 'Could not reach your database with that key.' };
}

export async function rotateKey(d: ByoLifecycleDeps, uid: string, projectRef: string, newKey: string): Promise<LifecycleResult> {
  if (!newKey || newKey.trim() !== newKey || newKey.length < 20) return { ok: false, detail: 'That does not look like a valid key.' };
  if (!(await d.probe(projectRef, newKey).catch(() => false))) {
    await safe(d.audit(uid, 'byo_rotate', false, 'probe failed; old key kept'));
    return { ok: false, detail: 'The new key did not work, so the old one is still in use.' };
  }
  const old = await d.currentKeyVersion(uid, projectRef);
  const next = (old ?? 0) + 1;
  try {
    await d.storeKey(uid, projectRef, next, newKey);
    await d.activate(uid, projectRef, next);
  } catch {
    await safe(d.audit(uid, 'byo_rotate', false, 'store/activate failed; old key kept'));
    return { ok: false, detail: 'Could not save the new key, so the old one is still in use.' };
  }
  if (old !== null) await safe(d.retireKey(uid, projectRef, old));
  await safe(d.audit(uid, 'byo_rotate', true, `v${next}`));
  return { ok: true, detail: 'Key updated.' };
}

export async function disconnectByo(d: ByoLifecycleDeps, uid: string, confirmed: boolean): Promise<LifecycleResult> {
  if (!confirmed) return { ok: false, detail: 'Please confirm. Your project and its data stay in your own account.' };
  const ok = await d.forgetConnection(uid).catch(() => false);
  await safe(d.audit(uid, 'byo_disconnect', ok, ''));
  return ok ? { ok: true, detail: 'Disconnected. Your project and data are untouched in your account.' } : { ok: false, detail: 'Could not disconnect; please try again.' };
}

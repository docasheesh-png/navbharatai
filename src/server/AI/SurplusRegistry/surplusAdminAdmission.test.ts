import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { identityGrantEmail, isAgentV3FreeUser } from '../../AgentV3/featureFlag';
import { isAdminEmail } from '../../lib/adminEmails';
import type { SurplusBuildSession } from './buildSession';

const admission = vi.hoisted(() => ({ resolve: vi.fn(), skip: vi.fn(() => false) }));
vi.mock('./admitOrFallback', () => ({
  resolveProBuildSurplusAdmission: admission.resolve,
  safeSurplusAdmissionReason: (reason: string) => reason,
}));
vi.mock('./surplusAdmitCircuit', () => ({
  shouldSkipSurplusAdmit: admission.skip,
  SURPLUS_ADMIT_CIRCUIT_OPEN_REASON: 'admit_circuit_open',
}));
import { isVerifiedSurplusAdmin, runWeakSurplusAdmissionForChat } from './surplusChatAdmission';

type Identity = { uid: string; email: string | null; emailVerified?: boolean } | null;
const adminIdentity = { uid: 'synthetic-admin', email: 'admin@example.invalid', emailVerified: true };
const session = { model: 'synthetic-surplus-model' } as SurplusBuildSession;
const options = (verifiedAdmin: boolean, tierEngineAvailable = vi.fn(() => true)) => ({
  verifiedAdmin, powerLevel: 'weak', intent: 'build', hasImportIntent: false,
  prompt: 'Build a synthetic example', buildId: 'synthetic-build', tierEngineAvailable, audit: vi.fn(),
});
function optionsForIdentity(verified: Identity) {
  const email = identityGrantEmail(verified);
  return options(isVerifiedSurplusAdmin(verified, email));
}

beforeEach(() => {
  vi.stubEnv('AGENTV3_REPORT_ADMINS', 'admin@example.invalid');
  vi.stubEnv('AGENTV3_FREE_LIST', 'tester@example.invalid');
  admission.skip.mockReset().mockReturnValue(false);
  admission.resolve.mockReset().mockImplementation(async (opts: { onAdmitted?: (value: SurplusBuildSession) => void }) => {
    opts.onAdmitted?.(session);
    return { ok: true, session };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Surplus admission requires server-verified admin authority', () => {
  it('admits a verified admin through the existing Weak build door', async () => {
    const gate = await runWeakSurplusAdmissionForChat(optionsForIdentity(adminIdentity));
    expect(gate).toMatchObject({ ok: true, session, diag: { code: 'SURPLUS_ADMITTED' } });
    expect(admission.skip).toHaveBeenCalledOnce();
    expect(admission.resolve).toHaveBeenCalledOnce();
  });

  it.each([
    ['ordinary verified user', { uid: 'synthetic-user', email: 'user@example.invalid', emailVerified: true }],
    ['anonymous caller', null],
    ['unverified admin email', { uid: 'synthetic-user', email: 'admin@example.invalid', emailVerified: false }],
    ['missing verified-email evidence', { uid: 'synthetic-user', email: 'admin@example.invalid' }],
    ['missing verified uid', { uid: '', email: 'admin@example.invalid', emailVerified: true }],
    ['free-list tester', { uid: 'synthetic-tester', email: 'tester@example.invalid', emailVerified: true }],
  ] as const)('keeps %s on direct Weak without consulting Surplus state', async (_label, identity) => {
    const opts = optionsForIdentity(identity);
    const gate = await runWeakSurplusAdmissionForChat(opts);
    expect(gate).toEqual({ ok: true, session: undefined, diag: undefined });
    expect(admission.skip).not.toHaveBeenCalled();
    expect(admission.resolve).not.toHaveBeenCalled();
    expect(opts.audit).not.toHaveBeenCalled();
  });

  it('does not confuse the free-list exemption with administrator authority', async () => {
    const tester = { uid: 'synthetic-tester', email: 'tester@example.invalid', emailVerified: true };
    expect(isAgentV3FreeUser(tester.uid, identityGrantEmail(tester))).toBe(true);
    expect(isAdminEmail(identityGrantEmail(tester))).toBe(false);
    await runWeakSurplusAdmissionForChat(optionsForIdentity(tester));
    expect(admission.skip).not.toHaveBeenCalled();
    expect(admission.resolve).not.toHaveBeenCalled();
  });

  it('cannot promote body email, role or isAdmin claims into the internal authority bit', async () => {
    const body = { userId: 'synthetic-admin', email: 'admin@example.invalid', role: 'admin', isAdmin: true, verifiedAdmin: true };
    const verified = { uid: 'synthetic-user', email: 'user@example.invalid', emailVerified: true };
    const opts = optionsForIdentity(verified);
    expect(body.verifiedAdmin).toBe(true);
    expect(opts.verifiedAdmin).toBe(false);
    await runWeakSurplusAdmissionForChat(opts);
    expect(admission.skip).not.toHaveBeenCalled();
    expect(admission.resolve).not.toHaveBeenCalled();
  });

  it('refuses honestly when non-admin direct Weak is unavailable, without claiming Surplus fallback', async () => {
    const opts = options(false, vi.fn(() => false));
    expect(await runWeakSurplusAdmissionForChat(opts)).toEqual({ ok: false, diag: undefined, afterSurplusFallback: false });
    expect(opts.tierEngineAvailable).toHaveBeenCalledOnce();
    expect(admission.skip).not.toHaveBeenCalled();
    expect(admission.resolve).not.toHaveBeenCalled();
    expect(opts.audit).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'true', 1])('fails closed for absent/non-boolean authority %s', value => {
    // Deliberately cross the JavaScript boundary: only literal true is authority.
    return runWeakSurplusAdmissionForChat({ ...options(false), verifiedAdmin: value as never }).then(gate => {
      expect(gate).toEqual({ ok: true, session: undefined, diag: undefined });
      expect(admission.skip).not.toHaveBeenCalled();
      expect(admission.resolve).not.toHaveBeenCalled();
    });
  });

  it('does not use admin authority to enable Surplus on another tier or plain chat', async () => {
    for (const override of [{ powerLevel: 'off' }, { powerLevel: 'mini' }, { intent: 'chat' }]) {
      expect(await runWeakSurplusAdmissionForChat({ ...options(true), ...override })).toEqual({ ok: true, session: undefined, diag: undefined });
    }
    expect(admission.skip).not.toHaveBeenCalled();
    expect(admission.resolve).not.toHaveBeenCalled();
  });

  it('wires route authority from the verified identity and grant email, not request fields', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(/verifiedAdmin:\s*isVerifiedSurplusAdmin\(verified, email\)/.test(route)).toBe(true);
    expect(route.includes('let email = entitlementEmail(verified)')).toBe(true);
    expect(route.includes('email = await resolveGrantEmail(verified.uid)')).toBe(true);
  });
});

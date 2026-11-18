import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { identityGrantEmail } from '../../AgentV3/featureFlag';
import { cheaperInferenceExclusiveAdmin, cheaperInferencePaidRungEnabled } from '../../lib/cheaperInferencePolicy';
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
import { runWeakSurplusAdmissionForChat } from './surplusChatAdmission';

const session = { model: 'synthetic-surplus-model' } as SurplusBuildSession;
const options = () => ({
  powerLevel: 'weak', intent: 'build', hasImportIntent: false,
  prompt: 'Build a synthetic example', buildId: 'synthetic-build', tierEngineAvailable: vi.fn(() => true), audit: vi.fn(),
});
beforeEach(() => {
  vi.stubEnv('AGENTV3_REPORT_ADMINS', 'admin@example.invalid');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_synthetic_test_key');
  admission.skip.mockReset().mockReturnValue(false);
  admission.resolve.mockReset().mockImplementation(async (opts: { onAdmitted?: (value: SurplusBuildSession) => void }) => {
    opts.onAdmitted?.(session);
    return { ok: true, session };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Surplus builder eligibility is independent of CheaperInference admin-only chat policy', () => {
  it('admits an eligible Weak build without an admin claim or special account exception', async () => {
    expect(await runWeakSurplusAdmissionForChat(options())).toMatchObject({ ok: true, session, diag: { code: 'SURPLUS_ADMITTED' } });
    expect(admission.resolve).toHaveBeenCalledOnce();
  });

  it.each(['user@example.invalid', 'admin@example.invalid'])('keeps the two provider policies separate for %s', async email => {
    const trustedEmail = identityGrantEmail({ uid: 'synthetic-user', email, emailVerified: true });
    expect(cheaperInferenceExclusiveAdmin(trustedEmail)).toBe(email === 'admin@example.invalid');
    // Owner t357u: the chat rung is now on for everyone; Surplus admission still ignores it entirely.
    expect(cheaperInferencePaidRungEnabled()).toBe(true);
    expect(await runWeakSurplusAdmissionForChat(options())).toMatchObject({ ok: true, session });
    expect(admission.resolve).toHaveBeenCalledOnce();
  });

  it('retains Weak import admission even when its initial intent is chat', async () => {
    expect(await runWeakSurplusAdmissionForChat({ ...options(), intent: 'chat', hasImportIntent: true })).toMatchObject({ ok: true, session });
  });

  it.each([{ powerLevel: 'off' }, { powerLevel: 'mini' }, { intent: 'chat' }])('does not expand Surplus beyond Weak build/import: %j', async override => {
    expect(await runWeakSurplusAdmissionForChat({ ...options(), ...override })).toEqual({ ok: true, session: undefined, diag: undefined });
    expect(admission.skip).not.toHaveBeenCalled(); expect(admission.resolve).not.toHaveBeenCalled();
  });

  it('retains the circuit fallback rather than treating eligibility as provider success', async () => {
    admission.skip.mockReturnValue(true);
    expect(await runWeakSurplusAdmissionForChat(options())).toMatchObject({ ok: true, session: undefined, diag: { code: 'SURPLUS_FALLBACK' } });
    expect(admission.resolve).not.toHaveBeenCalled();
  });

  it('does not reintroduce a Surplus admin or special-account gate at the route', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const admissionSource = readFileSync('src/server/AI/SurplusRegistry/surplusChatAdmission.ts', 'utf8');
    expect(route.includes('isVerifiedSurplusAdmin')).toBe(false);
    expect(admissionSource.includes('verifiedAdmin')).toBe(false);
    expect(admissionSource.includes('isAdminEmail')).toBe(false);
  });
});

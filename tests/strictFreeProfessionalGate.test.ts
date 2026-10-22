import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({ professionalPassStore: { getStatus: vi.fn(() => { throw new Error('Must not query paid access'); }) } }));
vi.mock('../src/server/professionals/ProfessionalUsageStore', () => ({ professionalUsageStore: { getTodayCount: vi.fn(() => { throw new Error('Must not query paid quota'); }) }, professionalExamUsageStore: {} }));
vi.mock('../src/server/lib/freeProgram', () => ({ freeProgramPaused: vi.fn(() => { throw new Error('Must not change or query legacy gifts'); }) }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: vi.fn(() => { throw new Error('No external store'); }) }));
vi.mock('../src/server/lib/aiTurnCharge', () => ({ aiWalletSpendEnabled: () => true }));
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';
import { gateProfessionalExam, gateProfessionalTurn } from '../src/server/professionals/passGate';
const old = process.env.STRICT_FREE_MODULES_ENABLED;
afterEach(() => { if (old === undefined) delete process.env.STRICT_FREE_MODULES_ENABLED; else process.env.STRICT_FREE_MODULES_ENABLED = old; });
describe('strict-free professional access', () => {
  it('allows a signed-in turn without paid wallet/pass/gift lookups', async () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true';
    expect(await runWithInferenceScope('free-modules', () => gateProfessionalTurn('user', null))).toMatchObject({ allow: true, tier: 'free', countsAgainstFree: false, billableFraction: 0 });
  });
  it('covers the whole requested exam rather than converting to paid after a quota', async () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true';
    expect(await runWithInferenceScope('free-modules', () => gateProfessionalExam('user', null, 12))).toMatchObject({ allow: true, tier: 'free', freeQuestions: 12 });
  });
  it('preserves required sign-in', async () => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true';
    expect(await gateProfessionalTurn(null, null)).toMatchObject({ allow: false, status: 401 });
    expect(await gateProfessionalExam(null, null, 12)).toMatchObject({ allow: false, status: 401 });
  });
});

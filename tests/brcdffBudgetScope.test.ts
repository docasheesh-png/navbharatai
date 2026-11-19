// BRcdffbb71: an eight-minute ETA extension at minute22 of a25-minute build, and a money-moving
// game explicitly forbidden accounts because its primary domain was "game". No budget/auth policy change.
import { describe, expect, it } from 'vitest';
import { etaTickLine, type EtaTickState } from '../src/server/AgentV3/progressEta';
import { asksForMoneyMovement, requestScopeVerdict } from '../src/server/AgentV3/requestScope';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const reportPrompt = 'make app for me colour prediction game app with deposit in withdrawal process everything';
const tick = (overrides: Partial<EtaTickState> = {}): EtaTickState => ({
  elapsedMs: 1_324_351, now: 1_794_994_539_616,
  finalChecks: false, appRenderedAt: 0, appExists: true,
  plannedFiles: 0, filesDone: 10, firstFileAt: 1_794_993_343_511,
  plannedSteps: 5, stepsDone: 5, firstStepAt: 1_794_993_282_876,
  evidenced: true, budgetMs: 1_500_000, remainingMs: 175_649,
  roughBand: null, roughHighMs: null,
  totalMs: 1_251_349, baseMs: 937_554, revisions: 0, promisedHighMs: 1_251_349,
  ...overrides,
});
const FINISH_FORECAST = /\bto go\b|\bmore to go\b/;

describe('BRcdffbb71 · a forecast cannot extend the build window', () => {
  it('withdraws the exact eight-minute overrun promise, without shortening it into a false promise', () => {
    const result = etaTickLine(tick());
    expect(result.kind).toBe('budget-limit');
    expect(result.text).toContain("can't give a finish time");
    expect(result.text).not.toMatch(FINISH_FORECAST);
    // Keep the measured/estimated state. A display guard is not a new estimator or a changed deadline.
    expect(result.totalMs).toBe(1_793_128);
    expect(result.revisions).toBe(1);
    expect(result.evidenced).toBe(true);
  });

  it('uses the independent wall clock even when waits reduce the displayed elapsed time', () => {
    const result = etaTickLine(tick({ elapsedMs: 60_000, remainingMs: 20_000 }));
    expect(result.kind).toBe('budget-limit');
    expect(result.text).toContain('1 min in');
    expect(result.text).not.toMatch(FINISH_FORECAST);
  });

  it.each([
    { plannedFiles: 8, filesDone: 3, firstFileAt: 1_794_994_419_616 },
    { plannedSteps: 8, stepsDone: 3, firstStepAt: 1_794_994_419_616 },
  ])('also withdraws an impossible measured forecast: %j', (measurement) => {
    const result = etaTickLine(tick(measurement));
    expect(result.kind).toBe('budget-limit');
    expect(result.totalMs).toBe(1_684_351);
    expect(result.text).not.toMatch(FINISH_FORECAST);
  });

  it.each([0, -1, NaN])('does not promise completion against an exhausted or invalid live remainder: %s', (remainingMs) => {
    expect(etaTickLine(tick({ remainingMs })).text).not.toMatch(FINISH_FORECAST);
  });

  it('preserves a fitting estimate and an explicitly unlimited clock', () => {
    const within = etaTickLine(tick({ remainingMs: 500_000 }));
    expect(within.kind).toBe('budget');
    expect(within.text).toContain('about 8 min more to go');
    expect(etaTickLine(tick({ remainingMs: Infinity })).text).toBe(within.text);
    expect(etaTickLine(tick({ remainingMs: undefined, budgetMs: 0 })).text).toBe(within.text);
  });

  it('uses the configured cap for older callers that have not supplied a live remainder', () => {
    expect(etaTickLine(tick({ remainingMs: undefined })).kind).toBe('budget-limit');
  });

  it('keeps rendered/final-check phase facts ahead of every forecast guard', () => {
    expect(etaTickLine(tick({ remainingMs: 0, appRenderedAt: 1_794_994_500_000 })).kind).toBe('app-running');
    expect(etaTickLine(tick({ remainingMs: 0, finalChecks: true })).kind).toBe('final-checks');
  });

  it('guards a labelled rough countdown too', () => {
    const result = etaTickLine(tick({ elapsedMs: 60_000, remainingMs: 20_000, roughBand: '~10–21 min' }));
    expect(result.kind).toBe('budget-limit');
    expect(result.text).not.toMatch(FINISH_FORECAST);
  });

  it.each([
    { evidenced: false },
    { filesDone: 0, stepsDone: 0 },
    { roughBand: '~10–21 min', roughHighMs: 1_251_349 },
  ])('the non-forecast budget lines use that same independent remainder: %j', (branch) => {
    const result = etaTickLine(tick({ ...branch, remainingMs: 60_000 }));
    expect(result.text).toMatch(/(?:up to 1 min more|up to 1 min left)/);
    expect(result.text).not.toMatch(FINISH_FORECAST);
    expect(etaTickLine(tick({ ...branch, remainingMs: Infinity })).text).not.toMatch(/up to \d/);
  });
});

describe('BRcdffbb71 · money movement can need access control inside any domain', () => {
  it('stands down for the exact request without reclassifying the game or requiring authentication', () => {
    const domain = analyzeRequirementGaps(reportPrompt).domain;
    expect(domain).toBe('game');
    expect(asksForMoneyMovement(reportPrompt)).toBe(true);
    expect(requestScopeVerdict({ request: reportPrompt, newBuild: true, domain }, {})).toBeNull();
  });

  it.each([
    'A colour game with deposits and withdrawals',
    'A puzzle game with cash-out',
    'A drawing app that accepts payouts',
    'A booking tool to accept payments',
    'A game to send money',
    'A demo game with real deposits and withdrawals',
    'A demo game with real-money withdrawals',
    'Simulate deposits; however process withdrawals',
    'A deposit interest calculator, but enable withdrawals',
    'Process deposits with interest',
    'No deposits, but enable withdrawals',
    'No deposits, withdrawals are allowed',
    'A wallet app that accepts deposits',
    'Withdraw funds from a bank balance',
    'A map of mineral deposits, but accept payments for premium maps',
    'An education app with course withdrawal and real-money withdrawals',
    'An employee leave app to withdraw requests and receive payouts',
  ])('withdraws only the no-accounts instruction for operational money intent: %s', (request) => {
    expect(asksForMoneyMovement(request)).toBe(true);
    expect(requestScopeVerdict({ request, newBuild: true, domain: 'game' }, {})).toBeNull();
  });

  it.each([
    'A racing game',
    'A notes app',
    'A deposit interest calculator',
    'A cash withdrawal fee estimator',
    'A lesson explaining deposits and withdrawals',
    'A withdrawal symptoms tracker',
    'A mock deposit and withdrawal workflow',
    'A game with virtual coins and deposits and withdrawals',
    'A game using play money for deposits and withdrawals',
    'A deposit simulator',
    'A demo game with no login needed',
    'A racing game without deposits or withdrawals',
    'A game, do not allow real deposits and withdrawals',
    'A game where withdrawals are disabled',
    'A demo game with no real money, deposits and withdrawals use play money',
    'A game without real-money deposits or withdrawals',
    'An employee leave app where employees withdraw requests',
    'A map of mineral deposits',
    'An education app with course withdrawal',
    'An app to withdraw applications',
    'A map of deposits of calcium',
    'An educational dataset of mineral deposits and course withdrawal',
    'A payment request app where employees withdraw their requests',
    'A workflow to withdraw proposals',
    'A science app showing deposits',
  ])('keeps the existing protection for non-operational or unrelated requests: %s', (request) => {
    expect(asksForMoneyMovement(request)).toBe(false);
    expect(requestScopeVerdict({ request, newBuild: true, domain: 'game' }, {})).not.toBeNull();
  });

  it('retains explicit sign-in, edit, and disabled-rule behavior', () => {
    expect(requestScopeVerdict({ request: 'A game with login', newBuild: true, domain: 'game' }, {})).toBeNull();
    expect(requestScopeVerdict({ request: 'A racing game', newBuild: false, domain: 'game' }, {})).toBeNull();
    expect(requestScopeVerdict({ request: 'A racing game', newBuild: true, domain: 'game' }, { AGENTV3_REQUEST_SCOPE: 'off' })).toBeNull();
  });
});

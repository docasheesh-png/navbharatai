/** Synthetic classification and honesty regressions. No customer report payload.
 * An open-world game that names banks, ATMs, and people must stay a game.
 * A text-only lane must not generate a binary model. Admin-only fields must
 * stay off every user-facing client path. A pre-timer model call must not be
 * reported as a zero-second first call.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { binaryTextGenerationProblem, binaryTextWriteRefusal } from '../src/server/AgentV3/binaryTextWrite';
import { isBinaryAsset } from '../src/server/AgentV3/fileClassification';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';
import { BuildDiagnostics, renderDiagnosticsText, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { compactReportForRecord, trimReportForStorage } from '../src/server/AgentV3/DiagnosticsStore';
import { conversationToEvents } from '../src/components/agentv3/agentV3History';

const SIMPLE = readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');
const ANALYZER = readFileSync('src/server/lib/RequirementGapAnalyzer.ts', 'utf8');
const ADMIN_TOKEN = 'connect-unknown';
const GLB = 'src/main/resources/static/models/tree1.glb';

const GAME_WITH_WORLD_BANK = [
  'I want a realistic open-world game like Earth, with many kinds of people, multiplayer so others can play, jungle and desert, army recruitment, vending machines, ATM machines, a bank, a bridge, and a way to earn and redeem money in the world.',
  'Mujhe ek real world game chahiye, multiplayer khel sake, jungle, vending machine, ATM machine, bank, paise kamana aur redeem karne ka system, kuchh log ho.',
  'Ek open-world khel banao jisme jungle, bank, ATM aur kuchh log hon.',
];

const FINTECH_NEIGHBOURS = [
  'Build a mobile banking app with savings accounts, UPI payments, and KYC.',
  'a mobile wallet app with UPI and KYC',
  'Add gamification badges to our banking app with KYC and UPI wallet',
  'Build a bank app with a small game for kids on the home screen',
];

describe('BR1985: a game that names world banks and people is not fintech', () => {
  it.each(GAME_WITH_WORLD_BANK)('classifies as game: %s', (prompt) => {
    const g = analyzeRequirementGaps(prompt);
    expect(g.domain).toBe('game');
    expect(g.mentioned).not.toContain('audit log');
    expect(g.likelyMissing.join(' | ')).toMatch(/win \/ lose/i);
    expect(g.likelyMissing.join(' | ')).not.toMatch(/KYC/i);
    expect(fastLaneSkipsGame(g.domain)).toBe(true);
  });

  it.each(FINTECH_NEIGHBOURS)('does not steal a real financial product: %s', (prompt) => {
    expect(analyzeRequirementGaps(prompt).domain).toBe('fintech');
    expect(fastLaneSkipsGame('fintech')).toBe(false);
  });

  it('an explicit audit log on a bank app is still a mentioned fintech feature', () => {
    const g = analyzeRequirementGaps('Build a neobank wallet with KYC and an audit log of every transfer');
    expect(g.domain).toBe('fintech');
    expect(g.mentioned).toContain('audit log');
  });

  it('gamification and a sales game plan are still not games', () => {
    expect(analyzeRequirementGaps('A gamified habit tracker with streaks and badges').domain).not.toBe('game');
    expect(analyzeRequirementGaps('A CRM to track our sales game plan and customer leads').domain).not.toBe('game');
  });

  it('a game with a shop is still a game, and a hospital audit log is still healthcare', () => {
    expect(analyzeRequirementGaps(
      'A roguelike game with waves of enemies, a score, unlockable levels, sound, and a shop to buy upgrades between runs.',
    ).domain).toBe('game');
    const hospital = analyzeRequirementGaps('A hospital system with staff roles and an audit log of every change');
    expect(hospital.domain).toBe('healthcare');
    expect(hospital.mentioned).toContain('audit log of record changes');
  });

  it('the audit-log feature has no bare log token, and Hindi people-log is stripped', () => {
    expect(ANALYZER).toContain('AUDIT_LOG_FEATURE_RE');
    expect(ANALYZER).toMatch(/kuchh\|yeh\|ye\|woh\|wo\|sab/);
    expect(ANALYZER).not.toMatch(/label: 'audit log', re: \/audit\|log\|track changes\/i/);
    expect(ANALYZER).not.toMatch(/re: \/audit\|history\|log\|track changes\/i/);
  });
});

describe('BR1985: the text-only lane does not generate a refused binary model', () => {
  it('a Spring-style .glb path is a binary asset and is refused as a text write', () => {
    expect(isBinaryAsset(GLB)).toBe(true);
    expect(isBinaryAsset('src/App.tsx')).toBe(false);
    expect(isBinaryAsset('public/tree.svg')).toBe(false);
    const refusal = binaryTextWriteRefusal(GLB);
    expect(refusal).toMatch(/NOT WRITTEN/);
    expect(refusal).toMatch(/\.glb/);
    expect(binaryTextWriteRefusal('src/App.tsx')).toBeNull();
    expect(binaryTextWriteRefusal('public/icon.svg')).toBeNull();
  });

  it('a planned .glb file is a binary-text generation problem before any model call', () => {
    const reason = binaryTextGenerationProblem([{ path: GLB }, { path: 'src/App.tsx' }]);
    expect(reason).toMatch(/binary assets require the tool-capable builder/);
    expect(reason).toContain(GLB);
    expect(binaryTextGenerationProblem([{ path: 'src/App.tsx' }, { path: 'public/icon.svg' }])).toBeNull();
  });

  it('the per-file lane still tests the plan for binary paths before generating', () => {
    expect(SIMPLE).toContain('const binaryProblem = binaryTextGenerationProblem(manifest);');
    expect(SIMPLE).toContain('if (binaryProblem)');
    expect(SIMPLE).toContain('Generated ${spec.path} (${filesDone}/${manifest.length}) — not saved yet.');
    expect(SIMPLE).not.toMatch(/`✓ \$\{spec\.path\} \(\$\{filesDone\}\/\$\{manifest\.length\}\)`/);
  });
});

describe('BR1985: a pre-timer model call is not reported as a zero-second first call', () => {
  it('a 20.4s call recorded shortly after the timer starts is a window mismatch, not 0s', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 4;
    d.recordLlmCall({
      model: 'qwen3-coder',
      provider: 'SURPLUS',
      promptPreview: 'Build scope admission classification',
      latencyMs: 20366,
      inputTokens: 1205,
      outputTokens: 1031,
      ok: true,
    });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(note).toContain('20.4s latency');
    expect(note).toContain('cannot be separated');
    expect(note).not.toContain('first call itself then took 0s');
    expect(note).not.toContain('0s of preparation');
  });

  it('a compatible in-window call still reports preparation and model time normally', () => {
    let t = 1000;
    const d = new BuildDiagnostics({ now: () => t });
    t += 8000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 2000, ok: true });
    const note = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(note).toContain('6s of preparation');
    expect(note).toContain('then took 2s');
  });
});

function stoppedBuildReport() {
  const diag = new BuildDiagnostics({ now: () => 1 });
  diag.record({
    phase: 'build',
    severity: 'info',
    code: 'REQUIREMENT_GAPS',
    message: 'Requirement analysis: domain=game, 4 likely-missing feature(s).',
    autoResolved: true,
    adminDetail: ADMIN_TOKEN,
  });
  diag.record({
    phase: 'tool',
    severity: 'warning',
    code: 'TOOL_ERROR',
    message: 'Tool call failed: NOT WRITTEN: src/main/resources/static/models/tree1.glb is a binary file.',
    autoResolved: false,
    detail: 'agent=frontend',
    adminDetail: ADMIN_TOKEN,
  });
  diag.record({
    phase: 'build',
    severity: 'warning',
    code: 'PLATFORM_WRITE_REFUSED',
    message: 'The workspace refused 1 of 1 file(s) a NavBharatAI pass wrote.',
    autoResolved: false,
    adminDetail: ADMIN_TOKEN,
  });
  diag.record({
    phase: 'build',
    severity: 'info',
    code: 'OUTCOME_USER_STOPPED',
    message: 'Build outcome: STOPPED BY THE USER — that is why it ended.',
    autoResolved: true,
  });
  diag.finish(false, 'Stopped, as you asked. Nothing had been written yet, so nothing was lost.');
  return diag.report();
}

function persistedConversationRecord(report: ReturnType<typeof stoppedBuildReport>) {
  return {
    id: 'agentv3-owner-br1985',
    status: 'error' as const,
    finalState: { ok: false, report: compactReportForRecord(report) },
  };
}

function assertNoAdminToken(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text).not.toContain(ADMIN_TOKEN);
  expect(text).not.toContain('adminDetail');
}

describe('BR1985: admin-only fields stay off every user-facing client path on a stopped build', () => {
  it('userFacingReport drops adminDetail from requirement, tool, and write-refusal rows', () => {
    const report = stoppedBuildReport();
    const user = userFacingReport(report);
    expect(user.issues.some((i) => 'adminDetail' in i || i.detail === ADMIN_TOKEN)).toBe(false);
    expect(user.problems.some((i) => 'adminDetail' in i || i.detail === ADMIN_TOKEN)).toBe(false);
    assertNoAdminToken(user);
    expect(user.issues.find((i) => i.code === 'TOOL_ERROR')?.detail).toBe('agent=frontend');
    expect(user.issues.some((i) => i.code === 'OUTCOME_USER_STOPPED')).toBe(true);
  });

  it('the persisted conversation record and the GET reopen contain no admin token', () => {
    const report = stoppedBuildReport();
    const rec = persistedConversationRecord(report);
    assertNoAdminToken(rec);
    const response = { conversation: rec, workspaceState: undefined };
    assertNoAdminToken(response);
    const events = conversationToEvents(rec);
    assertNoAdminToken(events);
    const result = events.find((e) => e.type === 'result') as { diagnostics?: unknown };
    expect(result?.diagnostics).toBeDefined();
  });

  it('the admin-gated stores and admin text view still show the reason', () => {
    const report = stoppedBuildReport();
    expect(report.issues.find((i) => i.code === 'TOOL_ERROR')?.adminDetail).toBe(ADMIN_TOKEN);
    const stored = trimReportForStorage(report);
    expect(stored.issues.find((i) => i.code === 'TOOL_ERROR')?.adminDetail).toBe(ADMIN_TOKEN);
    expect(renderDiagnosticsText(stored)).toContain(ADMIN_TOKEN);
    expect(renderDiagnosticsText(report)).toContain(ADMIN_TOKEN);
  });
});

// Autopsy de3bb2bb (2026-10-01, "Ye yese app banao jo data COACT oar sake", Weak, ok, 12.6 min). The app was
// built, rendered and pressed in a real browser. What was wrong was in the engine, in what it reported, and
// in one press the explorer should never have made. Each fix is locked here with the report's own inputs.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { valueOwnerFor, dataDirOwner, type SimpleFileSpec } from '../src/server/AgentV3/SimpleBuilder';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { analyzeProjectIntegrity, integrityRepairInstruction } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { BuildDiagnostics, HEAL_RESOLVES, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { viteEnvTypesNote } from '../src/server/AgentV3/viteEnvTypes';
import { NEVER_PRESS, WRITE_VERBS } from '../src/server/AgentV3/clickExplorer';
import { SIGN_IN_NEVER, signInModule } from '../src/server/AgentV3/signInExplore';
import { finalChecksEtaLine } from '../src/server/AgentV3/progressEta';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

// ── 1 · the planned constants file owns the contract's constants ──────────────────────────────────────
describe('1 · a constants module inside constants/ is the owner, not a new data.ts', () => {
  // The report's own fast-lane plan (the purpose lines are the planner's).
  const manifest: SimpleFileSpec[] = [
    { path: 'src/App.tsx', purpose: 'Main application component handling chat state, user input, and message rendering' },
    { path: 'src/components/ChatInterface.tsx', purpose: 'Chat UI component rendering message bubbles and input field' },
    { path: 'src/api/chatApi.ts', purpose: 'Service layer handling API calls to the COACT backend' },
    { path: 'src/types/chat.ts', purpose: 'TypeScript type definitions for chat messages and API responses' },
    { path: 'src/utils/errorHandler.ts', purpose: 'Centralized error handling utility for API failures' },
    { path: 'src/constants/chat.ts', purpose: 'Chat constants: default locale, error messages and API timeout' },
  ];
  const values = ['DEFAULT_LOCALE', 'ERROR_MESSAGES', 'API_TIMEOUT'];

  it('🔴 the report: src/constants/chat.ts owns DEFAULT_LOCALE / ERROR_MESSAGES / API_TIMEOUT — nothing is added', () => {
    expect(valueOwnerFor(manifest, values, 'src/types.ts')).toEqual({ path: 'src/constants/chat.ts', added: false });
  });

  it('several modules in data folders: the one whose words match the constants wins; a tie picks nobody', () => {
    const two: SimpleFileSpec[] = [
      { path: 'src/data/products.ts', purpose: 'Sample product list' },
      { path: 'src/constants/messages.ts', purpose: 'Error messages and the default locale' },
    ];
    expect(dataDirOwner(two, values)?.path).toBe('src/constants/messages.ts');
    const tie: SimpleFileSpec[] = [
      { path: 'src/data/a.ts', purpose: 'misc' },
      { path: 'src/data/b.ts', purpose: 'misc' },
    ];
    expect(dataDirOwner(tie, values)).toBeNull();
  });

  it('a component, a declaration file or a config inside such a folder is never the owner', () => {
    const notOwners: SimpleFileSpec[] = [
      { path: 'src/constants/Banner.tsx', purpose: 'error messages banner' },
      { path: 'src/data/types.d.ts', purpose: 'declarations' },
    ];
    expect(dataDirOwner(notOwners, values)).toBeNull();
    expect(valueOwnerFor(notOwners, values, 'src/types.ts')).toEqual({ path: 'src/data.ts', added: true });
  });
});

// ── 2 · a new conversation is not told it already holds a file ────────────────────────────────────────
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}
const mk = (act: FakeActuator) => {
  const stream = new AgentEventStream();
  return new ToolDispatcher(act, 'ws-1', new WorkspaceState(stream), stream);
};
const read = (d: ToolDispatcher, path: string, id: string) => d.dispatch({ id, name: 'read_file', input: { path } }, 'architect').then((r) => String(r.content));

describe('2 · a repair pass on the architect’s dispatcher starts with nothing in its context', () => {
  it('🔴 the report: the integrity repair’s FIRST read of src/main.tsx carries no "second time" notice', async () => {
    const act = new FakeActuator();
    act.files.set('src/main.tsx', 'import App from "./App";');
    const d = mk(act);
    await read(d, 'src/main.tsx', 'architect-1'); // the build's own run read it
    d.beginConversation(); // the integrity repair: a NEW AgentRunner.run on the same dispatcher
    const first = await read(d, 'src/main.tsx', 'heal-1');
    expect(first).not.toMatch(/NOTE — you have now read|STOP —/);
    expect(first).toContain('import App');
  });

  it('…the conversation that really re-reads its own unchanged file is still nudged', async () => {
    const act = new FakeActuator();
    act.files.set('src/main.tsx', 'x');
    const d = mk(act);
    d.beginConversation();
    await read(d, 'src/main.tsx', 'a');
    expect(await read(d, 'src/main.tsx', 'b')).toMatch(/NOTE — you have now read src\/main\.tsx the second time/);
  });

  it('…a file handed over in the task stays in context, and the build’s own read count keeps every read', async () => {
    const act = new FakeActuator();
    act.files.set('src/App.tsx', 'export default 1;');
    const d = mk(act);
    d.noteHandedOff('src/App.tsx', 'export default 1;');
    d.beginConversation();
    expect(await read(d, 'src/App.tsx', 'h1')).toMatch(/given to you in full in your task|second time/);
    expect(d.readLedgerCounts().get('src/App.tsx')).toBe(1);
  });

  it('AgentRunner.run starts every conversation this way (source guard)', () => {
    const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    const start = runner.indexOf('async run(userPrompt: string)');
    const firstTurn = runner.indexOf('const messages: unknown[] = [', start);
    const reset = runner.indexOf('dispatcher.beginConversation()', firstTurn);
    expect(start).toBeGreaterThan(0);
    expect(reset).toBeGreaterThan(firstTurn);
    expect(reset - firstTurn).toBeLessThan(600);
  });
});

// ── 3 · a shared stylesheet is not a defect ──────────────────────────────────────────────────────────
describe('3 · three screens importing one stylesheet is a fact, not an LLM repair', () => {
  const files = {
    'src/main.tsx': `import './index.css';\nimport App from './App';`,
    'src/screens/ChatScreen.tsx': `import './Screens.css';\nexport default function ChatScreen() { return <div className="chat-screen" />; }`,
    'src/screens/DataScreen.tsx': `import './Screens.css';\nexport default function DataScreen() { return <div className="data-screen" />; }`,
    'src/screens/AnalysisScreen.tsx': `import './Screens.css';\nexport default function AnalysisScreen() { return <div className="analysis-screen" />; }`,
    'src/index.css': 'body{margin:0}',
    'src/screens/Screens.css': '.chat-screen{}',
  };
  it('🔴 the report: ok stays true and the repair instruction is empty', () => {
    const report = analyzeProjectIntegrity(files);
    expect(report.duplicateStylesheets).toHaveLength(1);
    expect(report.ok).toBe(true);
    expect(integrityRepairInstruction(report)).toBe('');
  });
  it('the route records it at info level and never as a warning (source guard)', () => {
    expect(route).not.toMatch(/severity: 'warning', code: 'INTEGRITY_DUPLICATE_STYLESHEET'/);
    expect(route).toMatch(/severity: 'info', code: 'INTEGRITY_DUPLICATE_STYLESHEET', autoResolved: true/);
  });
});

// ── 4 · a heal that re-checked and passed resolves what it healed ─────────────────────────────────────
describe('4 · a healed finding is not still open', () => {
  it('🔴 the report: INTEGRITY_HEALED resolves the integrity warning it fixed', () => {
    const diag = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', prompt: 'p' } as never);
    diag.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_FOCUS_CONFLICT', message: '3 components grab initial focus', autoResolved: false });
    diag.record({ phase: 'build', severity: 'info', code: 'INTEGRITY_HEALED', message: 'fixed', autoResolved: true });
    const issue = (diag as unknown as { issues: Array<{ code: string; autoResolved?: boolean }> }).issues.find((i) => i.code === 'INTEGRITY_FOCUS_CONFLICT');
    expect(issue?.autoResolved).toBe(true);
  });

  it('a heal that did NOT pass (recorded unresolved) resolves nothing', () => {
    const diag = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', prompt: 'p' } as never);
    diag.record({ phase: 'build', severity: 'warning', code: 'SYNTAX_ERROR_DETECTED', message: 'x', autoResolved: false });
    diag.record({ phase: 'build', severity: 'warning', code: 'SYNTAX_HEALED', message: 'not really', autoResolved: false });
    const issue = (diag as unknown as { issues: Array<{ code: string; autoResolved?: boolean }> }).issues.find((i) => i.code === 'SYNTAX_ERROR_DETECTED');
    expect(issue?.autoResolved).toBe(false);
  });

  it('CENSUS: every heal code the route records is in HEAL_RESOLVES (a new heal cannot forget)', () => {
    const codes = new Set([...route.matchAll(/'([A-Z][A-Z_]*_(?:HEALED|REPAIRED|AUTOFIXED))'/g)].map((m) => m[1]).filter((c) => !/PARTIALLY/.test(c)));
    expect(codes.size).toBeGreaterThan(10);
    const missing = [...codes].filter((c) => !(c in HEAL_RESOLVES));
    expect(missing).toEqual([]);
  });

  it('every code a heal resolves is a code the route really records', () => {
    for (const targets of Object.values(HEAL_RESOLVES)) {
      for (const t of targets) expect(route.includes(`'${t}'`), t).toBe(true);
    }
  });
});

// ── 5 · our engine's read efficiency is not a finding about the app ───────────────────────────────────
describe('5 · REPEATED_READS no longer holds a working app at YELLOW', () => {
  it('🔴 the report: REPEATED_READS, WORKSPACE_SCAN_FAILED and EMPTY_BUILD_RETRY are process-only', () => {
    for (const code of ['REPEATED_READS', 'WORKSPACE_SCAN_FAILED', 'EMPTY_BUILD_RETRY']) {
      expect(isAppFinding({ phase: 'build', code }), code).toBe(false);
    }
    expect(isAppFinding({ phase: 'build', code: 'CSS_CLASSES_UNDEFINED' })).toBe(true);
  });
  it('…and none of them is offered to the user as a next step', () => {
    const src = readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8');
    for (const code of ['REPEATED_READS', 'WORKSPACE_SCAN_FAILED', 'EMPTY_BUILD_RETRY']) expect(src).toContain(`'${code}'`);
  });
});

// ── 6 · vite-env: the sandbox is asked before a file is called missing ────────────────────────────────
describe('6 · the vite-env pass does not claim TypeScript complained', () => {
  it('🔴 the report: the note says what WOULD happen, not that tsc reported it (tsc was clean)', () => {
    expect(viteEnvTypesNote()).toMatch(/would report/);
    expect(viteEnvTypesNote()).not.toMatch(/TypeScript reported/);
  });
  it('the integrity pass reads src/vite-env.d.ts and tsconfig.json from the sandbox when the durable map lacks them (source guard)', () => {
    const line = route.split('\n').find((l) => l.includes("for (const p of ['src/main.tsx', 'src/main.jsx'")) ?? '';
    expect(line).toContain("'src/vite-env.d.ts'");
    expect(line).toContain("'tsconfig.json'");
  });
});

// ── 7 · the explorers read Hindi ──────────────────────────────────────────────────────────────────────
describe('7 · "Itihaas saaf karein" is never pressed', () => {
  it('🔴 the report: the clear-history button the explorer pressed', () => {
    expect(NEVER_PRESS.test('Itihaas saaf karein')).toBe(true);
  });
  it('Hinglish and Devanagari destroy / pay / send words', () => {
    for (const label of ['Data hatayein', 'hatao', 'Sab mitao', 'Khali karo', 'Radd karein', 'Bhugtan karein', 'Message bhejein',
      'Abhi kharidein', 'Delete karo', 'Logout karein', 'हटाएं', 'इतिहास साफ़ करें', 'भुगतान करें', 'रद्द करें']) {
      expect(NEVER_PRESS.test(label), label).toBe(true);
    }
  });
  it('PRECISION: the report’s own safe controls are still pressed', () => {
    for (const label of ['Chat', 'Data', 'Analysis', 'What is COACT?', 'How do I use this service?', 'Data joden', 'Saaf', 'Hataka', 'Search', 'History']) {
      expect(NEVER_PRESS.test(label), label).toBe(false);
    }
  });
  it('"Data joden" is a WRITE verb (refused only when the app writes to the user’s own database)', () => {
    expect(WRITE_VERBS.test('Data joden')).toBe(true);
    expect(WRITE_VERBS.test('Chat')).toBe(false);
  });
  it('the sign-in explorer’s list reads the same words, and the page script carries it', () => {
    expect(SIGN_IN_NEVER.test('Itihaas saaf karein')).toBe(true);
    expect(SIGN_IN_NEVER.test('/logout')).toBe(true);
    expect(SIGN_IN_NEVER.test('/orders')).toBe(false);
    const line = signInModule({}).split('\n').find((l) => l.includes('const NEVER')) ?? '';
    expect(line).toContain('saa?f');
    const re = new Function(`return ${line.replace('const NEVER = ', '').replace(/;$/, '')}`)() as RegExp;
    expect(re.test('Sab hatao')).toBe(true);
  });
});

// ── 8 · our starter e2e suite is not the app's dependency or env var ──────────────────────────────────
describe('8 · evaluate leaves our starter e2e suite out of the app’s counts', () => {
  const config = "// Auto-generated Playwright E2E config (NavBharatAI).\nimport { defineConfig } from '@playwright/test';\nconst base = process.env.E2E_BASE_URL || 'http://localhost:5173';\nexport default defineConfig({ use: { baseURL: base } });\n";
  it('🔴 the report: E2E_BASE_URL from our playwright.config.ts is not an app env var', () => {
    const d = mk(new FakeActuator()) as unknown as { collectEnvRefs(s: Array<{ path: string; content: string }>): string[] };
    const refs = d.collectEnvRefs([
      { path: 'playwright.config.ts', content: config },
      { path: 'src/api/chatApi.ts', content: 'const u = import.meta.env.VITE_COACT_API_URL;' },
    ]);
    expect(refs).toContain('VITE_COACT_API_URL');
    expect(refs).not.toContain('E2E_BASE_URL');
  });
  it('🔴 the report: @playwright/test imported by our scaffold is not a missing dependency', async () => {
    const act = new FakeActuator();
    act.files.set('playwright.config.ts', config);
    act.files.set('e2e/smoke.spec.ts', '// Auto-generated smoke E2E for app\nimport { test } from "@playwright/test";');
    act.files.set('e2e/mine.spec.ts', 'import { test } from "@playwright/test";'); // the USER's own suite stays counted
    const d = mk(act) as unknown as { platformE2eFiles(p: string[]): Promise<Set<string>> };
    const ours = await d.platformE2eFiles(['playwright.config.ts', 'e2e/smoke.spec.ts', 'e2e/mine.spec.ts', 'src/App.tsx']);
    expect([...ours].sort()).toEqual(['e2e/smoke.spec.ts', 'playwright.config.ts']);
  });
});

// ── 9 · the ETA says where the build is ───────────────────────────────────────────────────────────────
describe('9 · the ETA line in the final checks, and after a hand-off', () => {
  it('🔴 the report: at minute 12, inside the final checks, the line promises no minutes', () => {
    const line = finalChecksEtaLine(12 * 60_000);
    expect(line).toMatch(/your app is built — running the final checks/);
    expect(line).not.toMatch(/to go|more to go/);
  });
  it('the route switches to it at the post-answer pass, before any measured countdown (source guard)', () => {
    const set = route.indexOf('etaFinalChecks = true;');
    const post = route.indexOf('const integrityStartedAt = Date.now();');
    expect(set).toBeGreaterThan(post);
    expect(set - post).toBeLessThan(200);
    const check = route.indexOf('if (etaFinalChecks) {');
    const measured = route.indexOf('const measured = measuredRemainingMs(');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(measured);
  });
  it('🔴 the report: a hand-off forgets the lane’s file plan ("9 of 10 files" counted a list nobody followed)', () => {
    const at = route.indexOf("code: sb.ok ? 'SIMPLE_BUILD_SUCCESS'");
    const reset = route.indexOf('if (!sb.ok) { etaPlannedFiles = 0; etaFirstFileAt = 0; }', at);
    expect(reset).toBeGreaterThan(at);
    expect(reset - at).toBeLessThan(800);
  });
});

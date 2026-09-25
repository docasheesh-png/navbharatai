/**
 * AUTOPSY 2a7fa4b0 + ea07382a (2026-09-25) — an ordinary expense tracker, two builds, ₹291, and the
 * search, sort, report and backup the user asked for in the FIRST sentence still missing at the end.
 *
 * Six defects, every one of them ours, each locked here against the real input that exposed it:
 *
 *   1. SCOPE — "App to add expenses with date, category, amount, payment method like cash card UPI,
 *      search and sort, total amount and report generation. Backup and restore option too" counted 8
 *      features (four of them the COLUMNS of an expense) and "expenses" missed the singular-only small-
 *      app hint, so the build was split into a six-step mega roadmap and delivered step 1.
 *   2. ROADMAP — "a real-time search input" was badged as needing a server.
 *   3. DESIGN — an Add Expense FORM was "a list with no empty state" because of
 *      `PAYMENT_METHODS.map(… <option>)`, and a 120 s repair added a list to the form to satisfy it.
 *   4. READ LOOP — three reads of three DIFFERENT line ranges were each told "STOP … byte-for-byte what
 *      you already have", and the report then said no STOP had been issued (the sub-agent's count was
 *      never shared), and called re-reads after real changes "a file that had not changed".
 *   5. SUB-AGENT — "Done. I built … New files created: …" with zero files written, handed to the
 *      parent as the task's result.
 *   6. JOURNEY — the platform's own journey script contains 'vite-error-overlay', so the command was
 *      classified as a Vite DEV SERVER START: its output went into the dev server's log and the preview
 *      port was stopped. Every journey came back "none of the form fields were present".
 */
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';
import { roadmapGuardrail } from '../src/server/lib/megaRoadmap';
import { analyzePage, rendersDataList } from '../src/server/AgentV3/DesignCoverage';
import { rendersList, journeyScript } from '../src/server/AgentV3/journeyDerivation';
import { isLongRunningCommand, withoutHeredocBodies } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { ToolDispatcher, taskResultWithWrites, readLedgerPath, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { repeatedReadSummary } from '../src/server/AgentV3/repeatedReads';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const THE_PROMPT =
  'App to add expenses with date, category, amount, payment method like cash card UPI, search and sort, total amount and report generation. Backup and restore option too';

describe('1 · an expense tracker is an ordinary app', () => {
  it('the real prompt is built in one pass, not split into a roadmap', () => {
    expect(analyzeAppScope(THE_PROMPT).decision).toBe('direct');
  });

  it('the columns of one record are not features of the app', () => {
    expect(countEnumeratedFeatures(THE_PROMPT)).toBeLessThan(8);
    expect(countEnumeratedFeatures('Invoice app with name, email, phone, address, amount, due date, status')).toBe(0);
  });

  it('module lists keep their count — the project gates still see an ERP', () => {
    expect(countEnumeratedFeatures('school ERP with students, teachers, attendance, fees, exams, timetable, library, transport')).toBeGreaterThanOrEqual(8);
  });

  it('the small-app hint reads plurals, and is held back when big software is named', () => {
    expect(analyzeAppScope('App to track expenses with search, sort, filters, charts, export, import, reminders, backup, restore').decision).toBe('direct');
    expect(analyzeAppScope('ERP with invoices, forms, payroll, inventory, attendance, purchase orders, vendors, GST filing, reports').decision).toBe('analyze');
  });

  it('a UPI payment METHOD is not a fintech product — no KYC or 2FA pushed into an expense tracker', () => {
    expect(analyzeRequirementGaps(THE_PROMPT).domain).not.toBe('fintech');
    expect(analyzeRequirementGaps('UPI payment app with wallet, bank transfer and KYC').domain).toBe('fintech');
  });
});

describe('2 · real-time between people is infrastructure; real-time in one browser is not', () => {
  const step = (title: string, buildPrompt: string) => ({ title, goal: `goal of ${title}`, buildPrompt, needsInfra: null });
  it('a search box that filters as you type is not badged as needing a server', () => {
    const { roadmap } = roadmapGuardrail({
      achievableSummary: 's', note: null,
      steps: [
        step('Add and view expenses', 'Create a form and a list with localStorage persistence.'),
        step('Search and sort expenses', 'Add a real-time search input that filters expenses as the user types.'),
        step('Group chat', 'Add real-time chat between users of the app.'),
      ],
    }, null);
    expect(roadmap?.steps.map((s) => s.infraCeiling)).toEqual([false, false, true]);
  });
});

describe('3 · a dropdown is not a list that can be empty', () => {
  const FORM = `import { PAYMENT_METHODS } from '../lib/expenses';
export default function AddExpenseScreen() {
  return (
    <div className="screen">
      <h1 className="page-header">Add expense</h1>
      <form className="card form-card">
        <label className="field">Date<input type="date" /></label>
        <label className="field">Category<input /></label>
        <label className="field">Amount<input type="number" /></label>
        <label className="field">Payment method
          <select>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <button className="btn-primary">Save</button>
      </form>
    </div>
  );
}`;
  it('the real form page is not reported as a list without an empty state', () => {
    expect(rendersDataList(FORM)).toBe(false);
    expect(analyzePage('src/screens/AddExpenseScreen.tsx', FORM)?.defects ?? []).not.toContain('LIST_WITHOUT_EMPTY_STATE');
    expect(rendersList(FORM)).toBe(false);
  });

  it('a list of the user’s DATA still needs its empty state', () => {
    const LIST = FORM.replace('</form>', '</form><ul>{expenses.map((e) => <li key={e.id}>{e.category}</li>)}</ul>');
    expect(rendersDataList(LIST)).toBe(true);
    expect(analyzePage('src/screens/AddExpenseScreen.tsx', LIST)?.defects).toContain('LIST_WITHOUT_EMPTY_STATE');
    expect(rendersDataList(`{['a', 'b'].map((x) => <span>{x}</span>)}`)).toBe(false);
  });
});

describe('6 · the text a command writes into a file is not a command', () => {
  it('the platform’s own journey check is not mistaken for starting a dev server', () => {
    const cmd = journeyScript('https://5173-abc.e2b.app', [
      { id: 'create-persists:src/App.tsx', kind: 'create-persists', route: '/', fields: [], submit: null },
    ] as never, 'NBAI-x');
    expect(cmd).toContain('vite-error-overlay'); // the string that used to trip the classifier
    expect(isLongRunningCommand(cmd)).toBe(false);
  });

  it('a README written through a heredoc does not start (or kill) a dev server', () => {
    expect(isLongRunningCommand("cat > README.md <<'EOF'\nRun `npm run dev` to start.\nEOF")).toBe(false);
  });

  it('a real dev-server start is still one — before, after, or without a heredoc', () => {
    expect(isLongRunningCommand('npm run dev')).toBe(true);
    expect(isLongRunningCommand('cat > note.txt <<EOF && npm run dev\nhello\nEOF')).toBe(true);
    expect(withoutHeredocBodies("cat > a <<-\"X\"\nvite\nX\necho done")).toBe('cat > a <<-"X"\necho done');
  });
});

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
const read = (d: ToolDispatcher, input: Record<string, unknown>, id: string) =>
  d.dispatch({ id, name: 'read_file', input }, 'frontend').then((r) => String(r.content));

describe('4 · a slice is not the file, and the report counts what really happened', () => {
  const CSS = Array.from({ length: 359 }, (_, i) => `.rule-${i} { color: red; }`).join('\n');

  it('reading different line ranges of one file is never told STOP', async () => {
    const act = new FakeActuator();
    act.files.set('src/index.css', CSS);
    const d = mk(act);
    await read(d, { path: 'src/index.css' }, 'r1');
    for (const [a, b, id] of [[1, 300, 'r2'], [300, 359, 'r3'], [40, 220, 'r4'], [220, 300, 'r5']] as const) {
      const out = await read(d, { path: 'src/index.css', start_line: a, end_line: b }, id);
      expect(out).not.toMatch(/STOP —|NOTE — you have now read/);
    }
    expect(d.readLoopStops()).toBe(0);
  });

  it('the SAME slice read again is still a repeat', async () => {
    const act = new FakeActuator();
    act.files.set('src/index.css', CSS);
    const d = mk(act);
    await read(d, { path: 'src/index.css', start_line: 1, end_line: 50 }, 'a');
    expect(await read(d, { path: 'src/index.css', start_line: 1, end_line: 50 }, 'b')).toMatch(/NOTE — you have now read src\/index\.css \(lines 1-50\) the second time/);
  });

  it('ranges fold back into their file for the report, and only unchanged re-reads are called waste', async () => {
    const act = new FakeActuator();
    act.files.set('src/index.css', CSS);
    const d = mk(act);
    await read(d, { path: 'src/index.css' }, 'a');
    await read(d, { path: 'src/index.css', start_line: 1, end_line: 50 }, 'b');
    await read(d, { path: 'src/index.css', start_line: 51, end_line: 99 }, 'c');
    expect(d.readLedgerCounts().get('src/index.css')).toBe(3);
    expect(d.readLedgerUnchangedRereads().get('src/index.css')).toBe(0);
    expect(readLedgerPath('src/index.css#L1-50')).toBe('src/index.css');
    expect(readLedgerPath('weird#Lname.ts')).toBe('weird#Lname.ts');
  });

  it('the finding says nothing when the re-reads all followed real changes', () => {
    const reads = new Map([['src/App.tsx', 6], ['src/index.css', 10]]);
    expect(repeatedReadSummary(reads, new Map([['src/App.tsx', 0], ['src/index.css', 1]]))).toBe('');
    expect(repeatedReadSummary(reads, new Map([['src/App.tsx', 3], ['src/index.css', 4]]))).toMatch(/7 of them .* re-read a file that had not changed/);
  });

  it('a sub-agent’s STOP notices are counted in the parent’s number', async () => {
    const act = new FakeActuator();
    act.files.set('a.ts', 'export {}');
    const parent = mk(act);
    const child = mk(act);
    child.shareReadLoopStops(parent.sharedReadLoopStops());
    for (let i = 0; i < 5; i++) await read(child, { path: 'a.ts' }, `c${i}`);
    expect(child.readLoopStops()).toBeGreaterThan(0);
    expect(parent.readLoopStops()).toBe(child.readLoopStops());
  });
});

describe('5 · a sub-agent’s claim travels with the platform’s count of what it wrote', () => {
  it('"Done, files created" with nothing written is flagged in the same result', () => {
    const out = taskResultWithWrites('frontend', { ok: true, summary: 'Done. New files created: BottomNav.tsx', written: [] });
    expect(out).toContain('Done. New files created');
    expect(out).toContain('this agent wrote NO files');
  });

  it('real writes are named; an unknown is never printed as "nothing"', () => {
    expect(taskResultWithWrites('frontend', { ok: true, summary: 'ok', written: ['src/App.tsx', 'src/nav.tsx'] }))
      .toContain('files this agent actually wrote (2): src/App.tsx, src/nav.tsx');
    expect(taskResultWithWrites('frontend', { ok: true, summary: 'ok' })).toBe('[frontend] ok');
    expect(taskResultWithWrites('frontend', { ok: false, summary: 'boom', written: [] })).toMatch(/^\[frontend\] FAILED: boom/);
  });

  it('the dispatcher records what IT wrote, through the one durable-write door', async () => {
    const act = new FakeActuator();
    const d = mk(act);
    await d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/x.ts', content: 'export const x = 1;\n' } }, 'frontend');
    expect(d.writtenPaths()).toContain('src/x.ts');
    expect(mk(act).writtenPaths()).toEqual([]);
  });
});

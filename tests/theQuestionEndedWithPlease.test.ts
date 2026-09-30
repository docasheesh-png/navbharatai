/**
 * Autopsy e6d46cde (2026-09-30) — "एक ऐप बनाओटेलीनॉर", Weak tier, 7.1 min, green, billed ₹115.33.
 *
 *  1. The model's first reply was a QUESTION ending in "…तो बता दीजिए। 🙏". The ask detector only read a
 *     question mark at the very end of the last line, so it saw a stall, nudged the model to build, and
 *     the nudge left no line in the report.
 *  2. The user then answered mid-build ("Archer Ai"); the engine delivered it as "fold this in", and
 *     the model never acted on it or mentioned it.
 *  3. Nine classes the screens used had no rule in any stylesheet, and Plans.tsx listed plans with no
 *     empty state. Both were found only after the app was done, and fixed by a 100-second repair pass.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { turnAskedTheUser, decideBuildNudge } from '../src/server/AgentV3/nudgeToBuild';
import { liveUserMessageTurn } from '../src/server/AgentV3/AgentRunner';
import { undefinedClassWriteNote } from '../src/server/AgentV3/CssConsistency';
import { pageDesignWriteNote, WRITE_TIME_DESIGN_DEFECTS } from '../src/server/AgentV3/DesignCoverage';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const code = (rel: string): string =>
  readFileSync(rel, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// The model's first reply in that build, verbatim.
const THE_REPLY = `नमस्ते! 👋

मैं आपके लिए एक **TeleNor-style टेलीकॉम ऐप** बना सकता हूँ — जैसे मोबाइल रिचार्ज, प्लान और उपयोग देखने वाला ऐप।

मैं यह समझकर शुरू करूँ:

1. **रिचार्ज प्लान** — डेटा, कॉल, SMS पैक की लिस्ट
2. **डैशबोर्ड** — बैलेंस, बचा हुआ डेटा, वैधता
3. **रिचार्ज हिस्ट्री** — पिछले रिचार्ज और पेमेंट स्टेटस

क्या आप इसी तरह का ऐप चाहते हैं? अगर आपके मन में कुछ और है — जैसे SIM खरीदना, कस्टमर सपोर्ट, या कोई खास फीचर — तो बता दीजिए। 🙏`;

describe('1 · a question followed by "please tell me" is a question', () => {
  it('🔴 the report\'s reply is an ask, so the nudge stands down', () => {
    expect(turnAskedTheUser(THE_REPLY)).toBe(true);
    const d = decideBuildNudge({ text: THE_REPLY, expectsArtifacts: true, totalToolUses: 0, nudgesUsed: 0, maxNudges: 2, editingExistingApp: false });
    expect(d.nudge).toBe(false);
    expect(d.standDown).toBe('asked-the-user');
  });

  it('a courtesy emoji after the question mark does not hide it', () => {
    expect(turnAskedTheUser('Shall I continue? 🙏')).toBe(true);
    expect(turnAskedTheUser('Should I use a dark theme? 😊✨')).toBe(true);
  });

  it('a last line that is only the invitation, after a question, counts', () => {
    expect(turnAskedTheUser('Which layout would you prefer?\nLet me know!')).toBe(true);
    expect(turnAskedTheUser('कौन सा रंग चाहिए?\nबताइए 🙏')).toBe(true);
    expect(turnAskedTheUser('kaunsa app chahiye? bata dijiye')).toBe(true);
  });

  it('🔒 a stall is still a stall: what follows the question is an intent, or there is no question', () => {
    expect(turnAskedTheUser('Ready? Let\'s build it.')).toBe(false);
    expect(turnAskedTheUser("I'll build the app now — let me know if you want changes!")).toBe(false);
    expect(turnAskedTheUser('Here is my plan.\nLet me know!')).toBe(false);
    expect(turnAskedTheUser('Which layout would you prefer?\n\nI will use the grid.')).toBe(false);
    expect(turnAskedTheUser('Done. 🎉')).toBe(false);
  });

  it('🔒 a nudge that fires is recorded before it is counted', () => {
    const runner = code('src/server/AgentV3/AgentRunner.ts');
    const at = runner.indexOf("code: 'BUILD_NUDGED'");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(runner.indexOf('noBuildNudges++'));
  });
});

describe('2 · a message the user sends during the build is owed an answer', () => {
  it('the turn says act on it, build to it if it answers a question, and account for it', () => {
    const t = liveUserMessageTurn('Archer Ai');
    expect(t).toMatch(/Act on it now/);
    expect(t).toMatch(/If it answers a question you asked, build to that answer/);
    expect(t).toMatch(/say in one line how you read it/);
    expect(t).toMatch(/final reply must say what you did about it/);
    expect(t.endsWith('\nArcher Ai')).toBe(true);
  });

  it('🔒 the runner builds that turn from the one function', () => {
    const runner = code('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toContain("messages.push({ role: 'user', content: liveUserMessageTurn(sm) });");
    expect(runner).not.toContain('Fold this into the current work');
  });
});

// The report's app, reduced: four screens using nine classes the stylesheet never defined.
const SHEET = `.home-card { padding: 16px; } .plan-card { padding: 16px; } .history-card { padding: 12px; }
.menu-item { display: flex; } .category-tabs { display: flex; } .nb-empty { padding: 24px; }`;
const HOME = `export default function Home() { return (<main className="home-card"><div className="quick-actions"><button className="btn btn-sm">Go</button></div><section className="usage-section">x</section></main>); }`;
const HISTORY = `export default function RechargeHistory() { return (<div className="history-card"><span className="status-success">ok</span><span className="status-warning">p</span><span className="status-danger">f</span><div className="history-info">i</div></div>); }`;
const PROFILE = `export default function Profile() { return (<div className="menu-item"><span className="menu-label">x</span><button className="btn btn-danger">Log out</button></div>); }`;

describe('3 · classes no stylesheet defines are named while the model is still writing', () => {
  const project = { 'src/index.css': SHEET, 'src/pages/Home.tsx': HOME, 'src/pages/RechargeHistory.tsx': HISTORY, 'src/pages/Profile.tsx': PROFILE };

  it('🔴 a stylesheet write names every screen\'s missing class — the report\'s nine', () => {
    const note = undefinedClassWriteNote({ 'src/index.css': SHEET }, project);
    for (const c of ['btn-danger', 'btn-sm', 'history-info', 'menu-label', 'quick-actions', 'status-danger', 'status-success', 'status-warning', 'usage-section']) {
      expect(note).toContain(`.${c}`);
    }
    expect(note).toMatch(/still have no rule in any stylesheet/);
  });

  it('a screen write names only that screen\'s own missing classes', () => {
    const note = undefinedClassWriteNote({ 'src/pages/Profile.tsx': PROFILE }, project);
    expect(note).toContain('.menu-label');
    expect(note).toContain('.btn-danger');
    expect(note).not.toContain('.status-success');
  });

  it('says nothing when everything is defined, for kit classes, and for Tailwind', () => {
    // `.btn` too: since #3410 a single-word class ("btn", "price", "header") counts as custom, so a sheet that
    // claims to define everything the page uses must define it — the kit does; this fixture stands in for it.
    const full = `${SHEET} .quick-actions{} .btn-sm{} .usage-section{} .status-success{} .status-warning{} .status-danger{} .history-info{} .menu-label{} .btn-danger{} .btn{}`;
    expect(undefinedClassWriteNote({ 'src/index.css': full }, project)).toBe('');
    expect(undefinedClassWriteNote({ 'src/pages/A.tsx': '<div className="nb-made-up nb-other">x</div>' }, { 'src/index.css': SHEET })).toBe('');
    expect(undefinedClassWriteNote({ 'src/pages/A.tsx': HOME }, { 'src/index.css': '@tailwind base;' })).toBe('');
  });
});

const PLANS = `import { useState } from 'react';
import { plans } from '../data/plans';
export default function Plans() {
  const [tab, setTab] = useState('all');
  const shown = plans.filter((p) => tab === 'all' || p.kind === tab);
  return (
    <main className="container">
      <h1>Plans</h1>
      <div className="category-tabs"><button className="btn" onClick={() => setTab('all')}>All</button></div>
      <div className="stack">{shown.map((p) => (<article className="plan-card" key={p.id}><h3>{p.name}</h3><p className="muted">{p.price}</p></article>))}</div>
    </main>
  );
}`;

describe('4 · a page\'s own design defects are named when it is written', () => {
  it('🔴 a filtered list with no empty state is named, with the fix', () => {
    const note = pageDesignWriteNote({ 'src/pages/Plans.tsx': PLANS }, { 'src/data/plans.ts': 'export function load() { return []; }' });
    expect(note).toMatch(/Design check on src\/pages\/Plans\.tsx/);
    expect(note).toMatch(/no empty state/);
    expect(note).toMatch(/nb-empty/);
  });

  it('with the empty state written, nothing is said', () => {
    const fixed = PLANS.replace('<div className="stack">', '{shown.length === 0 && <div className="nb-empty">No plans here</div>}<div className="stack">');
    expect(pageDesignWriteNote({ 'src/pages/Plans.tsx': fixed })).toBe('');
  });

  it('never tells a page to add a heading at write time — a layout may already own it', () => {
    expect(WRITE_TIME_DESIGN_DEFECTS.has('NO_HEADING')).toBe(false);
    const noHeading = PLANS.replace('<h1>Plans</h1>', '');
    expect(pageDesignWriteNote({ 'src/pages/Plans.tsx': noHeading })).not.toMatch(/heading/);
  });

  it('a leaf component is not a page', () => {
    expect(pageDesignWriteNote({ 'src/components/PlanList.tsx': PLANS })).toBe('');
  });
});

describe('5 · the write door says both, from one read of the project', () => {
  class Act implements ActuatorPort {
    files = new Map<string, string>([
      ['src/index.css', SHEET],
      ['src/pages/Home.tsx', HOME],
      ['src/data/plans.ts', 'export async function load() { return []; }'],
    ]);
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }

  it('writing the report\'s Plans page returns the design note', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-style', new WorkspaceState(stream), stream);
    const out = await d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/pages/Plans.tsx', content: PLANS } }, 'architect');
    expect(String(out.content)).toMatch(/Design check on src\/pages\/Plans\.tsx/);
  });

  it('editing the stylesheet names the classes the screens still lack', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-style', new WorkspaceState(stream), stream);
    const out = await d.dispatch({ id: 'w2', name: 'write_file', input: { path: 'src/index.css', content: `${SHEET}\n.quick-actions { display: flex; }` } }, 'architect');
    const text = String(out.content);
    expect(text).toMatch(/still have no rule in any stylesheet/);
    expect(text).toContain('.btn-sm');
    expect(text).not.toContain('.quick-actions,');
  });

  it('🔒 the kill switch stops both', async () => {
    const prev = process.env.AGENTV3_WRITE_QUALITY;
    process.env.AGENTV3_WRITE_QUALITY = 'off';
    try {
      const stream = new AgentEventStream();
      const d = new ToolDispatcher(new Act(), 'ws-style', new WorkspaceState(stream), stream);
      const out = await d.dispatch({ id: 'w3', name: 'write_file', input: { path: 'src/pages/Plans.tsx', content: PLANS } }, 'architect');
      expect(String(out.content)).not.toMatch(/Design check|Style check/);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_WRITE_QUALITY; else process.env.AGENTV3_WRITE_QUALITY = prev;
    }
  });
});

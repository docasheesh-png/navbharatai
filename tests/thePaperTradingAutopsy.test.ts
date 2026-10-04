/**
 * Autopsy 241215d1 (2026-10-04): a paper-trading app for NSE/BSE. Build 1 was stopped by the user;
 * build 2 ("Continue from where you left off…") ran 17 minutes and was graded RED. Each block locks one
 * class found in that report (the verbatim first request is `fixtures/autopsy241215d1.prompt.txt`):
 *   1. a pip install naming `uvicorn` was run as a dev-server launch (port 8000 health-check noise);
 *   2. a backgrounded `python server.py &` held the command pipe for the full 300 s timeout;
 *   3. `curl http://localhost:8000` was governed as "an outbound fetch to an external host";
 *   4. the stock-market app was classified as ecommerce, and its "portfolio" read as a gallery;
 *   5. the end-of-build checks graded the 86-character "continue" message, not the request it continued;
 *   6. a dist-only snapshot was saved for an app whose API is a Python server;
 *   7. the journey typed its marker into a ticker field, and the gate called a working app unshippable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { isLongRunningCommand, detachBackgroundJobs, BACKGROUND_JOB_LOG } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { classifyCommandRisk } from '../src/server/AgentV3/CommandGovernance';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { requestedFeatureLabels } from '../src/server/AgentV3/RequirementCoverage';
import { planningRequest } from '../src/server/AgentV3/planningRequest';
import { requestForChecks } from '../src/server/AgentV3/requestForChecks';
import { snapshotSuitable } from '../src/server/AgentV3/previewSnapshot';
import { deriveJourneys, lookupKeyExample, valueForInput } from '../src/server/AgentV3/journeyDerivation';

const PROMPT = readFileSync(join(__dirname, 'fixtures/autopsy241215d1.prompt.txt'), 'utf8');
const CONTINUE = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';
const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const DISPATCHER = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

describe('1 · an installer that names a server is still an installer', () => {
  it('the report commands are one-shot', () => {
    expect(isLongRunningCommand('pip install --user fastapi uvicorn pydantic pandas aiohttp 2>&1 | tail -5')).toBe(false);
    expect(isLongRunningCommand('python3 -m venv .venv && . .venv/bin/activate && pip install fastapi uvicorn pydantic pandas aiohttp 2>&1 | tail -5')).toBe(false);
  });
  it('siblings: other installers, and `python3-dev` through the bare `dev` rule', () => {
    for (const c of [
      'pip3 install gunicorn flask',
      'python -m pip install uvicorn',
      'uv pip install uvicorn',
      'poetry add uvicorn',
      'apt-get install -y python3-dev',
      'sudo apt install python3-dev',
      'conda install flask',
    ]) expect(isLongRunningCommand(c), c).toBe(false);
  });
  it('the servers themselves are still managed', () => {
    for (const c of ['uvicorn server.api:app --host 0.0.0.0 --port 8000', 'gunicorn app:app', 'flask run', 'npm run dev', 'uv run uvicorn main:app'])
      expect(isLongRunningCommand(c), c).toBe(true);
  });
});

describe('2 · a backgrounded job never holds the command pipe', () => {
  const REPORT = '. .venv/bin/activate && python start_backend.py &\nsleep 3\ncurl -s http://localhost:8000/health';

  it('the report command is detached and the probes after it are kept', () => {
    const r = detachBackgroundJobs(REPORT);
    expect(r.detached).toBe(1);
    expect(r.command).toBe(
      `nohup bash -c '. .venv/bin/activate && python start_backend.py' > ${BACKGROUND_JOB_LOG} 2>&1 < /dev/null &\nsleep 3\ncurl -s http://localhost:8000/health`,
    );
  });

  it('it really returns: the original waits for the job, the rewrite does not', () => {
    const original = 'sleep 3 &\necho done';
    const t0 = Date.now();
    execFileSync('bash', ['-c', original], { stdio: ['ignore', 'pipe', 'pipe'] });
    const held = Date.now() - t0;
    const t1 = Date.now();
    const out = execFileSync('bash', ['-c', detachBackgroundJobs(original).command], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const freed = Date.now() - t1;
    expect(held).toBeGreaterThanOrEqual(2800);
    expect(freed).toBeLessThan(1500);
    expect(out).toContain('done');
  }, 15_000);

  it('a job that already redirects both streams, a chain, a redirect and shell grammar are left as written', () => {
    for (const c of [
      'nohup python start_backend.py > backend.log 2>&1 &',
      'python app.py &> app.log &',
      'npm run build && npm test',
      'node x.js 2>&1 | tail -5',
      'echo "a & b"',
      'for i in 1 2; do sleep 1 & done',
      'if true; then sleep 1 & fi',
      '(python app.py &)',
      "cat > run.sh <<'EOF'\npython app.py &\nEOF",
      'npm test',
    ]) expect(detachBackgroundJobs(c), c).toEqual({ command: c, detached: 0 });
  });

  it('a quote inside the job survives', () => {
    const r = detachBackgroundJobs(`python -c 'print("hi")' &`);
    expect(r.detached).toBe(1);
    const out = execFileSync('bash', ['-c', `${r.command}\nsleep 1; cat ${BACKGROUND_JOB_LOG}`]).toString();
    expect(out).toContain('hi');
  });

  it('the bash tool runs model commands through it, and leaves a dev-server launch to the managed boot', () => {
    expect(DISPATCHER).toMatch(/isLongRunningCommand\(effectiveCommand\)\s*\?\s*\{ command: effectiveCommand, detached: 0 \}\s*:\s*detachBackgroundJobs\(effectiveCommand\)/);
    expect(DISPATCHER).toContain('this.actuator.runCommand(this.workspaceId, background.command)');
  });
});

describe('3 · the app\'s own server is not an external host', () => {
  it('loopback is not governed as outbound', () => {
    for (const c of ['curl -s http://localhost:8000/health', 'curl -s -X POST http://127.0.0.1:8000/api/orders -d {}', 'wget http://0.0.0.0:5173/'])
      expect(classifyCommandRisk(c).level, c).toBe('none');
  });
  it('a real outside host still is, even next to a local one', () => {
    for (const c of ['curl https://example.com/x', 'curl http://localhost:1 && curl https://evil.io', 'curl http://localhost.evil.com/x'])
      expect(classifyCommandRisk(c).reasons, c).toContain('outbound network fetch to an external host');
  });
});

describe('4 · a stock-market app is not a shop, and its portfolio is not a gallery', () => {
  it('the report prompt is a trading app', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('trading');
    expect(analyzeRequirementGaps('build a stock market paper trading simulator for nifty').domain).toBe('trading');
  });
  it('shops, inventory and restaurants keep their domains', () => {
    expect(analyzeRequirementGaps('an online store with cart, checkout, product catalog and inventory').domain).toBe('ecommerce');
    expect(analyzeRequirementGaps('a stock management app with stock in and stock out').domain).toBe('inventory');
    expect(analyzeRequirementGaps('Build a restaurant app with a digital menu, KOT and table billing').domain).toBe('restaurant');
  });
  it('an investment portfolio is not asked-for gallery; a creative portfolio still is', () => {
    expect(requestedFeatureLabels(PROMPT)).not.toContain('gallery / portfolio');
    expect(requestedFeatureLabels('a photographer portfolio website with a gallery')).toContain('gallery / portfolio');
    expect(requestedFeatureLabels('my design portfolio site')).toContain('gallery / portfolio');
  });
});

describe('5 · the checks grade the request a "continue" continues', () => {
  const turns = [{ text: 'build a todo app with search and login', lane: 'build' as const }];

  it('the continue message names nothing of its own', () => {
    expect(requestedFeatureLabels(CONTINUE)).toEqual([]);
  });

  it('it is graded against the earlier request, without our labels', () => {
    const planning = planningRequest({ prompt: CONTINUE, recentTurns: turns, userAppExists: false });
    const checks = requestForChecks(CONTINUE, planning, requestedFeatureLabels(CONTINUE).length);
    expect(checks).toContain('build a todo app with search and login');
    expect(checks).not.toMatch(/\[Earlier in this conversation/);
    expect(requestedFeatureLabels(checks)).toEqual(expect.arrayContaining(['search']));
  });

  it('a message with its own ask, a finished app, or no earlier request keeps the message', () => {
    const own = 'add dark mode';
    expect(requestForChecks(own, planningRequest({ prompt: own, recentTurns: turns, userAppExists: false }), 1)).toBe(own);
    expect(requestForChecks(CONTINUE, planningRequest({ prompt: CONTINUE, recentTurns: turns, userAppExists: true }), 0)).toBe(CONTINUE);
    expect(requestForChecks(CONTINUE, planningRequest({ prompt: CONTINUE, userAppExists: false }), 0)).toBe(CONTINUE);
  });

  it('an attached document is not graded as the request', () => {
    const planning = planningRequest({ prompt: CONTINUE, attachmentText: 'Spec: a blog with comments and a map', recentTurns: turns, userAppExists: false });
    const checks = requestForChecks(CONTINUE, planning, 0);
    expect(checks).toContain('todo app');
    expect(checks).not.toContain('blog with comments');
  });

  it('coverage, the feature probe and the claim audit read it', () => {
    expect(ROUTE).toContain('const checksRequest = requestForChecks(prompt, planning, requestedFeatureLabels(prompt).length);');
    expect(ROUTE).toContain('if (checksRequest !== prompt) dispatcher.setCoverageRequest(checksRequest);');
    expect(ROUTE.match(/checkFeaturePresence\(milestoneRequest \?\? checksRequest,/g)?.length).toBe(4);
    expect(ROUTE).not.toContain('checkFeaturePresence(milestoneRequest ?? prompt,');
    expect(ROUTE).toContain('userRequest: checksRequest,');
    // Siblings: the post-build reviewer and every sub-agent read the same request.
    expect(ROUTE).toContain('userRequest: milestoneRequest ?? checksRequest,');
    expect(ROUTE).toContain('userRequest: () => (checksRequest === prompt ? planning.text : checksRequest),'); // merged with #3475 (planning.text for the specialist)
  });
});

describe('6 · an app whose API is a Python server gets no static copy', () => {
  const pkg = JSON.stringify({ scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18' } });
  it('the report app: Vite front end, FastAPI in server/', () => {
    expect(snapshotSuitable(pkg)).toBe(true); // package.json alone cannot see it
    expect(snapshotSuitable(pkg, {
      'server/api.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
      'requirements.txt': 'fastapi\nuvicorn\n',
      'start_backend.py': 'import uvicorn\n',
    })).toBe(false);
  });
  it('a plain front-end app still gets one', () => {
    expect(snapshotSuitable(pkg, { 'src/App.tsx': 'export default function App() { return <h1>Hi</h1>; }' })).toBe(true);
  });
  it('the route passes the project files', () => {
    expect(ROUTE).toMatch(/snapshotSuitable\(pkgRaw, \{\s*\.\.\.\(await loadWorkspaceFiles\(workspaceId\)/);
  });
});

describe('7 · a field that names an existing thing gets the app\'s own example', () => {
  it('a ticker field takes the placeholder example; a free-text field keeps the marker', () => {
    expect(lookupKeyExample('<input name="symbol" placeholder="e.g. RELIANCE" required />')).toBe('RELIANCE');
    expect(valueForInput('<input name="symbol" placeholder="e.g. RELIANCE" required />', 'nbai-x')).toBe('RELIANCE');
    expect(valueForInput('<input name="title" placeholder="Task name, e.g. Buy milk" />', 'nbai-x')).toBe('nbai-x');
    expect(valueForInput('<input name="symbol" />', 'nbai-x')).toBe('nbai-x');
  });

  it('the order form is submitted with a real ticker and is not a create-and-find journey', () => {
    const app = `import { useState } from 'react';
export default function App() {
  const [orders, setOrders] = useState<{ id: string; symbol: string }[]>([]);
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState(1);
  const handleSubmit = async (e: any) => { e.preventDefault(); const created = await fetch('/api/orders').then((r) => r.json()); setOrders([...orders, created]); };
  return (
    <form onSubmit={handleSubmit} className="card stack">
      <label className="field"><span>Symbol</span>
        <input name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. RELIANCE" required />
      </label>
      <label className="field"><span>Quantity</span>
        <input name="quantity" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
      </label>
      <button type="submit">Place Order</button>
      <table><tbody>{orders.map((o) => <tr key={o.id}><td>{o.symbol}</td></tr>)}</tbody></table>
    </form>
  );
}
`;
    const journeys = deriveJourneys({ files: { 'src/App.tsx': app }, marker: 'nbai-mark-1' });
    expect(journeys.length).toBe(1);
    expect(journeys[0].kind).toBe('form-submit');
    expect(journeys[0].fields.some((f) => f.value === 'RELIANCE')).toBe(true);
    expect(journeys[0].fields.some((f) => f.value.includes('nbai-mark-1'))).toBe(false);
  });
});

describe('8 · the user\'s request is remembered whole, up to what the planner reads', () => {
  it('the request cap is at least the planner\'s, and a long request survives memory', async () => {
    const { REQUEST_EPISODE_MAX, WorkspaceMemory } = await import('../src/server/AgentV3/WorkspaceMemory');
    const { PLANNING_EARLIER_REQUEST_MAX } = await import('../src/server/AgentV3/planningRequest');
    expect(REQUEST_EPISODE_MAX).toBeGreaterThanOrEqual(PLANNING_EARLIER_REQUEST_MAX);
    const mem = new WorkspaceMemory();
    mem.recordRequest(PROMPT, undefined, 'build');
    expect(mem.recentRequestTurns(1)[0].text).toBe(PROMPT);
    expect(PROMPT.length).toBeGreaterThan(2000);
  });
});

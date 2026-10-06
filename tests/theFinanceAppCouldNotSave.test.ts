/**
 * Autopsy e52cebbf + b4745cb1 (2026-10-06) — "Build a personal finance that automatically categories
 * expenses using ai", then "Continue … finish/fix the build so the app works end-to-end". The user stopped
 * both builds. Each describe below locks one CLASS the report showed, not the one instance.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { helperFilesByName, helperOwners, laneAiClient, laneAiNote, LANE_AI_CLIENT_PATH } from '../src/server/AgentV3/SimpleBuilder';
import { tscNeverRan, tscVerdict, salvageTypecheckLine } from '../src/server/AgentV3/TscGate';
import { WRITE_TYPECHECK_NOT_READY_MARKER } from '../src/server/AgentV3/writeTimeTypecheck';
import { previewAiShimSource } from '../src/lib/previewAiProtocol';
import { generateAiIntegration } from '../src/server/lib/AiGenerator';
import { gatewayScriptHtml } from '../src/server/lib/appAiGateway';
import { reflectOnBuild } from '../src/server/AgentV3/Reflection';
import { summarizeSession } from '../src/server/AgentV3/sessionSummary';
import { decideMarkupOnProof } from '../src/server/AgentV3/previewEarnsMarkup';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';
import { findUiElements, type ScannedElement } from '../src/server/AgentV3/UiElementFinder';
import { NO_FAKE_FEATURE_RULE } from '../src/server/AgentV3/noEvalRule';
import type { AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { decideGreenGuard } from '../src/server/AgentV3/GreenGuard';
import { BuildDiagnostics, narrationIsProbeMiss } from '../src/server/AgentV3/BuildDiagnostics';
import { findBrowserAiKeyUse, browserAiKeyWriteNote, isBrowserSource } from '../src/server/AgentV3/browserAiKeyScan';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const route = read('src/server/routes/agentv3.ts');

describe('1 · a helper the plan gave its own file is never given a second home', () => {
  // The real plan of build e52cebbf: one file per helper, and a contract declaring exactly those two.
  const plan = [
    { path: 'src/App.tsx', purpose: 'Main app component' },
    { path: 'src/lib/openai.ts', purpose: 'categorization client' },
    { path: 'src/utils/formatCurrency.ts', purpose: 'Utility for formatting numbers as currency' },
    { path: 'src/utils/formatDate.ts', purpose: 'Utility for formatting dates' },
  ];

  it('each helper is owned by the file named after it — no src/utils.ts is added', () => {
    const owners = helperOwners(plan, ['formatCurrency', 'formatDate'], 'src/types.ts');
    expect(owners.map((o) => [o.path, o.names, o.added])).toEqual([
      ['src/utils/formatCurrency.ts', ['formatCurrency'], false],
      ['src/utils/formatDate.ts', ['formatDate'], false],
    ]);
  });

  it('only the helpers with no named file go to the one shared owner', () => {
    const owners = helperOwners(plan, ['formatCurrency', 'categorizeExpense'], 'src/types.ts');
    expect(owners.find((o) => o.names.includes('formatCurrency'))?.path).toBe('src/utils/formatCurrency.ts');
    const rest = owners.find((o) => o.names.includes('categorizeExpense'));
    expect(rest?.names).toEqual(['categorizeExpense']);
  });

  it('a component, a declaration file or two same-named files never claim a helper', () => {
    expect(helperFilesByName([{ path: 'src/components/formatDate.tsx', purpose: '' }], ['formatDate'], 'src/types.ts').size).toBe(0);
    expect(helperFilesByName([{ path: 'src/formatDate.d.ts', purpose: '' }], ['formatDate'], 'src/types.ts').size).toBe(0);
    expect(helperFilesByName([{ path: 'src/a/formatDate.ts', purpose: '' }, { path: 'src/b/formatDate.ts', purpose: '' }], ['formatDate'], 'src/types.ts').size).toBe(0);
  });

  it('the lane uses the per-helper owners, not one owner for all', () => {
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toContain('for (const owner of helperOwners(manifest, names,');
  });
});

describe('2 · a typecheck that never started is never "no errors"', () => {
  it('the write-time NOT-READY marker is "compiler never ran" in the one shared reader', () => {
    expect(WRITE_TYPECHECK_NOT_READY_MARKER).toBe('NBAI_WRITE_TSC_NOT_READY');
    expect(tscNeverRan(`${WRITE_TYPECHECK_NOT_READY_MARKER}\n`)).toBe(true);
    expect(tscVerdict(WRITE_TYPECHECK_NOT_READY_MARKER)).toBe('not-run');
  });

  it('the salvage line says "could NOT be typechecked" for it, "no errors" only for a real pass', () => {
    expect(salvageTypecheckLine(`${WRITE_TYPECHECK_NOT_READY_MARKER}\n`, 0)).toMatch(/could NOT be typechecked/);
    expect(salvageTypecheckLine('', 0)).toBe('The salvaged files were typechecked before the hand-off: no errors.');
    expect(salvageTypecheckLine('x', 2)).toMatch(/2 error\(s\)/);
  });

  it('the route reads stdout AND stderr and asks the shared reader', () => {
    expect(route).toContain('message: salvageTypecheckLine(tcOut, errs.length)');
    expect(route).toContain("const tcOut = `${String(tc?.stdout ?? '')}\\n${String(tc?.stderr ?? '')}`;");
  });
});

describe('3 · the app\'s AI says "ready" only where it can answer, and never freezes the app', () => {
  const runShim = (topLevel: boolean) => {
    const win: Record<string, unknown> = { addEventListener: () => undefined };
    win.window = win;
    win.top = win;
    win.parent = topLevel ? win : { postMessage: () => undefined };
    runInNewContext(previewAiShimSource(), { window: win, setTimeout, Date, Error, Promise, String });
    return win.NavAI as { available: boolean; ask: (p: string) => Promise<string> };
  };

  it('opened at the top level (the build\'s own verification browser) the assistant is NOT available', async () => {
    const nav = runShim(true);
    expect(nav.available).toBe(false);
    await expect(nav.ask('x')).rejects.toThrow(/inside NavBharatAI/);
  });

  it('inside the NavBharatAI preview frame it is available', () => {
    expect(runShim(false).available).toBe(true);
  });

  it('the ai.ts template honours `available` and bounds every wait', () => {
    const tpl = generateAiIntegration('navbharat').files['src/lib/ai.ts'];
    expect(tpl).toContain('w.NavAI.available !== false');
    expect(tpl).toContain('return withTimeout(b.ask(prompt');
    expect(tpl).toContain('return withTimeout(b.ask(transcript');
  });

  it('a published app\'s ask and image requests carry an abort signal', () => {
    const html = gatewayScriptHtml('app1', 'tok', 'https://example.test');
    expect(html).toContain('signal:S(90000)');
    expect(html).toContain('signal:S(150000)');
  });

  it('every builder is told an AI call must never block saving the user\'s data', () => {
    expect(read('src/server/AgentV3/systemPrompt.ts')).toContain('Never await an AI answer before saving.');
    expect(generateAiIntegration('navbharat').instructions).toContain('save and show their own data FIRST');
    expect(laneAiNote()).toContain('save and show their data first');
  });
});

describe('4 · the fast lane never writes an AI provider client with a key in the page', () => {
  const on = { APP_AI_GATEWAY: 'on' } as unknown as NodeJS.ProcessEnv;
  const prompt = 'Build a personal finance that automatically that categories expenses using ai';

  it('writes NavBharatAI\'s keyless client itself, the same file the recipe writes', () => {
    const f = laneAiClient(prompt, 'vite-react', on);
    expect(f?.path).toBe(LANE_AI_CLIENT_PATH);
    expect(f?.content).toBe(generateAiIntegration('navbharat').files['src/lib/ai.ts']);
  });

  it('nothing is written when the gateway is off, the app names no AI, or it is not a browser app', () => {
    expect(laneAiClient(prompt, 'vite-react', {} as NodeJS.ProcessEnv)).toBeNull();
    expect(laneAiClient('a todo list with categories', 'vite-react', on)).toBeNull();
    expect(laneAiClient(prompt, 'python-fastapi', on)).toBeNull();
  });

  it('every lane call is told not to plan a provider client or touch a key', () => {
    expect(laneAiNote()).toMatch(/Do NOT plan or write any AI provider client/);
    expect(laneAiNote()).toMatch(/never read, store or ask for an API key in browser code/);
    expect(NO_FAKE_FEATURE_RULE).toMatch(/never an API key read, stored or typed in browser code/);
  });
});

describe('5 · a build the user stopped is not a failed build', () => {
  it('the reflection the next build recalls says "stopped", not "failed"', () => {
    const r = reflectOnBuild({ ok: false, summary: '', steps: 31, episodes: [], stoppedByUser: true });
    expect(r.outcome).toBe('stopped');
    expect(r.summary).toMatch(/^Build was stopped by the user after 31 steps/);
    expect(reflectOnBuild({ ok: false, summary: '', steps: 3, episodes: [] }).summary).toMatch(/^Build failed in 3 steps/);
  });

  it('the session count and the prior-failure count leave stopped builds out', () => {
    const s = summarizeSession([{ startedAt: 1, ok: false, userStopped: true }, { startedAt: 2, ok: false }], 3, 4, 50);
    expect(s.failedTurns).toBe(1);
    expect(route).toContain('h.filter((e) => e.ok === false && !isUserStoppedBuild(e))');
    expect(route).toContain("stoppedByUser: abortCauseOf(abort.signal) === 'user-stop',");
  });
});

describe('6 · a stop after the app rendered in a real browser is billed as a working app (admin, Q-727 = b)', () => {
  const facts = { abortCause: 'user-stop' as AbortCause, filesWritten: 12, decidedBilledUsd: 1.4, realCostUsd: 0.34 };

  it('every money site reads ONE fact: the final check OR the ledger\'s in-build green pass', () => {
    expect(route).toContain('const appSeenRunningForBill = buildObs.previewRendered === true || renderProvenNow();');
    expect(route).toContain('previewProven: appSeenRunningForBill,');
    expect(route).toContain('appRendered: appSeenRunningForBill,');
    // The watchdog decides the same build's bill on a long run, so it reads the same ledger.
    expect(route).toContain('previewProven: buildObs.previewRendered === true || (buildDiagRef ? renderProvenInLedger(buildDiagRef.evidenceLedger()) : false),');
    // No money site still reads the final-check flag alone.
    expect(route).not.toMatch(/previewProven: buildObs\.previewRendered === true,/);
    expect(route).not.toMatch(/appRendered: buildObs\.previewRendered === true,\s*\/\/ An unverified EDIT/);
  });

  it('seen running ⇒ the markup is kept and the stop is charged as a working app', () => {
    expect(decideMarkupOnProof({ decidedBilledUsd: 1.4, realCostUsd: 0.34, previewProven: true, expectsArtifacts: true }).billedUsd).toBe(1.4);
    const bill = decideCancelledBuildBill({ ...facts, appRendered: true });
    expect(bill.delivery).toBe('working-app');
    expect(bill.billedUsd).toBe(1.4);
  });

  it('never seen running ⇒ unchanged: margin waived, files-saved rule', () => {
    expect(decideMarkupOnProof({ decidedBilledUsd: 1.4, realCostUsd: 0.34, previewProven: false, expectsArtifacts: true }).billedUsd).toBeCloseTo(0.34);
    expect(decideCancelledBuildBill({ ...facts, decidedBilledUsd: 0.34, appRendered: false }).delivery).toBe('files-saved');
  });
});

describe('7 · asked for an input, the finder returns the input', () => {
  const page: ScannedElement[] = [
    { tag: 'label', text: 'Description', selector: 'label' },
    { tag: 'div', className: 'field', selector: 'div.field' },
    { tag: 'input', id: 'desc', label: 'Description', inputType: 'text', selector: '#desc' },
    { tag: 'input', id: 'amount', label: 'Amount (₹)', inputType: 'number', selector: '#amount' },
  ];

  it('"description input field" → #desc first, never the .field wrapper', () => {
    const hits = findUiElements(page, 'description input field');
    expect(hits[0].element.selector).toBe('#desc');
    expect(hits.some((h) => h.element.selector === 'div.field')).toBe(false);
  });

  it('the browser scan records a control\'s label and type', () => {
    const scan = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(scan).toContain("e.labels&&e.labels[0]&&e.labels[0].textContent");
    expect(scan).toContain('inputType:isCtl?');
  });
});

describe('8 · the green guard does not say "could not be opened" about a stopped, unchanged app (Q-728)', () => {
  const base = { before: { green: true, at: 2_000 }, turnStartedAt: 1_000, after: { green: false }, hasSnapshot: true, provenBroken: false, filesWrittenThisTurn: 14 };

  it('nothing written after the in-build render ⇒ "the saved files are the version that rendered"', () => {
    const d = decideGreenGuard({ ...base, writesAfterGreen: 0, stoppedByUser: true });
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/^Nothing was written after the app rendered earlier in this build/);
    expect(d.reason).not.toMatch(/could not be opened/);
  });

  it('a stop with writes after the render says it was stopped, not that opening failed', () => {
    const d = decideGreenGuard({ ...base, writesAfterGreen: 3, stoppedByUser: true });
    expect(d.reason).toMatch(/^The build was stopped before/);
    expect(d.reason).not.toMatch(/could not be opened/);
  });

  it('without the new facts the old wording stands, and a render from an earlier build never claims "unchanged"', () => {
    expect(decideGreenGuard(base).reason).toMatch(/could not be opened/);
    expect(decideGreenGuard({ ...base, before: { green: true, at: 500 }, writesAfterGreen: 0 }).reason).toMatch(/could not be opened/);
  });

  it('the route passes both facts', () => {
    expect(route).toContain('writesAfterGreen: inBuildGreenAt > 0 ? postGreenWrites.length : undefined,');
    expect(route).toContain("stoppedByUser: abortCauseOf(abort.signal) === 'user-stop',\n              });");
  });
});

describe('9 · the model describing its own missed selector is not an engine error (Q-729)', () => {
  // The exact narration from build b4745cb1.
  const REAL = 'The add-transaction form is visible and the app rendered with no console errors, but the form field selector timed out, likely because the placeholder isn\'t exactly as expected. Let me inspect the actual inputs.';
  const severityOf = (line: string) => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.ingestEvent({ type: 'narration', agent: 'architect', text: line, ts: 1 } as never);
    return d.report().issues.find((i) => i.code === 'AGENT_NOTE')?.severity;
  };

  it('the real line is a warning (a struggle point), not an error', () => {
    expect(narrationIsProbeMiss(REAL)).toBe(true);
    expect(severityOf(REAL)).toBe('warning');
  });

  it('an engine failure stays an error, even beside a missed selector', () => {
    expect(severityOf('The dev server failed to start — port 5173 error.')).toBe('error');
    expect(narrationIsProbeMiss('The dev server failed to start and the selector timed out.')).toBe(false);
    expect(severityOf('npm install failed with an error.')).toBe('error');
  });
});

describe('10 · an AI provider called from the page is caught, wherever it was written (Q-730)', () => {
  // The shape build e52cebbf wrote: a key from localStorage, sent from the page to the provider.
  const PAGE = [
    "const key = localStorage.getItem('openai-api-key') || '';",
    "const res = await fetch('https://api.openai.com/v1/chat/completions', {",
    "  method: 'POST', headers: { Authorization: `Bearer ${key}` },",
  ].join('\n');

  it('the page that calls the provider is found, with its line', () => {
    expect(findBrowserAiKeyUse({ 'src/lib/openai.ts': PAGE })).toEqual([
      { file: 'src/lib/openai.ts', line: 2, shape: 'provider-host', snippet: "const res = await fetch('https://api.openai.com/v1/chat/completions', {" },
    ]);
  });

  it('a browser SDK client and a bundled provider key are the same defect', () => {
    expect(findBrowserAiKeyUse({ 'src/ai.ts': 'new OpenAI({ apiKey, dangerouslyAllowBrowser: true })' })[0]?.shape).toBe('browser-sdk');
    expect(findBrowserAiKeyUse({ 'src/ai.ts': 'const k = import.meta.env.VITE_OPENAI_API_KEY;' })[0]?.shape).toBe('bundled-key');
  });

  it('server code, tests and our own keyless client are never flagged', () => {
    for (const f of ['server/lib/ai.ts', 'api/chat.ts', 'src/pages/api/chat.ts', 'app/api/chat/route.ts', 'src/ai.test.ts', 'supabase/functions/ai/index.ts']) {
      expect(isBrowserSource(f)).toBe(false);
    }
    expect(isBrowserSource('src/api/client.ts')).toBe(true);
    for (const provider of ['navbharat', 'openai', 'anthropic'] as const) {
      expect(findBrowserAiKeyUse(generateAiIntegration(provider).files)).toEqual([]);
    }
  });

  it('the builder hears it with the file open, and the report records it', () => {
    expect(browserAiKeyWriteNote('src/lib/openai.ts', PAGE)).toMatch(/AI KEY IN THE PAGE — src\/lib\/openai\.ts:2/);
    expect(browserAiKeyWriteNote('src/lib/ai.ts', generateAiIntegration('navbharat').files['src/lib/ai.ts'])).toBe('');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('security += browserAiKeyWriteNote(p, files[p]);');
    expect(route).toContain("code: 'AI_KEY_IN_BROWSER'");
  });
});

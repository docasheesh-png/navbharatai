import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { WorkspaceMemory, isCompileErrorText } from '../src/server/AgentV3/WorkspaceMemory';
import { tscOutputProvesClean } from '../src/server/AgentV3/TscGate';
import { refuteReviewByEvidence, claimsCompileFailure } from '../src/server/AgentV3/reviewEvidence';
import { toReviewSuggestions } from '../src/server/AgentV3/greenReviewPolicy';
import { decideUnfinishedResume, MAX_UNFINISHED_RESUMES } from '../src/server/AgentV3/unfinishedResume';
import { starterSummary } from '../src/server/AgentV3/stillTheStarterApp';
import { contractSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';
import type { ReviewResult } from '../src/server/AgentV3/ReviewerAgent';

/**
 * Autopsy 121c2431 + b10aae9a (2026-09-26): "Make me an app for maintaining stationary items log".
 *
 * Build 1 ended FAILED at 5.4 min with 1,418 s of its budget unspent: the architect wrote 26,371
 * characters of prose, no tool call, and the loop took that as "finished" while the readiness gate said
 * the app was still the starter. Build 2 (the user's "continue") worked — and then its reviewer read two
 * builds' worth of FIXED compile errors out of project memory and told the user "TypeScript build errors
 * are present", after tsc and `npm run build` had both passed.
 */

// ── The reviewer's finding, verbatim from build b10aae9a ──────────────────────────────────────────────
const REVIEWER_FINDING = '(confidence: high) TypeScript build errors are present. The user memory reports:\n'
  + '- write-typecheck: 3 error(s) in src/components/StationaryList.tsx\n'
  + '- write-typecheck: 8 error(s) in src/components/StationaryItem.tsx';

describe('1 · a compile error a later clean compile answered stops being a "Recent error"', () => {
  it('🔴 the exact memory of build b10aae9a: three fixed errors, then a clean tsc — none is shown again', () => {
    const m = new WorkspaceMemory();
    m.recordError('write-typecheck: 3 error(s) in src/components/StationaryList.tsx', undefined, 1000);
    m.recordError('write-typecheck: 8 error(s) in src/components/StationaryItem.tsx', undefined, 1001);
    m.recordError('write-typecheck: 1 error(s) in src/components/StationaryItem.tsx', undefined, 1002);
    expect(m.projectMap()).toContain('Recent errors');
    m.markTscClean(2000);
    expect(m.projectMap()).not.toContain('Recent errors');
    expect(m.projectMap()).not.toContain('write-typecheck');
  });

  it('the history is KEPT — the mistake ledger and the reflection pass still read it', () => {
    const m = new WorkspaceMemory();
    m.recordError('typecheck: 4 TypeScript error(s).', undefined, 10);
    m.markTscClean(20);
    const errs = m.snapshot().episodes.filter((e) => e.kind === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].resolvedAt).toBe(20);
  });

  it('a lint, package or API error is NOT answered by tsc passing, and stays open', () => {
    const m = new WorkspaceMemory();
    m.recordError('lint FAIL — 2 errors', undefined, 10);
    m.recordError('check_package: react is missing', undefined, 11);
    m.markTscClean(20);
    expect(m.openErrors().map((e) => e.text)).toEqual(['lint FAIL — 2 errors', 'check_package: react is missing']);
  });

  it('an error recorded AFTER the clean compile is a new, open error', () => {
    const m = new WorkspaceMemory();
    m.markTscClean(20);
    m.recordError('write-typecheck: 2 error(s) in src/App.tsx', undefined, 30);
    expect(m.projectMap()).toContain('write-typecheck: 2 error(s) in src/App.tsx');
  });

  it('the resolution survives a restore from durable storage (it rides on the episode)', () => {
    const m = new WorkspaceMemory();
    m.recordError('syntax: 1 file(s) do not parse.', undefined, 10);
    m.markTscClean(20);
    const restored = new WorkspaceMemory();
    for (const e of m.snapshot().episodes) if (e.kind === 'error') restored.recordError(e.text, e.file, e.ts, e.resolvedAt);
    expect(restored.openErrors()).toHaveLength(0);
    // …and a never-resolved episode carries no `resolvedAt` key at all: Firestore refuses an undefined value.
    const fresh = new WorkspaceMemory();
    fresh.recordError('typecheck: 1 TypeScript error(s).', undefined, 5);
    expect('resolvedAt' in fresh.snapshot().episodes[0]).toBe(false);
  });

  it('the compile-error vocabulary is the one ToolDispatcher writes', () => {
    for (const t of ['write-typecheck: 3 error(s) in a.tsx', 'typecheck: 2 TypeScript error(s).', 'typecheck: ts 2 error(s).',
      'syntax: 1 file(s) do not parse.', '[BLOCKED-SYNTAX] refused write', 'bash failed (exit 2): npx tsc --noEmit\nerr']) {
      expect(isCompileErrorText(t)).toBe(true);
    }
    for (const t of ['bash failed (exit 1): npm install', 'lint FAIL — x', 'api_graph: 1 frontend call']) {
      expect(isCompileErrorText(t)).toBe(false);
    }
  });
});

describe('2 · only an output that PROVES the compile passed may resolve anything', () => {
  it('an empty tsc output is the clean case', () => {
    expect(tscOutputProvesClean('')).toBe(true);
  });
  it('errors, a help page, a missing binary and a failed install are not proof', () => {
    expect(tscOutputProvesClean("src/a.tsx(1,1): error TS2304: Cannot find name 'X'.")).toBe(false);
    expect(tscOutputProvesClean('Version 2.0.4\nSyntax:   tsc [options] [file ...]')).toBe(false);
    expect(tscOutputProvesClean('sh: 1: tsc: not found')).toBe(false);
    expect(tscOutputProvesClean('bash: ./node_modules/.bin/tsc: No such file or directory')).toBe(false);
    expect(tscOutputProvesClean('npm ERR! code ERESOLVE')).toBe(false);
  });

  it('every compile path reports its OUTPUT through one door, and the shell path no longer trusts its exit code', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    // The only markTscClean call is inside the helper.
    expect(src.match(/\.markTscClean\(/g)?.length).toBe(1);
    expect(src).toMatch(/private noteCompileOutput\(output: string\): void \{[\s\S]{0,200}tscOutputProvesClean\(output\)[\s\S]{0,120}markTscClean\(\)/);
    // Three callers: the write-time check, the typecheck tool, and bash.
    expect(src.match(/this\.noteCompileOutput\(/g)?.length).toBe(3);
    expect(src).toMatch(/looksLikeTypecheckCommand\(command\) && exitCode === 0\) this\.noteCompileOutput\(`\$\{stdout\}\\n\$\{stderr\}`\)/);
    expect(src).not.toMatch(/\\btsc\\b\[\^&\|;\]\*--noEmit\/\.test\(command\)\) mem\.markTscClean/);
  });
});

describe('3 · the compiler outranks the reviewer\'s inference', () => {
  const review = (issues: ReviewResult['issues'], summary = issues[0]?.message ?? ''): ReviewResult =>
    ({ passed: !issues.some((i) => i.severity === 'critical'), score: 65, issues, summary });

  it('🔴 the verbatim finding is dropped when the typecheck PASSED — no critical, no suggestion, no stale summary', () => {
    const r = review([{ severity: 'critical', message: REVIEWER_FINDING }]);
    const out = refuteReviewByEvidence(r, { typecheck: 'passed' });
    expect(out.refuted).toHaveLength(1);
    expect(out.review.issues).toHaveLength(0);
    expect(out.review.passed).toBe(true);
    expect(out.review.summary).not.toMatch(/TypeScript build errors/);
    expect(out.review.score).toBe(65); // never an invented better number
  });

  it('when the typecheck FAILED or never ran, the reviewer is heard exactly as before', () => {
    const r = review([{ severity: 'critical', message: REVIEWER_FINDING }]);
    for (const t of ['failed', 'not-run', undefined]) {
      const out = refuteReviewByEvidence(r, { typecheck: t });
      expect(out.refuted).toHaveLength(0);
      expect(out.review).toBe(r);
    }
  });

  it('precision: a finding about behaviour that merely MENTIONS TypeScript or errors is kept', () => {
    const kept = [
      'No error handling in the TypeScript save handler — a failed save is silent.',
      'Form validation type errors are not shown to the user.',
      'The search box ignores the category filter.',
      'Consider stricter TypeScript settings in tsconfig.',
    ];
    for (const m of kept) expect(claimsCompileFailure(m)).toBe(false);
    const r = review([...kept.map((message) => ({ severity: 'warning' as const, message })), { severity: 'critical', message: REVIEWER_FINDING }], 'The app mostly works.');
    const out = refuteReviewByEvidence(r, { typecheck: 'passed' });
    expect(out.review.issues.map((i) => i.message)).toEqual(kept);
    expect(out.review.summary).toBe('The app mostly works.');
  });

  it('the claims it does recognise', () => {
    for (const m of ['[CRITICAL] TypeScript errors in StationaryItem.tsx', 'tsc errors remain', 'The project does not compile.',
      'Compilation errors in App.tsx', 'It will fail to typecheck because React is not imported.']) {
      expect(claimsCompileFailure(m)).toBe(true);
    }
  });

  it('the route checks the review against the gate BEFORE narrating, offering or repairing it', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = src.indexOf('refuteReviewByEvidence(review, { typecheck: gateEvidence.typecheck })');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("const reviewText = review ? formatReview(review) : '';"));
    expect(at).toBeLessThan(src.indexOf("const criticals = (review?.issues ?? []).filter((i) => i.severity === 'critical')"));
  });

  it('"(confidence: high)" is an instruction to us, not a sentence for the user', () => {
    const [s] = toReviewSuggestions([{ text: '[CRITICAL] (confidence: high) The delete button removes the wrong row.' }]);
    expect(s.title).toBe('The delete button removes the wrong row.');
  });
});

describe('4 · a turn that stops in prose while the app is unbuilt is resumed with the gate\'s findings', () => {
  const blockers = ['1 unresolved import(s) — the build will fail: src/components/StationaryItem.tsx -> ../styles/index.css'];

  it('resumes, naming the blockers', () => {
    const d = decideUnfinishedResume({ text: 'Plan: 1. Fix StationaryItem.tsx 2. Delegate App.tsx', blockers, resumesUsed: 0 });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('../styles/index.css');
    expect(d.message).toMatch(/NOT finished/);
  });

  it('never overrides an answer: a refusal or a question to the user ends the turn as before', () => {
    expect(decideUnfinishedResume({ text: "I can't build this kind of app.", blockers, resumesUsed: 0 }).standDown).toBe('declined');
    expect(decideUnfinishedResume({ text: 'Should I use localStorage or a database?', blockers, resumesUsed: 0 }).standDown).toBe('asked-the-user');
  });

  it('is bounded, switchable, and needs a blocker', () => {
    expect(decideUnfinishedResume({ text: 'x', blockers, resumesUsed: MAX_UNFINISHED_RESUMES }).standDown).toBe('limit');
    expect(decideUnfinishedResume({ text: 'x', blockers, resumesUsed: 0, env: { AGENTV3_UNFINISHED_RESUME: 'off' } }).standDown).toBe('disabled');
    expect(decideUnfinishedResume({ text: 'x', blockers: [], resumesUsed: 0 }).standDown).toBe('no-blockers');
  });

  function scripted(messages: unknown[], seen: unknown[][]): MessagesCreateClient {
    let i = 0;
    return {
      messages: {
        create: async (req: unknown) => {
          seen.push(JSON.parse(JSON.stringify((req as { messages: unknown[] }).messages)));
          const m = messages[i] ?? { content: [{ type: 'text', text: 'fallback end' }], stop_reason: 'end_turn' };
          i++;
          return m as never;
        },
      },
    };
  }
  const use = { input_tokens: 5, output_tokens: 5 };
  const write = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: use });
  const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: use });

  function run(script: unknown[], readyAfter: number, seen: unknown[][]) {
    let checks = 0;
    const dispatcher = {
      dispatch: async (tu: { id: string }) => ({ tool_use_id: tu.id, content: 'ok', is_error: false }),
      assessBuildReadiness: async () => {
        checks++;
        return checks > readyAfter
          ? { score: 100, ready: true, blockers: [] as string[], warnings: [] as string[], tier: 'ok' }
          : { score: 40, ready: false, blockers, warnings: [] as string[], tier: 'weak' };
      },
    };
    const stream = new AgentEventStream();
    return new AgentRunner({
      client: new ClaudeClient(scripted(script, seen)), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), expectsArtifacts: true, readinessGate: true,
    }).run('Make me an app for maintaining stationary items log');
  }

  it('🔴 the build of 121c2431, replayed: prose, resume, the model acts, and the build SUCCEEDS', async () => {
    const seen: unknown[][] = [];
    const result = await run([write('a'), say('I should delegate… but first I must fix StationaryItem.tsx. Plan: 1. …'), write('b'), say('Done.')], 1, seen);
    expect(result.ok).toBe(true);
    const resumeSent = JSON.stringify(seen[2] ?? []);
    expect(resumeSent).toContain('NOT finished');
    expect(resumeSent).toContain('../styles/index.css');
  });

  it('a model that keeps stopping still ends honestly after two resumes — never a loop', async () => {
    const seen: unknown[][] = [];
    const result = await run([write('a'), say('Thinking.'), say('Thinking.'), say('Thinking.'), say('never reached')], 99, seen);
    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(4); // the first call, the prose turn, and exactly two resumes
  });

  it('a model that declined after working is NOT resumed', async () => {
    const seen: unknown[][] = [];
    const result = await run([write('a'), say("I can't build this without a database account.")], 99, seen);
    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(2);
  });
});

describe('5 · what the user reads, and what the next build is handed', () => {
  it('🔴 the starter summary keeps the model\'s first paragraph, not its deliberation and our quoted rules', () => {
    const said = 'I see the rewrite dropped the original markup.\n\nThe rules say: "MANDATORY DELEGATION (no exceptions): as Architect you coordinate". But I already started…';
    const s = starterSummary(said);
    expect(s).toContain('I see the rewrite dropped the original markup.');
    expect(s).not.toContain('MANDATORY DELEGATION');
    expect(s.endsWith('…')).toBe(true);
  });

  it('the contract may not name a type after a component', () => {
    expect(contractSystemPrompt('vite-react')).toMatch(/NO NAME MAY BE BOTH A TYPE AND A COMPONENT/);
  });
});

// Each build's proof (check card + build health + feedback) belongs to its OWN turn in the chat
// (admin 2026-11-21, phone screenshot): it used to be pinned below the whole timeline, so newer
// replies landed above an older build's proof, and the next send wiped it.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildChatBlocks } from './activityTimeline';
import { agentV3Reducer } from './agentV3Reducer';
import { initialAgentV3State, type AgentV3ClientState, type BuildProof } from './agentV3Types';
import {
  archiveBuildProof, currentBuildProof, feedbackKey, isProofDismissed, PROOF_LOG_CAP, proofDismissedKey,
  proofsForTimeline, rememberProofDismissed,
} from './buildProof';
import { BuildProofCard } from './BuildProofCard';

type Msg = { role: 'user' | 'agent'; text: string; ts: number };

// node test environment: a minimal in-memory localStorage.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const health = { ready: true, score: 100, blockers: [], warnings: [] } as unknown as NonNullable<AgentV3ClientState['buildHealth']>;

/** A finished build as the reducer leaves it: narration, the verified event, then the result. */
function finishedBuild(base: AgentV3ClientState, buildId: string, t0: number): AgentV3ClientState {
  let s = agentV3Reducer(base, { type: 'build_meta', buildId, promptHash: 'h', workspaceId: 'ws1', ts: t0 });
  s = agentV3Reducer(s, { type: 'workspace', workspaceId: 'ws1', ts: t0 } as never);
  s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'Your game is ready.', ts: t0 + 1 });
  s = agentV3Reducer(s, {
    type: 'verified', ok: false, headline: 'NavBharatAI checked your app — the game itself is not verified yet',
    steps: ['The start screen opened.', 'The game loop could not be driven.'], ts: t0 + 2,
  });
  s = agentV3Reducer(s, { type: 'result', ok: true, summary: 'done', steps: 3, readiness: health, buildId, ts: t0 + 3 } as never);
  return s;
}

/** What useAgentV3Build.start() does to the state on a new send (mirrored; the source guard below pins it). */
function startNewTurn(prev: AgentV3ClientState): AgentV3ClientState {
  return { ...initialAgentV3State(), proofLog: archiveBuildProof(prev.proofLog, currentBuildProof(prev)), workspaceId: prev.workspaceId };
}

describe('the reducer keeps the proof timestamp', () => {
  it('a verified event keeps its ts, so the proof can be placed at its own turn', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'verified', ok: true, headline: 'h', steps: ['a'], ts: 42 });
    expect(s.verification?.ts).toBe(42);
  });
});

describe('currentBuildProof', () => {
  it('is null while nothing has been checked or finished', () => {
    expect(currentBuildProof(initialAgentV3State())).toBeNull();
  });

  it('anchors at the last moment of the turn and keys by build id', () => {
    const p = currentBuildProof(finishedBuild(initialAgentV3State(), 'B1', 100))!;
    expect(p.key).toBe('build-B1');
    expect(p.anchorTs).toBe(102);
    expect(p.verification?.steps).toHaveLength(2);
    expect(p.buildHealth?.score).toBe(100);
    expect(p.feedback).toBe(true);
  });

  it('shows no health row or feedback before the build is done (same gates as before)', () => {
    const s = agentV3Reducer({ ...initialAgentV3State(), buildHealth: health, ok: true, workspaceId: 'w' }, { type: 'verified', ok: true, headline: 'h', steps: ['a'], ts: 5 });
    const p = currentBuildProof(s)!;
    expect(p.buildHealth).toBeUndefined();
    expect(p.feedback).toBe(false);
  });
});

describe('buildChatBlocks places each proof at its own turn', () => {
  it('an OLDER build\'s proof renders BEFORE a later message (the pinned-at-bottom bug)', () => {
    const proof = currentBuildProof(finishedBuild(initialAgentV3State(), 'B1', 100))!;
    const msgs: Msg[] = [
      { role: 'user', text: 'make a game', ts: 99 },
      { role: 'agent', text: 'Your game is ready.', ts: 101 },
      { role: 'user', text: 'make it red', ts: 200 },
      { role: 'agent', text: 'Done, it is red now.', ts: 201 },
    ];
    const blocks = buildChatBlocks(msgs, [], {}, [proof]);
    const order = blocks.map((b) => (b.kind === 'msg' ? b.msg.text : b.kind));
    expect(order).toEqual(['make a game', 'Your game is ready.', 'proof', 'make it red', 'Done, it is red now.']);
    expect(blocks[blocks.length - 1].kind).toBe('msg'); // the latest response is last
  });

  it('two builds: each proof sits under its own final message', () => {
    const p1 = { ...currentBuildProof(finishedBuild(initialAgentV3State(), 'B1', 100))!, anchorTs: 102 };
    const p2 = { ...currentBuildProof(finishedBuild(initialAgentV3State(), 'B2', 300))!, anchorTs: 302 };
    const msgs: Msg[] = [
      { role: 'user', text: 'u1', ts: 99 }, { role: 'agent', text: 'a1', ts: 101 },
      { role: 'user', text: 'u2', ts: 299 }, { role: 'agent', text: 'a2', ts: 301 },
    ];
    const order = buildChatBlocks(msgs, [], {}, [p2, p1]).map((b) => (b.kind === 'msg' ? b.msg.text : b.key));
    expect(order).toEqual(['u1', 'a1', 'proof-build-B1', 'u2', 'a2', 'proof-build-B2']);
  });

  it('without proofs the blocks are unchanged (default parameter)', () => {
    const msgs: Msg[] = [{ role: 'user', text: 'hi', ts: 1 }];
    expect(buildChatBlocks(msgs, [], {})).toEqual(buildChatBlocks(msgs, [], {}, []));
  });
});

describe('a proof survives the next send', () => {
  it('start() archives the previous build\'s proof, and both builds keep their own', () => {
    const first = finishedBuild(initialAgentV3State(), 'B1', 100);
    const afterSend = startNewTurn(first);
    expect(afterSend.verification).toBeUndefined();
    expect(afterSend.proofLog.map((p) => p.key)).toEqual(['build-B1']);
    const second = finishedBuild(afterSend, 'B2', 300);
    const all = proofsForTimeline(second.proofLog, currentBuildProof(second));
    expect(all.map((p) => p.key)).toEqual(['build-B1', 'build-B2']);
  });

  it('the hook archives on start() AND on a live re-attach (source guard)', () => {
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useAgentV3Build.ts'), 'utf8');
    const archived = hook.match(/proofLog: archiveBuildProof\(prev\.proofLog, currentBuildProof\(prev\)\)/g) ?? [];
    expect(archived.length).toBe(2);
  });

  it('the same build archived twice (a re-attach replay) is kept once, and the live copy wins', () => {
    const p = currentBuildProof(finishedBuild(initialAgentV3State(), 'B1', 100))!;
    const log = archiveBuildProof(archiveBuildProof([], p), { ...p, anchorTs: 150 });
    expect(log).toHaveLength(1);
    expect(log[0].anchorTs).toBe(150);
    expect(proofsForTimeline(log, { ...p, anchorTs: 160 }).map((x) => x.anchorTs)).toEqual([160]);
  });

  it('the archive is capped', () => {
    let log: BuildProof[] = [];
    for (let i = 0; i < PROOF_LOG_CAP + 5; i++) log = archiveBuildProof(log, { key: `k${i}`, anchorTs: i, feedback: false });
    expect(log).toHaveLength(PROOF_LOG_CAP);
    expect(log[0].key).toBe('k5');
  });
});

describe('the check card: Dismiss X, compact on phones, per-build memory', () => {
  const proof = (id: string): BuildProof => currentBuildProof(finishedBuild(initialAgentV3State(), id, 100))!;

  it('renders a Dismiss X and a "Show checks" toggle, with the checks collapsed on phones', () => {
    const html = renderToStaticMarkup(<BuildProofCard proof={proof('B1')} />);
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toContain('Show checks');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/class="hidden sm:block[^"]*"/);
    expect(html).toContain('Build health: READY');
    expect(html).toContain('Was this build helpful?');
  });

  it('a dismissal is remembered for THAT build only', () => {
    rememberProofDismissed('build-B1');
    expect(store.get(proofDismissedKey('build-B1'))).toBe('1');
    expect(isProofDismissed('build-B1')).toBe(true);
    expect(renderToStaticMarkup(<BuildProofCard proof={proof('B1')} />)).not.toContain('build-proof-card');
    expect(renderToStaticMarkup(<BuildProofCard proof={proof('B2')} />)).toContain('build-proof-card');
  });

  it('feedback is remembered per build, not per workspace', () => {
    expect(feedbackKey({ buildId: 'B1', workspaceId: 'ws1' })).toBe('nbai:feedback:build:B1');
    expect(feedbackKey({ buildId: 'B2', workspaceId: 'ws1' })).not.toBe(feedbackKey({ buildId: 'B1', workspaceId: 'ws1' }));
    expect(feedbackKey({ workspaceId: 'ws1' })).toBe('nbai:feedback:ws1'); // older servers without a build id
    store.set('nbai:feedback:build:B1', 'up');
    expect(renderToStaticMarkup(<BuildProofCard proof={proof('B1')} />)).toContain('Thanks for the feedback');
    expect(renderToStaticMarkup(<BuildProofCard proof={proof('B2')} />)).toContain('Was this build helpful?');
  });

  it('uses theme tokens only — no amber/emerald colour literals', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/agentv3/BuildProofCard.tsx'), 'utf8');
    expect(src).not.toMatch(/\b(amber|emerald|green|yellow|red)-\d{2,3}/);
    expect(src).toContain('border-warn/40');
  });

  it('the panel no longer pins the proof below the timeline', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).not.toContain('state.verification');
    expect(panel).not.toMatch(/state\.done && state\.buildHealth &&/);
    expect(panel).not.toContain('<BuildFeedback');
    expect(panel).toContain("b.kind === 'proof'");
  });
});

/**
 * 🎮 FOUR PROOFS PER GAME BUILD, AND A FEATURE IS PRESENT ONLY ON EVIDENCE THAT RAN (external Game Maker audit,
 * 2026-11-25 — adapted under the external-suggestion rule, see BUILD_REPORT_QUEUE.md Q-3360…).
 *
 * 🔴 WHAT WAS WRONG. The build report said a named feature was "in the game" when the source CONTAINED a related word
 * (`scopeMatch`): a hand-written game that said "traffic", "swim" or "door" passed traffic, swimming and enterable
 * houses, and a kit game passed on a kit call in a file nothing loaded. And the report could not show what the game was
 * built from, what it looked like, what was actually played, or how fast it ran — so "A good game" read as a verdict on
 * its graphics, which the playtest never judged.
 *
 * 🧬 WHAT THIS DOES.
 *  - `playedFeatureEvidence`: the features the playtest PROVED by playing — an action whose state change it observed
 *    (the score rose, the level went up, a sound started, a new round began after Play again, the vehicle moved under the
 *    accelerator). `gameFeatureEvidence` adds them to the code half (`scopeMatch`: a kit call the running game reaches).
 *    Anything else the code merely names is "not verified" — never present.
 *  - `gameProof` / `gameProofIssue`: one GAME_PROOF section with the four proofs — (a) the contract the game was built
 *    from, (b) what it looked like (the playtest's own pictures, with what was NOT taken and why), (c) the actions played
 *    and what each changed, (d) how long it ran and at what frame rate, labelled as the sandbox's software renderer and
 *    NOT a real phone.
 *
 * Evidence only: never a gate, a charge or an edit. PURE (no I/O).
 */
import type { GameFeature, GameScopeContract, ScopeMatch } from './gameIntent';
import { scopeMatch } from './gameIntent';
import { PLAYTEST_BUDGET_MS, STILL_BELOW, type PlaytestRun, type ProofShot, type RuleProbe } from './gamePlaytest';
import { withoutComments } from '../lib/codeOnly';

/** The features a playthrough PROVED, each with the state change it observed. {} for a run that did not play. PURE. */
export function playedFeatureEvidence(run: PlaytestRun | null | undefined): Partial<Record<GameFeature, string>> {
  const out: Partial<Record<GameFeature, string>> = {};
  if (!run || !run.ok) return out;
  const p = run.progression;
  if (typeof run.kitScoreStart === 'number' && typeof run.kitScoreEnd === 'number' && run.kitScoreEnd > run.kitScoreStart) {
    out.score = `played: the score went ${run.kitScoreStart} → ${run.kitScoreEnd}`;
  } else if (p && p.start.score !== null && p.end.score !== null && p.end.score > p.start.score) {
    out.score = `played: the score went ${p.start.score} → ${p.end.score}`;
  }
  if (p && p.start.level !== null && p.end.level !== null && p.end.level > p.start.level) out.levels = `played: the level went ${p.start.level} → ${p.end.level}`;
  if (typeof run.sounds === 'number' && run.sounds > 0) out.sound = `played: ${run.sounds} sound(s) started while it was played`;
  const rc = run.restartCheck;
  if (rc?.ended === 'gameover' && rc.pressed && rc.after === 'playing') out.restart = `played: after the round ended, "${rc.pressed}" started a new one`;
  // run.scene exists only when the accelerator sped one object up over its idle speed (pickVehicle) — the vehicle.
  if (run.scene && typeof run.scene.moved === 'number' && run.scene.moved >= 0.2) out.throttle = `played: the vehicle moved ${run.scene.moved} m while the accelerator was held`;
  return out;
}

/**
 * The scope match with the played half added: a feature proven by playing is present whatever the code says; a code
 * signal alone stays "not verified". `missing` keeps the code's own answer unless playing proved the feature. PURE.
 */
export function gameFeatureEvidence(contract: GameScopeContract, files: Record<string, string>, run?: PlaytestRun | null): ScopeMatch {
  const m = scopeMatch(contract, files);
  const played = playedFeatureEvidence(run);
  const present = [...m.present];
  const evidence: Partial<Record<GameFeature, string>> = { ...(m.evidence ?? {}) };
  for (const f of contract.requiredFeatures) {
    const seen = played[f];
    if (!seen) continue;
    if (!present.includes(f)) present.push(f);
    evidence[f] = seen; // a played action is the stronger proof
  }
  const notVerified = (m.notVerified ?? []).filter((f) => !present.includes(f));
  const missing = m.missing.filter((f) => !present.includes(f));
  return { ...m, present, missing, ...(notVerified.length ? { notVerified } : { notVerified: undefined }), ...(present.length ? { evidence } : {}) };
}

/** One action the playtest performed, whether it passed, and what it observed change. passed null: not checkable. */
export interface PlayedAction { action: string; passed: boolean | null; observed: string }

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/** The actions a run performed, in the order played, each with what changed. [] for a run that did not play. PURE. */
export function playedActions(run: PlaytestRun | null | undefined): PlayedAction[] {
  const out: PlayedAction[] = [];
  if (!run || !run.ok) return out;
  if (run.started) out.push({ action: `press "${run.started}"`, passed: true, observed: 'a game surface appeared' });
  const idle = typeof run.idle === 'number' ? run.idle : 0;
  for (const m of run.moves ?? []) {
    const moved = m.label === 'up / W' && run.scene && typeof run.scene.moved === 'number' ? `; the vehicle moved ${run.scene.moved} m` : '';
    out.push({ action: `hold ${m.label}`, passed: m.change > Math.max(STILL_BELOW, idle), observed: `the picture changed ${pct(m.change)} (idle ${pct(idle)})${moved}` });
  }
  const p = run.progression;
  if (p) {
    const said = [
      p.start.score !== null || p.end.score !== null ? `score ${p.start.score ?? '—'} → ${p.end.score ?? '—'}` : '',
      p.start.level !== null || p.end.level !== null ? `level ${p.start.level ?? '—'} → ${p.end.level ?? '—'}` : '',
    ].filter(Boolean).join(', ');
    out.push({ action: `play a round (${Math.round(p.ms / 1000)} s)`, passed: p.advanced, observed: said || 'no score or level to read' });
  }
  if (typeof run.touch === 'number') {
    const ti = typeof run.touchIdle === 'number' ? run.touchIdle : 0;
    out.push({ action: 'thumb drag and tap on a phone', passed: run.touch > Math.max(STILL_BELOW, ti), observed: `the picture changed ${pct(run.touch)} (idle ${pct(ti)})` });
  }
  const rc = run.restartCheck;
  if (rc?.ended === 'gameover') {
    out.push({
      action: 'end the round, then press Play again',
      passed: !!rc.pressed && rc.after === 'playing',
      observed: rc.pressed ? `status gameover → pressed "${rc.pressed}" → ${rc.after ?? 'unknown'}` : 'no Play again / Restart control appeared',
    });
  }
  for (const r of (run.rules ?? []) as RuleProbe[]) {
    out.push({ action: `rule ${r.id}`, passed: r.verdict === 'held' ? true : r.verdict === 'not-held' ? false : null, observed: r.why });
  }
  return out;
}

/** A picture the playtest kept in the sandbox (PROOF_PICTURES). */
export type ProofShotRead = ProofShot;

export interface GameProof {
  /** (a) What the game was built from. */
  contract: string;
  /** (b) What it looked like. */
  looks: { taken: ProofShotRead[]; notTaken: Array<{ view: string; why: string }>; startToMoved: number | null; nearToFar: number | null };
  /** (c) What was played, and what each action changed. */
  actions: PlayedAction[];
  /** (d) How long it ran and how fast it drew — in the sandbox, never a phone. */
  run: { ranMs: number | null; fps: number | null; longFrames: number | null; renderer: string };
}

/** The contract in one line (a). PURE. */
export function gameContractSummary(c: GameScopeContract | null | undefined): string {
  if (!c) return 'no game contract was recorded for this turn';
  const parts = [
    `genre ${c.genre}`, `view ${c.dimension}`,
    c.vehicle ? `vehicle ${c.vehicle}` : '', c.camera && c.camera !== 'unspecified' ? `camera ${c.camera}` : '',
    c.reference ? `like ${c.reference}` : '',
    c.requiredFeatures.length ? `named features: ${c.requiredFeatures.join(', ')}` : 'no named features',
    c.controls.length ? `controls: ${c.controls.join(', ')}` : '',
    c.subjects?.length ? `world: ${c.subjects.slice(0, 8).join(', ')}` : '',
    c.rules?.length ? `rules: ${c.rules.slice(0, 4).map((r) => `"${String(r.said).slice(0, 80)}"`).join('; ')}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Does the game's own code keep a day-night clock (the kit's createAtmosphere)? PURE. */
function hasDayNightClock(files: Record<string, string>): boolean {
  return Object.entries(files || {}).some(([p, v]) => typeof v === 'string' && /\.(t|j)sx?$/.test(p) && !/(^|\/)node_modules\//.test(p)
    && !/(^|\/)src\/game\/three\//.test(p) && /\bcreateAtmosphere\s*\(/.test(withoutComments(v)));
}

const RENDERER_LABEL = 'the build sandbox\'s software renderer — NOT a real phone (a phone\'s GPU draws differently; budget-phone weight is judged from draw calls and triangles, GAME_DEFECT_TOO_HEAVY)';

/**
 * The four proofs of one game build. `run` null: the game was not played — every played proof is said as not taken,
 * with `notPlayedWhy`. PURE.
 */
export function gameProof(input: { contract: GameScopeContract | null | undefined; run: PlaytestRun | null; ranMs: number | null; files: Record<string, string>; notPlayedWhy?: string }): GameProof {
  const { run } = input;
  const why = (input.notPlayedWhy || (run && !run.ok ? (run.error || 'the playtest did not finish') : '') || 'the game was not played').replace(/\.+$/, '');
  const played = !!run && run.ok;
  const taken: ProofShotRead[] = [];
  const notTaken: Array<{ view: string; why: string }> = [];
  const shots = (played ? run!.proofShots ?? [] : []).filter((s): s is NonNullable<typeof s> => !!s);
  for (const view of ['start', 'moved', 'far']) {
    const s = shots.find((x) => x.view === view) as (ProofShotRead & { error?: string }) | undefined;
    if (s && !s.error && s.id) taken.push({ view, id: s.id, w: s.w, h: s.h, bytes: s.bytes, path: s.path, colors: s.colors ?? null, edges: s.edges ?? null });
    else {
      const note = run?.proofNotes?.[view] || run?.proofNotes?.all;
      notTaken.push({ view, why: s?.error ? `not taken: ${s.error}` : !played ? `not taken: ${why}` : note || 'not taken: the playtest did not reach that point (an older playtest, or it ran out of time first)' });
    }
  }
  notTaken.push({ view: 'day and night', why: hasDayNightClock(input.files)
    ? 'not taken: the game keeps a day-night clock, but the clock is not reachable from the page, so the playtest cannot set the hour'
    : 'not taken: the game has no day-night clock' });
  return {
    contract: gameContractSummary(input.contract),
    looks: { taken, notTaken, startToMoved: played && typeof run!.proofStartMoved === 'number' ? run!.proofStartMoved : null, nearToFar: played && typeof run!.proofNearFar === 'number' ? run!.proofNearFar : null },
    actions: playedActions(run),
    run: {
      ranMs: typeof input.ranMs === 'number' && Number.isFinite(input.ranMs) ? Math.round(input.ranMs) : null,
      fps: played && typeof run!.fps === 'number' ? run!.fps : null,
      longFrames: played && typeof run!.longFrames === 'number' ? run!.longFrames : null,
      renderer: `${run && typeof run.webgl === 'string' ? `${run.webgl} — ` : ''}${RENDERER_LABEL}`,
    },
  };
}

/** The report line for GAME_PROOF — the four proofs in order, every gap said. PURE. */
export function gameProofMessage(proof: GameProof): string {
  const l = proof.looks;
  const pics = l.taken.map((t) => `${t.view} ${t.w}×${t.h} (${Math.round(t.bytes / 1024)} KB, id ${t.id}, sandbox ${t.path})`).join('; ');
  const changes = [
    l.startToMoved !== null ? `start → after moving changed ${l.startToMoved}%` : '',
    l.nearToFar !== null ? (l.nearToFar < STILL_BELOW ? `near → far changed only ${l.nearToFar}% (the pull-back could not move this game's camera)` : `near → far changed ${l.nearToFar}%`) : '',
  ].filter(Boolean).join(', ');
  const acts = proof.actions.length
    ? proof.actions.map((a) => `${a.action} — ${a.passed === true ? 'passed' : a.passed === false ? 'FAILED' : 'not checkable'} (${a.observed})`).join('; ')
    : 'none — the game was not played';
  const r = proof.run;
  const ran = [
    r.ranMs !== null ? `the playtest ran ${Math.round(r.ranMs / 100) / 10} s of its ${PLAYTEST_BUDGET_MS / 1000} s budget` : 'the playtest did not run',
    r.fps !== null ? `${r.fps} fps while idle${r.longFrames !== null ? `, ${r.longFrames} long frame(s)` : ''}` : 'frame rate not measured',
  ].join(', ');
  return [
    `Game proof. (a) Built from: ${proof.contract}.`,
    `(b) What it looked like: ${pics || 'no picture taken'}${changes ? `; ${changes}` : ''}. Not taken: ${l.notTaken.map((n) => `${n.view} — ${n.why.replace(/^not taken: /, '')}`).join('; ')}. The pictures stay in the sandbox for this build only.`,
    `(c) Played: ${acts}.`,
    `(d) Ran: ${ran} — measured in ${r.renderer}.`,
    'The playtest score measures whether the game can be played (runs, controls, phone, stability, smoothness) — it is not a judgement of how realistic its graphics are.',
  ].join(' ');
}

export interface GameProofIssue { code: 'GAME_PROOF'; severity: 'info'; message: string; autoResolved: true; detail: string }

/** The GAME_PROOF report line, with the structured proof (bounded) as its detail for tools that read it. PURE. */
export function gameProofIssue(proof: GameProof): GameProofIssue {
  // Naturally bounded: at most three pictures' descriptions, about a dozen actions, a contract line of a few hundred characters.
  return { code: 'GAME_PROOF', severity: 'info', autoResolved: true, message: gameProofMessage(proof), detail: JSON.stringify(proof) };
}

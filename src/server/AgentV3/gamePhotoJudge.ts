/**
 * 📸 THE PHOTO JUDGE — a look at the game's own proof pictures, asking whether what THIS request asked for is on screen
 * (Kadam 1, admin decision 2026-11-27).
 *
 * WHAT WAS MISSING. The playtest takes up to three small JPEGs of the game (start, after moving, far view —
 * PROOF_PICTURES in gamePlaytest.ts) and `gameProofPictures.ts` keeps them for the admin. Nothing ever LOOKED at them, so
 * "hero kr hath me ek badi gun banao" could be reported done with an empty hand as long as the page's own counters agreed.
 *
 * WHAT THIS DOES. After a game turn's playtest, at most three yes/no questions derived from the request ("Is the main
 * character holding a gun in their hand?", "Are enemy characters visible on screen?", "Is the ground or road clearly
 * visible, not covered by a white haze, fog or water?") go to the vision chain in ONE call, with the pictures.
 *  - A clear NO for an asked-for thing becomes the existing `GAME_DEFECT_ASK_NOT_MET` defect, with the question and the
 *    answer as its evidence — the same defect the completion gate already reads (gameRepair.ts `gameIncompleteReason`).
 *  - YES, UNCLEAR, an unreadable reply, a failed call, a timeout, no pictures: NOTHING is said about the game. "Could not
 *    look" is never turned into "missing".
 *  - One admin-only diagnostics line (`GAME_PHOTO_JUDGE`) records what was asked and answered; the provider and model
 *    that answered go in its `adminDetail` only (White-Label Law). No user-facing text here names a vendor or a model.
 *
 * MONEY. The call's REAL reported tokens are recorded through the build's own usage ledger (the route's
 * `captureTurnUsage`), inside its own billing phase (`PHASE_GAME_PHOTO_JUDGE`), so the markup and the "a failed build is
 * never charged" rule apply exactly as to every other build-phase cost. Tokens the provider did not report are recorded
 * as UNMEASURED (never estimated). A judge that gave no clear answer delivered nothing, so its phase is marked barren and
 * its spend is the platform's (billingPhase.ts).
 *
 * TIERS. Weak and Normal use the free vision chain (no Claude, capped); Strong may reach Claude last (ROUTING_AND_BILLING:
 * "Vision (describe)" row).
 *
 * BOUNDS. At most PHOTO_JUDGE_MAX_QUESTIONS questions, one call, a hard PHOTO_JUDGE_TIMEOUT_MS deadline, and a kill
 * switch: AGENTV3_GAME_PHOTO_JUDGE=off (default on). Evidence only: it never throws, never edits and never gates by itself.
 */
import { asksForEnemies, asksForEnterableHouses, heldItemAsked, type GameScopeContract } from './gameIntent';
import { runInBillingPhase, PHASE_GAME_PHOTO_JUDGE } from './billingPhase';
import { sandboxPictureReader, verifiedProofPicture } from './gameProofPictures';
import type { GameDefect, ProofShot } from './gamePlaytest';
import type { PowerLevel } from './powerLevel';
import type { VisionAttachment, VisionOptions, VisionResult } from '../lib/visionChain';

export const GAME_PHOTO_JUDGE_CODE = 'GAME_PHOTO_JUDGE';
export const PHOTO_JUDGE_MAX_QUESTIONS = 3;
/** The whole look (picture reads + the one vision call) never takes longer than this. */
export const PHOTO_JUDGE_TIMEOUT_MS = 25_000;
/** Each provider in the chain gets at most this long, so one stuck provider cannot eat the whole budget. */
export const PHOTO_JUDGE_PROVIDER_TIMEOUT_MS = 12_000;

/** Is the judge on? Default ON; `AGENTV3_GAME_PHOTO_JUDGE=off` stops it. PURE. */
export function gamePhotoJudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_PHOTO_JUDGE ?? '').trim().toLowerCase() !== 'off';
}

export type PhotoQuestionKind = 'held' | 'enemies' | 'ground' | 'houses';
export interface PhotoQuestion { kind: PhotoQuestionKind; question: string }
export type PhotoAnswer = 'yes' | 'no' | 'unclear';

/** A royale, open-world or driving game is a world with ground and roads the player must be able to see. */
const ROAD_WORDS = /\b(?:roads?|sadak|streets?|highway|cars?|gaadi|gadi|racing|race|drive|driving|city)\b|सड़क|गाड़ी/i;

/**
 * The questions for THIS request, most specific first, at most PHOTO_JUDGE_MAX_QUESTIONS. Every question is phrased so
 * that YES means the asked-for thing is there. A kind the page probe already reported missing (`skip`) is not asked
 * again — it is already a defect. PURE.
 */
export function photoJudgeQuestions(request: string | null | undefined, contract: GameScopeContract | null, skip: ReadonlySet<PhotoQuestionKind> = new Set()): PhotoQuestion[] {
  const out: PhotoQuestion[] = [];
  const item = heldItemAsked(request);
  if (item) out.push({ kind: 'held', question: `Is the main character holding a ${item} in their hand?` });
  if (contract?.requiredFeatures.includes('enemies') || asksForEnemies(request)) out.push({ kind: 'enemies', question: 'Are enemy characters (opponents or bots) visible on screen?' });
  const openWorld = asksForEnterableHouses(request);
  const flat = contract?.dimension === '2d';
  if (!flat && (openWorld || contract?.genre === 'racing' || (contract?.dimension === '3d' && ROAD_WORDS.test(String(request ?? ''))))) {
    out.push({ kind: 'ground', question: 'Is the ground or road clearly visible, not covered by a white haze, fog or water?' });
  }
  if (openWorld || contract?.requiredFeatures.includes('enterableHouses')) out.push({ kind: 'houses', question: 'Are houses or buildings visible in the scene?' });
  return out.filter((q) => !skip.has(q.kind)).slice(0, PHOTO_JUDGE_MAX_QUESTIONS);
}

export const PHOTO_JUDGE_SYSTEM = 'You check screenshots of a video game. Answer only from what you can actually see in the pictures. '
  + 'Never guess. When the pictures do not let you tell, answer UNCLEAR.';

/** The one prompt for the one call: numbered questions, one line per answer. PURE. */
export function photoJudgePrompt(questions: readonly PhotoQuestion[]): string {
  return [
    'These are up to three screenshots of the same game: at the start, after the player moved, and a far view.',
    'Answer each question about ALL the pictures together (YES if any picture clearly shows it).',
    'Reply with exactly one line per question, in this form and nothing else:',
    ...questions.map((_, i) => `${i + 1}: YES or NO or UNCLEAR`),
    '',
    'Questions:',
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
  ].join('\n');
}

/**
 * Read the reply into one answer per question. Only a clean "N: YES" / "N: NO" line counts; a missing line, a line with
 * anything else, or two different answers for one number is UNCLEAR. PURE.
 */
export function parsePhotoVerdicts(text: string | null | undefined, count: number): PhotoAnswer[] {
  const seen = new Map<number, PhotoAnswer>();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:\*\*)?(?:q(?:uestion)?\s*)?(\d{1,2})\s*(?:\*\*)?\s*[:.)-]\s*(?:\*\*)?\s*([a-z]+)\b\W*(.*)$/i.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n >= 1 && n <= count)) continue;
    const word = m[2].toLowerCase();
    const answer: PhotoAnswer = word === 'yes' ? 'yes' : word === 'no' ? 'no' : 'unclear';
    const prev = seen.get(n);
    seen.set(n, prev && prev !== answer ? 'unclear' : answer);
  }
  return Array.from({ length: count }, (_, i) => seen.get(i + 1) ?? 'unclear');
}

/** A clear NO becomes the asked-for-not-met defect, with the question and the answer as its evidence. PURE. */
export function photoJudgeDefects(questions: readonly PhotoQuestion[], answers: readonly PhotoAnswer[]): GameDefect[] {
  return questions.flatMap((q, i) => answers[i] === 'no'
    ? [{ code: 'GAME_DEFECT_ASK_NOT_MET' as const, evidence: `a look at the game's pictures answered NO to "${q.question}"` }]
    : []);
}

/** The vision tier for a build tier: Weak and Normal never reach Claude; Strong may, last. PURE. */
export function photoJudgeTier(power: PowerLevel | null | undefined): Pick<VisionOptions, 'allowClaude' | 'tier'> {
  return power === 'mini' ? { allowClaude: true, tier: 'paid' } : { allowClaude: false, tier: 'free' };
}

export interface PhotoJudgeInput {
  shots: ProofShot[];
  request: string | null | undefined;
  contract: GameScopeContract | null;
  /** Kinds the page probe already reported missing — not asked again. */
  skip?: ReadonlySet<PhotoQuestionKind>;
}

export type PhotoJudgeState = 'judged' | 'off' | 'no-questions' | 'no-pictures' | 'no-time' | 'no-answer' | 'timed-out';
export interface PhotoJudgeOutcome {
  state: PhotoJudgeState;
  questions: PhotoQuestion[];
  answers: PhotoAnswer[];
  defects: GameDefect[];
  pictures: number;
  /** Admin-only: which provider/model answered and what the tokens were. Never shown to the user. */
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number } | null;
}

export interface PhotoJudgePorts {
  /** The verified bytes of one proof picture, or null. */
  readPicture: (shot: ProofShot) => Promise<Buffer | null>;
  /** The vision chain (runVisionChain). */
  see: (atts: VisionAttachment[], o: VisionOptions) => Promise<VisionResult | null>;
  /** The build's usage ledger (the route's captureTurnUsage). Called inside PHASE_GAME_PHOTO_JUDGE. */
  recordUsage: (provider: string, usage: { inputTokens: number; outputTokens: number; measured?: boolean }, model?: string) => void;
  /** Leave this phase out of the user's bill (a judge that gave no clear answer delivered nothing). */
  markBarren?: () => void;
  power: PowerLevel | null | undefined;
  /** Is there build time left for one look? Absent ⇒ yes. */
  timeLeft?: () => boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const done = (state: PhotoJudgeState, questions: PhotoQuestion[] = [], pictures = 0): PhotoJudgeOutcome => ({ state, questions, answers: questions.map(() => 'unclear'), defects: [], pictures });

/**
 * Look at the pictures and answer the questions. One vision call, bounded, its real cost recorded on the build's ledger.
 * Never throws; every failure is an outcome that says nothing about the game.
 */
export async function runGamePhotoJudge(input: PhotoJudgeInput, ports: PhotoJudgePorts): Promise<PhotoJudgeOutcome> {
  try {
    if (!gamePhotoJudgeEnabled(ports.env)) return done('off');
    const questions = photoJudgeQuestions(input.request, input.contract, input.skip);
    if (questions.length === 0) return done('no-questions');
    if (ports.timeLeft && !ports.timeLeft()) return done('no-time', questions);
    const limit = ports.timeoutMs ?? PHOTO_JUDGE_TIMEOUT_MS;
    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((r) => { timer = setTimeout(() => { deadline.abort(new Error('photo judge timed out')); r('timeout'); }, limit); });
    try {
      const look = (async (): Promise<PhotoJudgeOutcome> => {
        const atts: VisionAttachment[] = [];
        for (const shot of (input.shots ?? []).slice(0, 3)) {
          if (deadline.signal.aborted) break;
          const bytes = await ports.readPicture(shot).catch(() => null);
          if (bytes && bytes.length) atts.push({ name: `${shot.view}.jpg`, type: 'image/jpeg', base64: bytes.toString('base64') });
        }
        if (atts.length === 0) return done('no-pictures', questions);
        if (deadline.signal.aborted) return done('timed-out', questions, atts.length);
        return runInBillingPhase(PHASE_GAME_PHOTO_JUDGE, async () => {
          const call = ports.see(atts, {
            prompt: photoJudgePrompt(questions), systemPrompt: PHOTO_JUDGE_SYSTEM, ...photoJudgeTier(ports.power),
            timeoutMs: Math.min(PHOTO_JUDGE_PROVIDER_TIMEOUT_MS, limit), signal: deadline.signal,
          });
          // The cost is recorded whenever the call settles — in time or after the deadline — so a call we walked away
          // from is still on the ledger (and, giving no answer, in a barren phase). Exactly once.
          const settled = call.then((r) => { recordCost(r, ports); return r; }, () => null);
          const r = await settled;
          if (!r?.text) { ports.markBarren?.(); return done('no-answer', questions, atts.length); }
          const answers = parsePhotoVerdicts(r.text, questions.length);
          if (answers.every((a) => a === 'unclear')) ports.markBarren?.();
          return {
            state: 'judged', questions, answers, defects: photoJudgeDefects(questions, answers), pictures: atts.length,
            provider: r.provider, ...(r.model ? { model: r.model } : {}), usage: r.usage ? { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } : null,
          };
        });
      })();
      const first = await Promise.race([look, timedOut]);
      if (first === 'timeout') { ports.markBarren?.(); return done('timed-out', questions); }
      return first;
    } finally { if (timer) clearTimeout(timer); }
  } catch {
    try { ports.markBarren?.(); } catch { /* best-effort */ }
    return done('no-answer');
  }
}

/** The real reported tokens onto the build's ledger; unreported tokens are recorded as unmeasured, never estimated. */
function recordCost(r: VisionResult | null, ports: PhotoJudgePorts): void {
  if (!r) return;
  // A call that went through the inference gateway is settled in the gateway's own ledger, not in the build's.
  if (r.inferenceGateway) return;
  try {
    if (r.usage) ports.recordUsage(r.provider, { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens }, r.model);
    else ports.recordUsage(r.provider, { inputTokens: 0, outputTokens: 0, measured: false }, r.model);
  } catch { /* the ledger is best-effort here; it never breaks a build */ }
}

/** The one admin-only report line. No provider or model in the message; those go in adminDetail. PURE. */
export function photoJudgeRecord(o: PhotoJudgeOutcome): { phase: 'preview'; severity: 'info'; code: string; message: string; autoResolved: true; adminDetail?: string } | null {
  if (o.state === 'off' || o.state === 'no-questions') return null;
  const qa = o.questions.map((q, i) => `"${q.question}" → ${(o.answers[i] ?? 'unclear').toUpperCase()}`).join(' · ');
  const why: Record<PhotoJudgeState, string> = {
    judged: `looked at ${o.pictures} picture(s): ${qa}`,
    off: '', 'no-questions': '',
    'no-pictures': 'no proof picture could be read, so nothing was looked at',
    'no-time': 'not enough build time left for a look',
    'no-answer': 'the look gave no answer, so nothing is said about the game',
    'timed-out': `the look ran past its ${Math.round(PHOTO_JUDGE_TIMEOUT_MS / 1000)} s limit, so nothing is said about the game`,
  };
  const found = o.defects.length ? ` ${o.defects.length} asked-for thing(s) not seen.` : '';
  const admin = o.provider ? `${o.provider}${o.model ? ` (${o.model})` : ''}; tokens ${o.usage ? `${o.usage.inputTokens} in / ${o.usage.outputTokens} out` : 'not reported (recorded as unmeasured)'}` : undefined;
  return { phase: 'preview', severity: 'info', code: GAME_PHOTO_JUDGE_CODE, message: `Photo check: ${why[o.state]}.${found}`, autoResolved: true, ...(admin ? { adminDetail: admin } : {}) };
}

/**
 * The one call the build route makes (a helper only — the route stays small): a judge bound to this build's sandbox,
 * vision chain, ledger and tier. Never throws.
 */
export function gamePhotoJudgePort(opts: {
  run: ((command: string) => Promise<{ exitCode?: number; stdout: string }>) | undefined;
  recordUsage: PhotoJudgePorts['recordUsage'];
  markBarren?: () => void;
  power: PowerLevel | null | undefined;
  timeLeft?: () => boolean;
  see?: PhotoJudgePorts['see'];
}): (input: PhotoJudgeInput) => Promise<PhotoJudgeOutcome> {
  const read = sandboxPictureReader(opts.run);
  return async (input) => runGamePhotoJudge(input, {
    readPicture: (shot) => verifiedProofPicture(shot, read),
    see: opts.see ?? (async (atts, o) => (await import('../lib/visionChain')).runVisionChain(atts, o)),
    recordUsage: opts.recordUsage, markBarren: opts.markBarren, power: opts.power, timeLeft: opts.timeLeft,
  });
}

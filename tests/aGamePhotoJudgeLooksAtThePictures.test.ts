// 📸 KADAM 1 — THE PHOTO JUDGE LOOKS AT THE GAME'S PROOF PICTURES (admin decision 2026-11-27).
//
// The playtest took pictures nobody looked at, so "hero kr hath me ek badi gun banao" could be reported done with an empty
// hand. This locks: the questions come from THIS request (at most 3); only a clean YES/NO counts; a clear NO is the
// existing GAME_DEFECT_ASK_NOT_MET; "could not look" (unclear, no reply, timeout, kill switch) never becomes "missing";
// the call's REAL tokens go on the build ledger inside its own billing phase (never estimated); Weak/Normal never reach
// Claude; the user-facing text names no vendor or model.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GAME_PHOTO_JUDGE_CODE, PHOTO_JUDGE_MAX_QUESTIONS, gamePhotoJudgeEnabled, gamePhotoJudgePort, parsePhotoVerdicts, photoJudgeDefects, photoJudgePrompt,
  photoJudgeQuestions, photoJudgeRecord, photoJudgeTier, runGamePhotoJudge, type PhotoJudgePorts,
} from '../src/server/AgentV3/gamePhotoJudge';
import { buildGameContract, heldItemAsked } from '../src/server/AgentV3/gameIntent';
import { currentBillingPhase, PHASE_GAME_PHOTO_JUDGE } from '../src/server/AgentV3/billingPhase';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { ladderDepthUsed } from '../src/server/AgentV3/ladderDepth';
import { gameIncompleteReason } from '../src/server/AgentV3/gameRepair';
import { verifiedProofPicture } from '../src/server/AgentV3/gameProofPictures';
import { runGamePlaytestPhase, type PlaytestIssue } from '../src/server/AgentV3/buildPhases/gamePlaytestPhase';
import { PLAYTEST_RESULT_MARKER, type ProofShot } from '../src/server/AgentV3/gamePlaytest';
import type { VisionResult } from '../src/server/lib/visionChain';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GUN = 'hero kr hath me ek badi gun banao';
const ENEMY = 'enemy bot banao';
const PUBG = 'Make a PUBG style battle royale game with guns, cars and 100 houses';
const VENDORS = /\b(glm|z\.ai|zhipu|gemini|vertex|google|grok|xai|claude|anthropic|haiku|sonnet|opus|kimi|openai|gpt)\b/i;

const jpeg = (fill: number) => { const b = Buffer.alloc(1500, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const idOf = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const shotFor = (view: string, b: Buffer): ProofShot => ({ view, id: idOf(b), w: 480, h: 270, bytes: b.length, path: `/tmp/nbai-playtest-proof/${view}-${idOf(b)}.jpg` });
const pics = [jpeg(1), jpeg(2), jpeg(3)];
const shots = [shotFor('start', pics[0]), shotFor('moved', pics[1]), shotFor('far', pics[2])];
const bytesFor = (s: ProofShot) => pics[shots.findIndex((x) => x.id === s.id)] ?? null;

function ports(over: Partial<PhotoJudgePorts> = {}, reply: Partial<VisionResult> | null = { text: '1: NO', provider: 'GLM', model: 'glm-4.6v-flash', usage: { inputTokens: 4100, outputTokens: 9 } }) {
  const recorded: Array<{ provider: string; usage: any; model?: string; phase: string | null }> = [];
  const see = vi.fn(async () => reply as VisionResult | null);
  const markBarren = vi.fn();
  const p: PhotoJudgePorts = {
    readPicture: async (s) => bytesFor(s), see,
    recordUsage: (provider, usage, model) => { recorded.push({ provider, usage, model, phase: currentBillingPhase() }); },
    markBarren, power: 'weak', env: {}, ...over,
  };
  return { p, see, markBarren, recorded };
}

afterEach(() => { vi.useRealTimers(); });

describe('the questions come from THIS request', () => {
  it('real prompts: the gun in the hand, the enemy bots, the PUBG world', () => {
    expect(heldItemAsked(GUN)).toBe('gun');
    expect(photoJudgeQuestions(GUN, buildGameContract(GUN)).map((q) => q.question)).toEqual(['Is the main character holding a gun in their hand?']);
    expect(photoJudgeQuestions(ENEMY, buildGameContract(ENEMY)).map((q) => q.kind)).toEqual(['enemies']);
    expect(photoJudgeQuestions(ENEMY, null)[0].question).toBe('Are enemy characters (opponents or bots) visible on screen?');
    const pubg = photoJudgeQuestions(PUBG, buildGameContract(PUBG));
    expect(pubg.map((q) => q.kind)).toEqual(['ground', 'houses']);
    expect(pubg[0].question).toMatch(/white haze, fog or water/);
  });
  it('at most three; nothing asked ⇒ no question; a kind already found missing is not asked again', () => {
    const all = 'PUBG jaisa game, hero ke haath me talwar ho, enemies bhi hon';
    const qs = photoJudgeQuestions(all, buildGameContract(all));
    expect(qs.length).toBe(PHOTO_JUDGE_MAX_QUESTIONS);
    expect(qs.map((q) => q.kind)).toEqual(['held', 'enemies', 'ground']);
    expect(qs[0].question).toMatch(/holding a sword/);
    expect(photoJudgeQuestions('make a calculator', null)).toEqual([]);
    expect(photoJudgeQuestions('no gun in his hand please', null)).toEqual([]); // a declined sentence is not an ask
    expect(photoJudgeQuestions(GUN, null, new Set(['held']))).toEqual([]);
  });
  it('the prompt numbers every question and asks for one line each', () => {
    const p = photoJudgePrompt(photoJudgeQuestions(PUBG, buildGameContract(PUBG)));
    expect(p).toMatch(/1: YES or NO or UNCLEAR\n2: YES or NO or UNCLEAR/);
    expect(p).toMatch(/1\. Is the ground or road clearly visible/);
  });
});

describe('only a clean YES or NO counts', () => {
  it('yes / no / unclear, in the forms models write them', () => {
    expect(parsePhotoVerdicts('1: YES\n2: NO\n3: UNCLEAR', 3)).toEqual(['yes', 'no', 'unclear']);
    expect(parsePhotoVerdicts('**1:** No\nQ2. yes', 2)).toEqual(['no', 'yes']);
    expect(parsePhotoVerdicts('1) NO - the hands are empty', 1)).toEqual(['no']);
  });
  it('a missing line, other words, a conflict, an out-of-range number or no reply is UNCLEAR', () => {
    expect(parsePhotoVerdicts('1: YES', 2)).toEqual(['yes', 'unclear']);
    expect(parsePhotoVerdicts('1: maybe', 1)).toEqual(['unclear']);
    expect(parsePhotoVerdicts('1: YES\n1: NO', 1)).toEqual(['unclear']);
    expect(parsePhotoVerdicts('5: NO', 1)).toEqual(['unclear']);
    expect(parsePhotoVerdicts('I cannot see any image.', 1)).toEqual(['unclear']);
    expect(parsePhotoVerdicts(null, 2)).toEqual(['unclear', 'unclear']);
  });
  it('a clear NO is GAME_DEFECT_ASK_NOT_MET with the question as evidence; YES and UNCLEAR are nothing', () => {
    const qs = photoJudgeQuestions('PUBG jaisa game, hero ke haath me gun ho, enemies bhi hon', null);
    const d = photoJudgeDefects(qs, ['no', 'yes', 'unclear']);
    expect(d).toEqual([{ code: 'GAME_DEFECT_ASK_NOT_MET', evidence: 'a look at the game\'s pictures answered NO to "Is the main character holding a gun in their hand?"' }]);
    // The completion gate already reads it as "what you asked for is not in the game yet".
    expect(gameIncompleteReason(d, [], { played: true })).toMatch(/what you asked for is not in the game yet — a look at the game's pictures answered NO/);
  });
});

describe('the run: bounded, billed on the build ledger, silent when it could not look', () => {
  it('a NO becomes a defect, and the REAL reported tokens are recorded inside the photo-judge billing phase', async () => {
    const { p, see, recorded, markBarren } = ports();
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    expect(o.state).toBe('judged');
    expect(o.defects.map((d) => d.code)).toEqual(['GAME_DEFECT_ASK_NOT_MET']);
    expect(see).toHaveBeenCalledTimes(1);
    const [atts, opt] = (see.mock.calls[0] as unknown) as [any[], any];
    expect(atts.map((a) => a.type)).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg']);
    expect(atts[0].base64).toBe(pics[0].toString('base64'));
    expect(opt).toMatchObject({ allowClaude: false, tier: 'free' });
    expect(opt.signal).toBeInstanceOf(AbortSignal);
    expect(recorded).toEqual([{ provider: 'GLM', usage: { inputTokens: 4100, outputTokens: 9 }, model: 'glm-4.6v-flash', phase: PHASE_GAME_PHOTO_JUDGE }]);
    expect(markBarren).not.toHaveBeenCalled();
  });
  it('the same path the build uses: a ledger fed like captureTurnUsage carries the phase, and LADDER_DEPTH ignores it', async () => {
    const ledger = createProviderUsageLedger();
    const { p } = ports({ recordUsage: (prov, usage, model) => ledger.add(prov, usage, model, { phase: currentBillingPhase() ?? undefined }) });
    await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    const entries = ledger.entries() as any[];
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries)).toContain(PHASE_GAME_PHOTO_JUDGE);
    const depth = ladderDepthUsed([{ provider: 'GLM', model: 'glm-4.6v-flash', usage: { inputTokens: 4100, outputTokens: 9 }, phase: PHASE_GAME_PHOTO_JUDGE } as any], [{ provider: 'GLM', model: 'glm-4.6v-flash' } as any]);
    expect(depth.matched).toBe(0);
  });
  it('tokens the provider did not report are recorded as unmeasured, never estimated', async () => {
    const { p, recorded } = ports({}, { text: '1: YES', provider: 'VERTEX', model: 'gemini-2.5-flash-lite' });
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    expect(o.defects).toEqual([]);
    expect(recorded).toEqual([{ provider: 'VERTEX', usage: { inputTokens: 0, outputTokens: 0, measured: false }, model: 'gemini-2.5-flash-lite', phase: PHASE_GAME_PHOTO_JUDGE }]);
  });
  it('the kill switch stops it before any picture is read or any call is made', async () => {
    expect(gamePhotoJudgeEnabled({ AGENTV3_GAME_PHOTO_JUDGE: 'off' } as any)).toBe(false);
    expect(gamePhotoJudgeEnabled({} as any)).toBe(true);
    const readPicture = vi.fn(async () => null);
    const { p, see, recorded } = ports({ env: { AGENTV3_GAME_PHOTO_JUDGE: 'OFF' } as any, readPicture });
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    expect(o.state).toBe('off');
    expect(see).not.toHaveBeenCalled();
    expect(readPicture).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
    expect(photoJudgeRecord(o)).toBeNull();
  });
  it('a timeout is no finding: the call is aborted, the phase is barren, a late answer adds no defect but its cost is still recorded', async () => {
    let finish!: (r: VisionResult) => void;
    let seenSignal: AbortSignal | undefined;
    const { p, markBarren, recorded } = ports({ timeoutMs: 30, see: vi.fn((_a, o) => { seenSignal = o.signal; return new Promise<VisionResult>((r) => { finish = r; }); }) });
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    expect(o.state).toBe('timed-out');
    expect(o.defects).toEqual([]);
    expect(seenSignal?.aborted).toBe(true);
    expect(markBarren).toHaveBeenCalled();
    finish({ text: '1: NO', provider: 'GLM', model: 'glm-4.6v-flash', usage: { inputTokens: 10, outputTokens: 2 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(recorded).toEqual([{ provider: 'GLM', usage: { inputTokens: 10, outputTokens: 2 }, model: 'glm-4.6v-flash', phase: PHASE_GAME_PHOTO_JUDGE }]);
    expect(photoJudgeRecord(o)!.message).toMatch(/ran past its 25 s limit, so nothing is said about the game/);
  });
  it('unclear, no reply, a throwing chain or no readable picture says nothing about the game', async () => {
    for (const reply of [{ text: '1: UNCLEAR', provider: 'GLM' }, { text: 'sorry', provider: 'GLM' }, null] as const) {
      const { p, markBarren } = ports({}, reply as any);
      const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
      expect(o.defects).toEqual([]);
      expect(markBarren).toHaveBeenCalled();
    }
    const thrown = ports({ see: vi.fn(async () => { throw new Error('gateway refused'); }) });
    expect((await runGamePhotoJudge({ shots, request: GUN, contract: null }, thrown.p)).defects).toEqual([]);
    const blind = ports({ readPicture: async () => null });
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, blind.p);
    expect(o.state).toBe('no-pictures');
    expect(blind.see).not.toHaveBeenCalled();
  });
  it('a call settled by the inference gateway is not added to the build ledger twice', async () => {
    const { p, recorded } = ports({}, { text: '1: YES', provider: 'GLM', usage: { inputTokens: 5, outputTokens: 1 }, inferenceGateway: { version: 1, logicalRequestId: 'x', accounting: 'separate-ledger' } } as any);
    await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    expect(recorded).toEqual([]);
  });
  it('tiers: Weak and Normal never reach Claude; Strong may, last', () => {
    expect(photoJudgeTier('weak')).toEqual({ allowClaude: false, tier: 'free' });
    expect(photoJudgeTier('off')).toEqual({ allowClaude: false, tier: 'free' });
    expect(photoJudgeTier('mini')).toEqual({ allowClaude: true, tier: 'paid' });
    expect(photoJudgeTier(null)).toEqual({ allowClaude: false, tier: 'free' });
  });
  it('only a picture whose bytes match the playtest\'s own id is looked at', async () => {
    expect(await verifiedProofPicture(shots[0], async () => pics[0])).toEqual(pics[0]);
    expect(await verifiedProofPicture(shots[0], async () => pics[1])).toBeNull();
    expect(await verifiedProofPicture({ ...shots[0], path: '/etc/passwd' }, async () => pics[0])).toBeNull();
  });
});

describe('white label: the user-facing words name no vendor or model', () => {
  it('the report line keeps provider and model in its admin-only detail', async () => {
    const { p } = ports();
    const o = await runGamePhotoJudge({ shots, request: GUN, contract: null }, p);
    const line = photoJudgeRecord(o)!;
    expect(line.code).toBe(GAME_PHOTO_JUDGE_CODE);
    expect(line.message).toMatch(/"Is the main character holding a gun in their hand\?" → NO/);
    expect(line.message).not.toMatch(VENDORS);
    expect(o.defects[0].evidence).not.toMatch(VENDORS);
    expect(line.adminDetail).toMatch(/GLM \(glm-4\.6v-flash\); tokens 4100 in \/ 9 out/);
  });
});

describe('the playtest phase hands the pictures to the judge, and the route wires it with one helper call', () => {
  const facts = { enabled: true, buildOk: true, isCanvasGame: true, isImportTurn: false, aborted: false, hasRunCommand: true, hasPreviewUrl: true, awaitsShell: false, platformDone: false, timeLeft: true };
  it('a NO becomes a played defect and one admin line is recorded', async () => {
    const issues: PlaytestIssue[] = [];
    const judge = gamePhotoJudgePort({ run: undefined, recordUsage: () => {}, power: 'weak', see: async () => ({ text: '1: NO', provider: 'GLM' }) });
    const judgePhotos = vi.fn((input: Parameters<typeof judge>[0]) => runGamePhotoJudge(input, { ...ports().p, see: async () => ({ text: '1: NO', provider: 'GLM' }) }));
    const out = await runGamePlaytestPhase({
      facts, files: {}, contract: null, request: GUN,
      play: async () => ({ stdout: PLAYTEST_RESULT_MARKER + JSON.stringify({ ok: true, idle: 0.1, moves: [], fps: 30, proofShots: [...shots, { view: 'x', error: 'y' }] }) }),
      readFile: async () => null, record: (i) => issues.push(i), previousIssues: async () => [], versions: async () => [], turnStartedAt: Date.now(),
      fix: { fixTurn: false, record: () => {}, say: () => {} } as any, judgePhotos,
    });
    expect(judgePhotos).toHaveBeenCalledWith(expect.objectContaining({ shots, request: GUN }));
    expect(out?.played?.defects.filter((d) => d.code === 'GAME_DEFECT_ASK_NOT_MET').map((d) => d.evidence)).toContain('a look at the game\'s pictures answered NO to "Is the main character holding a gun in their hand?"');
    expect(issues.filter((i) => i.code === GAME_PHOTO_JUDGE_CODE).length).toBe(1);
    expect(typeof judge).toBe('function');
  });
  it('the route passes the judge its ledger, its barren set, its tier and its time check', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/judgePhotos: gamePhotoJudgePort\(\{ run: [^\n]*recordUsage: captureTurnUsage, markBarren: \(\) => barrenPhases\.add\(PHASE_GAME_PHOTO_JUDGE\), power: powerLevelReqEffective, timeLeft: /);
    expect(route).not.toMatch(/photoJudgeQuestions\(|parsePhotoVerdicts\(/); // the body is not inline in the route
  });
});

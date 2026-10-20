import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { namesNoObject, assessBuildInput } from '../src/server/AgentV3/buildableInput';
import { judgeClarity, parseClarityReply, clarifyReply, categoryFromWords, shouldJudgeClarity, bestGuessPrompt, clarityGateEnabled, LONG_SPEC_WORDS } from '../src/server/AgentV3/clarityGate';
import { voiceOf } from '../src/server/AgentV3/platformVoice';
import { goldenScaffoldForPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';

const vagueJudge = async () => '{"clear":false,"category":"general"}';
const clearJudge = async () => '{"clear":true,"category":"general"}';
const gate = (o: Partial<Parameters<typeof shouldJudgeClarity>[0]> = {}) => shouldJudgeClarity({
  enabled: true, newBuild: true, workspaceHoldsOnlyOurStarter: true, earlierBuildableRequest: false,
  importing: false, attachments: 0, askedLastTurn: false, alreadyAsking: false, ...o,
});

describe('the 7 sample prompts never reach a build', () => {
  it.each(['please ek app banana!!', 'Mujhe ek app bnakar do', 'website bana do'])('%s — caught by the deterministic check, message in the user\'s language', (p) => {
    expect(namesNoObject(p)).toBe(true);
    const v = assessBuildInput(p);
    expect(v.buildable).toBe(false);
    if (!v.buildable && voiceOf(p) !== 'en') expect(v.message).toBe(clarifyReply(categoryFromWords(p), voiceOf(p)).text);
  });
  it.each(['ek accha sa app banao', 'mere business ke liye app banao', 'ek game banao', 'kuch bhi bana do yaar'])('%s — passes the word check, so the judge decides (vague ⇒ ask)', async (p) => {
    expect(gate({ prompt: p })).toBe(true);
    expect((await judgeClarity(p, vagueJudge)).verdict).toBe('vague');
  });
  it('the chips fit what they said', () => {
    expect(clarifyReply(categoryFromWords('ek game banao'), voiceOf('ek game banao')).chips.map((c) => c.label)).toEqual(['Racing', 'Quiz', 'Puzzle', 'Snake']);
    expect(clarifyReply(categoryFromWords('mere business ke liye app banao'), 'hinglish').chips.map((c) => c.label)).toEqual(['Billing app', 'Inventory', 'Booking', 'Customer khata']);
    expect(categoryFromWords('kuch bhi bana do yaar')).toBe('general');
    const hi = clarifyReply('game', 'hindi');
    expect(hi.text).toMatch(/[\u0900-\u097F]/);
    expect(clarifyReply('game', 'en').text).toBe('Sure! Which game should I make? Tell me in one line — or pick one below.');
    for (const c of ['general', 'business', 'game', 'education', 'health', 'personal', 'website'] as const) {
      const r = clarifyReply(c, 'hinglish');
      expect(r.chips.length).toBeGreaterThanOrEqual(3);
      expect(r.chips.length).toBeLessThanOrEqual(4);
      for (const ch of r.chips) expect(namesNoObject(ch.send)).toBe(false); // a chip is itself a clear request
    }
  });
});

describe('clear requests stay buildable', () => {
  it.each(['calculator banakar do', 'todo app', 'ek shop billing app banao'])('%s', async (p) => {
    expect(namesNoObject(p)).toBe(false);
    expect((await judgeClarity(p, clearJudge)).verdict).toBe('clear');
  });
  it('a starter chip / golden template never consults the judge', () => {
    const chip = (STARTER_TEMPLATES as any[]).find((t) => t.id === 'panchang').prompt as string;
    expect(goldenScaffoldForPrompt(chip)).not.toBeNull();
    expect(namesNoObject(chip)).toBe(false);
    expect(gate({ prompt: chip, isStarterPrompt: goldenScaffoldForPrompt(chip) !== null })).toBe(false);
  });
  it('a long spec never consults the judge', () => {
    const spec = 'Build an app for my coaching centre where students log in, see the weekly timetable, take MCQ tests and parents get SMS of the marks';
    expect(spec.split(/\s+/).length).toBeGreaterThanOrEqual(LONG_SPEC_WORDS);
    expect(gate({ prompt: spec })).toBe(false);
  });
  it('edits, imports, attachments, non-empty workspaces and the reply to our question are never gated', () => {
    expect(gate({ newBuild: false })).toBe(false);
    expect(gate({ importing: true })).toBe(false);
    expect(gate({ attachments: 1 })).toBe(false);
    expect(gate({ workspaceHoldsOnlyOurStarter: false })).toBe(false);
    expect(gate({ earlierBuildableRequest: true })).toBe(false);
    expect(gate({ askedLastTurn: true })).toBe(false);
    expect(gate({ enabled: clarityGateEnabled({ AGENTV3_CLARITY_GATE: 'off' }) })).toBe(false);
    expect(clarityGateEnabled({})).toBe(true);
  });
});

describe('the judge fails OPEN', () => {
  it('timeout ⇒ unknown (build)', async () => {
    const v = await judgeClarity('ek game banao', () => new Promise<string>(() => {}), { timeoutMs: 30 });
    expect(v.verdict).toBe('unknown');
  });
  it('error ⇒ unknown', async () => {
    expect((await judgeClarity('ek game banao', async () => { throw new Error('429'); })).verdict).toBe('unknown');
  });
  it('garbage / prose ⇒ unknown; only an explicit false is vague', () => {
    expect(parseClarityReply('I think it is vague').verdict).toBe('unknown');
    expect(parseClarityReply('{"clear":"no"}').verdict).toBe('unknown');
    expect(parseClarityReply('```json\n{"clear":false,"category":"game"}\n```')).toEqual({ verdict: 'vague', category: 'game' });
    expect(parseClarityReply('{"clear":false,"category":"spaceship"}').category).toBeNull();
  });
});

describe('never twice in a row', () => {
  it('the reply builds the best guess from both messages and says what was assumed', () => {
    const p = bestGuessPrompt('ek game banao', 'koi bhi');
    expect(p).toContain('ek game banao');
    expect(p).toContain('koi bhi');
    expect(p).toMatch(/Do not ask again/);
    expect(p).toMatch(/saying what you assumed/);
  });
  it('wired: the route records a clarify turn, skips both gates after it, and emits the chips', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("lastRequestTurn.lane === 'clarify'");
    expect(route).toContain('const askWhatToBuild = !askedClarifyLastTurn && namesNothingToBuild');
    expect(route).toContain('prompt = bestGuessPrompt(lastRequestTurn.text, typedPrompt);');
    expect(route).toContain("if (clarifyChips) { if (!echoesPlatformNotice) chatMem.recordRequest(prompt, undefined, 'clarify'); }");
    expect(route).toContain("chatEvents.emit({ type: 'quick_replies', chips: clarifyChips");
    expect(route).toContain("if (v.verdict === 'vague') { clarity = { category: v.category }; intent = 'chat'; }");
  });
});

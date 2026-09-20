import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decideComplexity,
  fallbackVerdict,
  needsSecondOpinion,
  complexityFromScore,
  startLadderForComplexity,
} from '../src/server/AgentV3/complexityRouting';
import { analyzeRequest, scriptNeutralFloor, signalsCouldNotRead } from '../src/server/AgentV3/RequestAnalyser';
import { namesBusinessDomain } from '../src/server/lib/appComplexitySignals';
import { sandboxBillingNote, sandboxCost } from '../src/server/AgentV3/sandboxCost';

/**
 * AUTOPSY bb688add (2026-09-20), the UPSTREAM half — why a printable one-page invitation card took
 * 16.4 minutes and ₹177.98 on the free tier.
 *
 * The prompt is Devanagari, so the scorer could not read it and correctly asked for a second opinion.
 * The second opinion was unavailable. The fallback was the deterministic score — 68, COMPLEX, because
 * `scriptNeutralFloor` reads `text.length > 800` — so the build skipped the cheap opener, every
 * preamble call cost ~48s on the slower rung, and the shared contract was starved.
 *
 * A long PROMPT is not a big APP. An invitation, a biodata, a certificate, a legal notice: long, full
 * of separators between FACTS rather than features, and every one of them a single page.
 */

// The real prompt, abridged to its shape: Devanagari, long, one page, many short lines.
const INVITATION = [
  '!! नमो तस्य भगवतो अरहतो सम्मासमबुद्धस्य !!',
  'परमपूज्य बोधिसत्व बाबा साहब डॉ. आम्बेडकर के स्वर्णिम विचारों से वैज्ञानिक सोच पर',
  'आधारित आदर्श समाज की स्थापना हेतु सामाजिक नवनिर्माण की ओर..',
  '',
  'मंगल विवाह संस्कार — निश्चय पत्र',
  'आयुष्मति संध्या सिंघारिया, श्रद्धेय सुपुत्री श्री भगवान लाल सिंघाड़िया',
  'निवासी सोजत सिटी, जिला पाली, जन्म दिनांक 05-09-1997, प्रदेश राजस्थान',
  'आयुष्मान अभिषेक नवल, श्रद्धेय सुपुत्र श्री चम्पालाल नवल',
  'निवासी जोधपुर, जिला जोधपुर, जन्म दिनांक 03-02-1998, प्रदेश राजस्थान',
  'दिनांक 03 माह दिसंबर वर्ष 2026, स्थान सूरज गढ़ रिसोर्ट जोधपुर, समय 11:00 AM',
  'हस्ताक्षर लड़की पक्ष, हस्ताक्षर लड़का पक्ष, हस्ताक्षर गणमान्य 1. 2. 3. 4. 5.',
  'यह सम्बध आयुष्मति संध्या सिंघारिया व आयुष्मान अभिषेक नवल की इच्छा व दोनों पक्षों के परिवारों की',
  'आपसी सहमति से स्थापित हुआ है, हम सब इनके सुखद व समृद्ध गृहस्थ जीवन की मंगल कामना करते है।',
  'भवतु सब्ब मंगलं । महाकारुणिक बुद्ध व बाबा साहेब आम्बेडकर के संघर्ष और त्याग से',
  'शांति शिक्षा विहार, मिशन स्वाभिमान, सम्पर्क सूत्र : 94677 89014',
].join('\n');

describe('the premise — reproduced from the real prompt, to the score', () => {
  it('the scorer admits it cannot read this request', () => {
    expect(signalsCouldNotRead(INVITATION)).toBe(true);
  });

  it('🔴 the word विवाह made a printed card a complex APP — the guard could not read the script its own signal reads', () => {
    // `events` deliberately matches शादी|विवाह|समारोह|मेला|कार्यक्रम. Its two narrowing guards were
    // pure ASCII, so in Devanagari the promotion ran unguarded. The real build recorded
    // `taskType: complex_app`, score 68, and "domain=events, 7 likely-missing feature(s)" —
    // ticket types, RSVP, QR check-in and payments, for an invitation card.
    expect(/विवाह/.test(INVITATION)).toBe(true);
    expect(namesBusinessDomain(INVITATION.toLowerCase())).toBe(false);
    expect(analyzeRequest({ prompt: INVITATION }).taskType).not.toBe('complex_app');
  });

  it('a genuine Hindi SYSTEM request is still promoted — the guard narrows, it does not switch off', () => {
    const hospital = 'एक अस्पताल प्रबंधन सिस्टम बनाओ जिसमें डॉक्टर लॉगिन, मरीज़ रिकॉर्ड, अपॉइंटमेंट और बिलिंग हो';
    expect(namesBusinessDomain(hospital.toLowerCase())).toBe(true);
  });

  it('and it correctly buys a second opinion — that part was never the bug', () => {
    expect(needsSecondOpinion(analyzeRequest({ prompt: INVITATION }).complexityScore, INVITATION)).toBe(true);
  });

  it('⚠️ the script-neutral FLOOR still calls it 58, and that is deliberately left alone', () => {
    // `text.length > 800 || parts >= 6` is a crude proxy — a pasted document is long and full of
    // separators between FACTS. But the floor exists so a Devanagari hospital app is not scored 5,
    // and nobody has measured a better rule. The ROUTING is made safe by the fallback below instead.
    expect(scriptNeutralFloor(INVITATION)).toBe(58);
  });
});

describe('🔴 an admitted unknown falls to simple, which is this module\'s own stated default', () => {
  it('no second opinion available ⇒ simple, not the expensive guess', async () => {
    const d = await decideComplexity({ prompt: INVITATION, score: 68 }, undefined);
    expect(d.verdict).toBe('simple');
    expect(d.reason).toContain('could not read');
  });

  it('the second opinion throws ⇒ simple', async () => {
    const d = await decideComplexity(
      { prompt: INVITATION, score: 68 },
      async () => { throw new Error('nano down'); },
    );
    expect(d.verdict).toBe('simple');
    expect(d.source).toBe('model-unavailable');
  });

  it('the second opinion answers nonsense ⇒ simple', async () => {
    const d = await decideComplexity({ prompt: INVITATION, score: 68 }, async () => 'perhaps?');
    expect(d.verdict).toBe('simple');
  });

  it('but a second opinion that DOES answer is obeyed — the ask still decides', async () => {
    const d = await decideComplexity({ prompt: INVITATION, score: 68 }, async () => 'complex');
    expect(d.verdict).toBe('complex');
    expect(d.source).toBe('model');
  });

  it('🔒 a READ request near the line is untouched — its score still stands', async () => {
    const readable = 'build a hospital management system with doctor logins, patient records, appointments and billing';
    expect(signalsCouldNotRead(readable)).toBe(false);
    const score = analyzeRequest({ prompt: readable }).complexityScore;
    const d = await decideComplexity({ prompt: readable, score }, undefined);
    expect(d.verdict).toBe(complexityFromScore(score));
  });

  it('the fallback rule itself: only an admitted unknown is redirected', () => {
    expect(fallbackVerdict('complex', true)).toBe('simple');
    expect(fallbackVerdict('complex', false)).toBe('complex');
    expect(fallbackVerdict('simple', true)).toBe('simple');
  });

  it('and simple means the cheap opener is kept — the ladder climbs if it has to', () => {
    const rungs = [
      { name: 'GLM', model: 'glm-4.7-flashx' },
      { name: 'KIMI', model: 'kimi-k2.7-code' },
    ] as never;
    expect(startLadderForComplexity(rungs, 'simple')[0]).toMatchObject({ model: 'glm-4.7-flashx' });
    expect(startLadderForComplexity(rungs, 'complex')[0]).toMatchObject({ model: 'kimi-k2.7-code' });
  });
});

describe('the admin cost line must name the number that reached the bill', () => {
  const env = { AGENTV3_BILL_SANDBOX: 'on', E2B_USD_PER_HOUR: '0.1656' } as NodeJS.ProcessEnv;

  it('🔴 reproduces bb688add: 1310s held, 986s billed — both are said, neither is invented', () => {
    const note = sandboxBillingNote(sandboxCost(1310), env, 986);
    expect(note).toContain('1310s held');
    expect(note).toContain('986s of it reached');
    expect(note).toContain('$0.0454');     // what the bill really used
    expect(note).toContain('$0.0603');     // what the VM really cost us
  });

  it('when nothing was capped the line is exactly as it was', () => {
    expect(sandboxBillingNote(sandboxCost(1310), env, 1310)).toContain("included in this build's real cost");
    expect(sandboxBillingNote(sandboxCost(1310), env)).toContain("included in this build's real cost");
  });

  it('a LARGER or absent billed figure is never treated as a cap — it is not a fact about this bill', () => {
    expect(sandboxBillingNote(sandboxCost(900), env, 5000)).toContain("included in this build's real cost");
    expect(sandboxBillingNote(sandboxCost(900), env, NaN)).toContain("included in this build's real cost");
  });

  it('the off and unset-rate branches are untouched', () => {
    expect(sandboxBillingNote(sandboxCost(1310), {} as NodeJS.ProcessEnv, 986)).toContain('absorbed by NavBharatAI');
    expect(sandboxBillingNote(sandboxCost(1310), { AGENTV3_BILL_SANDBOX: 'on' } as NodeJS.ProcessEnv, 986)).toContain('NOT billed');
  });
});

describe('our own clock is not a provider failure', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('🔴 a budget-ended call is neither called a failure nor tallied against the engine', () => {
    expect(route).toContain('if (isBudgetEndedError(err)) {');
    expect(route).toContain('was stopped by one of our own clocks, not by anything the engine did');
    // The tally is what produced `providerFailures: { KIMI: 1 }` for a call KIMI answered nothing
    // wrong in — it must sit BELOW the early return.
    const guard = route.indexOf('if (isBudgetEndedError(err)) {');
    const tally = route.indexOf('buildDiag.recordProviderFailure(name, err)');
    expect(guard).toBeGreaterThan(-1);
    expect(tally).toBeGreaterThan(guard);
  });

  it('a REAL provider failure still reads and tallies exactly as before', () => {
    expect(route).toContain('Provider ${name} failed — falling back to the next provider');
  });

  it('the cost line reuses the ONE measurement rather than a second copy of the capping rule', () => {
    expect(route).toContain('billableSandboxDetail(actuator, workspaceId, billingCtx.buildStartedAt).measuredSeconds');
  });
});

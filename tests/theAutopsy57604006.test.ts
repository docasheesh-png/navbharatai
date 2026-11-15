// AUTOPSY 57604006 (2026-11-15) — a 4-build battle-royale session on the build that ships edit promotion.
// Real prompts and real facts from the report are used below; nothing is paraphrased where it matters.
//
//   P1  PROJECT_MEMORY said "no brief" in ALL FOUR builds — including build 0, a brand-new game. The brief was chosen by the
//       route's `intent`, which was not 'new_build' on the live turn. (Defect in the edit-promotion change itself.)
//   P2  Build 9ed80cc9: the engine ran out of providers, the gate was RED, the build FAILED — and the report also said
//       "the app rendered 686 s in" and, a second later, "I could not open your app". Two verdicts about one fact; and a
//       failed build's half-finished candidate was eligible to become the VERIFIED version.
//   P3  ENGINE_R1 "failed" 45/45 and 28/28 calls, every one with the public wording. Its client refuses calls BEFORE any
//       request when an accounting fence says so (one fence is sticky for the process), so the report blamed the
//       provider for what may have been our own refusal — and the rung was retried on every single call.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareProjectMemory, asksForTheApp, memoryMessageFor, recordUserMessage } from '../src/server/AgentV3/projectMemoryTurn';
import { InMemoryRequirementsStore, ensureLedger } from '../src/server/AgentV3/projectRequirementsStore';
import { applyMessage, emptyLedger, renderRequirements } from '../src/server/AgentV3/projectRequirements';
import { decideRelease, renderEvidence, renderedInBuildUnchanged, buildOkOf } from '../src/server/AgentV3/editRelease';
import { assessEditCandidate } from '../src/server/AgentV3/editPromotionGate';
import { greenGuardShouldTellUnverified } from '../src/server/AgentV3/GreenGuard';
import { RouterOneAccountingUnavailableError, isRouterOneAccountingRefusal, routerOneRefusalReason } from '../src/server/AI/RouterOne/accounting';
import { PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../src/server/lib/buildEngineError';
import { fallbackDetail } from '../src/server/AgentV3/providerErrorClass';
import { makeMultiProviderTurnRunner, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { cityGame } from './fixtures/threeDGame';

const BUILD0 = 'athree map ke use kar ke ek battel royal game banao'; // the report's first message, verbatim
const BUILD3 = '1. is map ko 10 time bigger banao!\n2. setting button par click karne se, button moves nahi ho rahe hai, only 1 button move ho raha hai (only setting button itself) mujhe sabhi buttons move karwane hai, jitne bhi buttons hai, sabhi';
const isBuild = (t: string) => asksForTheApp('chat', false, t);

describe('P1 · the brief is the message that asked for the app — decided by what it says', () => {
  it('🔴 build 0: the real first message is a build request even when the route read the turn as an edit', () => {
    expect(asksForTheApp('edit_existing', false, BUILD0)).toBe(true);
    expect(asksForTheApp('chat', false, 'kya haal hai')).toBe(false);
  });
  it('🔴 the brief exists after the first turn, with the route\'s intent being wrong', async () => {
    const store = new InMemoryRequirementsStore();
    const r = await prepareProjectMemory({ projectId: 'w', message: BUILD0, isBuildRequest: asksForTheApp('edit_existing', false, BUILD0), replace: false, readTranscript: async () => null, isBuildText: isBuild, store });
    expect(r.ledger?.brief?.text).toBe(BUILD0);
    expect(r.text).toMatch(/Original brief/);
  });
  it('a message first stored as plain chat can still become the brief when it is seen again as the request', async () => {
    const store = new InMemoryRequirementsStore();
    await recordUserMessage('w', BUILD0, false, false, store); // the chat lane saw it first
    expect((await store.load('w')).status === 'ok' && (await store.load('w') as { ledger: { brief: unknown } }).ledger.brief).toBeNull();
    const l = applyMessage((await store.load('w') as { ledger: ReturnType<typeof emptyLedger> }).ledger, { id: (await store.load('w') as { ledger: { processed: string[] } }).ledger.processed[0], text: BUILD0, ts: 2, isBuildRequest: true });
    expect(l.brief?.text).toBe(BUILD0);
  });
  it('🔴 a ledger stored WITHOUT a brief (all four builds\' ledgers) is repaired from the saved conversation, keeping what it had', async () => {
    const store = new InMemoryRequirementsStore();
    await store.replace('w', applyMessage(emptyLedger(), { id: 'x1', text: 'Always keep the map visible on the HUD.', ts: 5 })); // no brief, one requirement
    const transcript = [{ role: 'user', content: BUILD0 }, { role: 'assistant', content: 'ok' }, { role: 'user', content: BUILD3 }];
    const r = await ensureLedger(store, 'w', async () => transcript, isBuild);
    expect(r.status).toBe('rebuilt');
    if (r.status === 'unrecoverable') throw new Error('unexpected');
    expect(r.ledger.brief?.text).toBe(BUILD0);
    expect(renderRequirements(r.ledger)).toMatch(/map visible on the HUD/); // the stored requirement survived the repair
    const again = await ensureLedger(store, 'w', async () => { throw new Error('not needed'); }, isBuild);
    expect(again.status).toBe('ok'); // and it was stored, so the next turn does not read the transcript
  });
  it('an unreadable transcript never costs a brief-less ledger its stored requirements', async () => {
    const store = new InMemoryRequirementsStore();
    await store.replace('w', applyMessage(emptyLedger(), { id: 'x1', text: 'Always keep the map visible.', ts: 5 }));
    const r = await ensureLedger(store, 'w', async () => { throw new Error('down'); }, isBuild);
    expect(r.status).toBe('ok');
  });
  it('a bare "yes" to our offer stands for the request that was OFFERED', () => {
    expect(memoryMessageFor('haan', BUILD0, true)).toBe(BUILD0);
    expect(memoryMessageFor(BUILD3, 'x', false)).toBe(BUILD3);
    expect(memoryMessageFor('', 'fallback', false)).toBe('fallback');
  });
});

describe('P2 · a failed build is never a verified version, and the report says one thing about the render', () => {
  const base = { state: 'verified' as const, missing: [], extra: [], differing: [] };
  const gate = assessEditCandidate({ base: cityGame(), candidate: cityGame() });
  it('🔴 build 9ed80cc9: gate RED / build failed, preview rendered → NOT promoted', () => {
    const d = decideRelease({ gate, previewGreen: true, provenBroken: false, base, requirementsOk: true, buildOk: false });
    expect(d.action).toBe('keep-unverified');
    expect(d.reasons.join(' ')).toMatch(/did not finish OK/);
    expect(decideRelease({ gate, previewGreen: true, provenBroken: false, base, requirementsOk: true, buildOk: true }).action).toBe('promote');
  });
  it('a held replacement still outranks everything', () => {
    const bad = assessEditCandidate({ base: cityGame(), candidate: { 'a.ts': '1' }, userMessage: 'tweak' });
    expect(decideRelease({ gate: bad, previewGreen: true, provenBroken: false, base, requirementsOk: true, buildOk: false }).action).toBe('hold');
  });
  it('the in-build render counts as the render when nothing was written after it', () => {
    expect(renderEvidence(false, 1794750000000, 0)).toBe(true);   // the report: rendered at +686 s, nothing written after
    expect(renderEvidence(false, 1794750000000, 3)).toBe(false);  // a later write: that render is not this tree
    expect(renderEvidence(false, 0, 0)).toBe(false);              // no in-build proof at all
    expect(renderEvidence(true, 0, 5)).toBe(true);
    expect(renderedInBuildUnchanged(NaN, 0)).toBe(false);
  });
  it('🔴 "I could not open your app" is not told when the report itself says the app rendered', () => {
    const asked = { hasSnapshot: true, previewGreen: false, filesWrittenThisTurn: 4, stoppedByUser: false };
    expect(greenGuardShouldTellUnverified(asked)).toBe(true); // the old behaviour, unchanged
    expect(greenGuardShouldTellUnverified({ ...asked, renderedInBuild: true })).toBe(false);
  });
  it('buildOkOf reads a missing result as not OK', () => {
    expect(buildOkOf(undefined)).toBe(false);
    expect(buildOkOf({ ok: false })).toBe(false);
    expect(buildOkOf({ ok: true })).toBe(true);
  });
});

describe('P3 · a Router One refusal by OUR accounting is named, and the rung is retired for the run', () => {
  it('keeps the public wording and the public shape, and carries the fence as a non-enumerable reason', () => {
    const e = new RouterOneAccountingUnavailableError('uncertain_fence');
    expect(e.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(Object.keys(e)).toEqual(['name']); // exactly what the public boundary already exposes: no `reason`, no `code`
    expect(JSON.stringify(e)).toBe('{"name":"Error"}');
    expect(isRouterOneAccountingRefusal(e)).toBe(true);
    expect(routerOneRefusalReason(e)).toBe('uncertain_fence');
    expect(routerOneRefusalReason(new Error('x'))).toBeUndefined();
    expect(routerOneRefusalReason(new RouterOneAccountingUnavailableError())).toBe('unspecified');
  });
  it('🔴 the admin detail says WHICH fence — the report no longer reads as a provider outage', () => {
    const d = fallbackDetail(new RouterOneAccountingUnavailableError('no_scope'));
    expect(d).toContain(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(d).toContain('our-accounting-refused:no_scope');
    expect(fallbackDetail(new Error('429 overloaded'))).toBe('429 overloaded');
    expect(fallbackDetail('plain', 3)).toBe('pla');
  });
  const turn = { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end_turn' } as never;
  const params = { system: 's', messages: [{ role: 'user', content: 'go' }], tools: [], maxTokens: 100 } as never;
  it('🔴 45 identical refusals become ONE: the rung is retired after its first refusal, the next rung answers every turn', async () => {
    let r1 = 0, glm = 0;
    const chain: NamedRunner[] = [
      { name: 'ENGINE_R1', runner: { runTurn: async () => { r1++; throw new RouterOneAccountingUnavailableError('uncertain_fence'); } } as never },
      { name: 'GLM', runner: { runTurn: async () => { glm++; return turn; } } as never },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { deadRungs: new Map<string, string>() });
    for (let i = 0; i < 45; i++) await runner.runTurn(params);
    expect(r1).toBe(1);
    expect(glm).toBe(45);
  });
  it('a transient provider error is still NOT retired by this rule (it is only OUR refusal that is deterministic)', async () => {
    let flaky = 0;
    const chain: NamedRunner[] = [
      { name: 'ENGINE_R1', runner: { runTurn: async () => { flaky++; throw new Error('502 bad gateway'); } } as never },
      { name: 'GLM', runner: { runTurn: async () => turn } as never },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { deadRungs: new Map<string, string>() });
    for (let i = 0; i < 3; i++) await runner.runTurn(params);
    expect(flaky).toBeGreaterThan(1);
  });
  it('🔒 census: every pre-flight refusal in the Router One client names its fence', () => {
    const src = readFileSync('src/server/AI/RouterOne/catalogueAccounting.ts', 'utf8');
    const body = src.slice(src.indexOf('export function cataloguePricedRouterOneClient'), src.indexOf('/** Attach only issued evidence.'));
    expect(body).not.toMatch(/new RouterOneAccountingUnavailableError\(\)/);
    expect(readFileSync('src/server/AI/RouterOne/publicPriceSource.ts', 'utf8')).not.toMatch(/new RouterOneAccountingUnavailableError\(\)/);
  });
});

describe('the route is wired to all of it', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('memory by content, the settle by render evidence and build result, the report by fence', () => {
    expect(route).toContain('isBuildRequest: asksForTheApp(intent, offerAccepted, turnMessage),');
    expect(route).toContain('previewGreen: renderEvidence(previewGreen, inBuildGreenAt, postGreenWrites.length)');
    expect(route).toContain('buildOk: buildOkOf(result),');
    expect(route.split('renderedInBuild: renderedInBuildUnchanged(inBuildGreenAt, postGreenWrites.length)').length - 1).toBe(2);
    // The clock path names the fence through fallbackDetail; the provider-failure path names it
    // through the engine-diag marker. Both admin lines must keep a fence, not a bare public sentence.
    expect(route.split('detail: fallbackDetail(err),').length - 1).toBe(1);
    expect(route).toContain('detail: withEngineSafeDiag(err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300), err),');
  });
});

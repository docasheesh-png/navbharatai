// Q-1018 + Q-1019 — ONE MEASUREMENT, TWO ROWS: does the app carry ads of its OWN?
//
// Q-990 built `thirdPartyLimits.ts` so the platform would stop claiming a property only another service
// controls. Its honest sentence has two halves, and only the first was ever measured:
//
//   "ads inside YouTube's own player may still play …"     ← measured (`projectAdServingPlayers`)
//   "The app adds no ads of its own"                       ← ASSERTED, on every build, unchecked
//
// 🔴 Q-1018. That second half is not a safe assumption, and the proof is inside NavBharatAI: our OWN
// Monetization wizard generates an AdSense block (`generateAdsense` in src/lib/paymentSetup.ts — the
// pagead2.googlesyndication.com loader and an `<ins class="adsbygoogle">` slot). A user who added ads
// through our own feature and then asked about ads was told, by us, that their app adds none — a false
// statement about their app, in the one sentence whose whole job is honesty about ads. Same class as
// Q-990 itself (a property asserted with no measured fact behind it), turned on our own sentence.
//
// 🔴 Q-1019, THE SAME FACT READ AGAIN. An edit turn whose whole ask is "remove the ads" on an app that
// plays videos in YouTube's own player has ONE correct outcome: say those ads are not the app's to switch
// off, and change nothing. The platform filed that as a FAILED build — "The build produced no files.
// Please try again" written over the honest answer, the empty-build retry fired to produce the same answer
// on a stronger rung, and on the free tier the upsell asked for credits. `turnAnswer.ts` already held the
// precedent one property over (`pointed`, autopsy 0c2a987a: a pointer to our own APK flow is an answer).
//
// WHY THE TWO ARE ONE CHANGE: the turn is only "answered" when the app has NO ads of its own. If it does,
// "remove the ads" IS something we can do — the script and the slot come out — so a zero-file turn really
// failed and the retry is right. Q-1018's measurement is the precondition, not a bonus.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  projectOwnAdSdks, ownAdsSentence, thirdPartyLimitsEndLine, adFreeClaimCorrection, thirdPartyLimitsBuilderNote,
  editTurnAdFacts, adRemovalIsTheWholeAsk, adRemovalAnsweredNotBuilt, adRemovalAnsweredNote, recordAnsweredNotBuilt,
  projectAdServingPlayers,
} from '../src/server/AgentV3/thirdPartyLimits';
import { readTurnAnswer, answeredWithoutBuilding } from '../src/server/AgentV3/turnAnswer';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { generatePayment } from '../src/lib/paymentSetup';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

/** A YouTube-player app, as the Q-990 report's own build wrote it. */
const PLAYER_APP: Record<string, string> = {
  'src/App.tsx': "export default () => <iframe src={`https://www.youtube.com/embed/${id}`} title=\"video\" />;",
  'index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
};

/** The SAME app after the Monetization wizard added AdSense — the real generated snippet, not a paraphrase. */
const PLAYER_APP_WITH_OUR_ADSENSE: Record<string, string> = {
  ...PLAYER_APP,
  'index.html': `<!doctype html><html><body><div id="root"></div>${generatePayment('adsense', { publisherId: 'ca-pub-1234567890123456', slotId: '9876543210' }).html}</body></html>`,
};

describe('🔴 Q-1018 — the app\'s OWN ads are measured, using the real snippet our own wizard writes', () => {
  it('our own Monetization output is detected as the app serving its own ads', () => {
    // If this ever stops matching, the claim "adds no ads of its own" is unmeasured again.
    expect(generatePayment('adsense', {}).html).toContain('pagead2.googlesyndication.com');
    expect(projectOwnAdSdks(PLAYER_APP_WITH_OUR_ADSENSE)).toEqual(['Google AdSense']);
  });

  it('…and a project with none measures none', () => {
    expect(projectOwnAdSdks(PLAYER_APP)).toEqual([]);
    expect(projectOwnAdSdks({})).toEqual([]);
    expect(projectOwnAdSdks(null)).toEqual([]);
  });

  it('every network is named by its own loader, id or SDK package', () => {
    expect(projectOwnAdSdks({ 'index.html': '<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>' })).toEqual(['Google Ad Manager']);
    expect(projectOwnAdSdks({ 'package.json': '{"dependencies":{"react-native-google-mobile-ads":"^14.0.0"}}' })).toEqual(['Google AdMob']);
    expect(projectOwnAdSdks({ 'android/app/src/main/AndroidManifest.xml': '<meta-data android:value="ca-app-pub-1234567890123456~111"/>' })).toEqual(['Google AdMob']);
    expect(projectOwnAdSdks({ 'src/Ads.tsx': 'const u = "https://c.amazon-adsystem.com/aax2/apstag.js";' })).toEqual(['Amazon']);
    expect(projectOwnAdSdks({ 'src/a.ts': 'fetch("https://contextual.media.net/x")' })).toEqual(['Media.net']);
    expect(projectOwnAdSdks({ 'src/a.ts': 'import "https://cdn.taboola.com/libtrc/x/loader.js";' })).toEqual(['Taboola']);
    expect(projectOwnAdSdks({ 'src/a.ts': 'const s = "https://widgets.outbrain.com/outbrain.js";' })).toEqual(['Outbrain']);
    expect(projectOwnAdSdks({ 'src/a.ts': '// https://www.highperformanceformat.com/x.js' })).toEqual(['Adsterra']);
    expect(projectOwnAdSdks({ 'src/a.ts': 'const s = "https://propu.sh/x";' })).toEqual(['PropellerAds']);
  });

  it('🔒 PRECISION-FIRST: prose, a hidden ad slot and our own test files never count as the app serving ads', () => {
    // A user whose app has no ads must never be warned about ads they do not have.
    expect(projectOwnAdSdks({ 'src/App.tsx': '// no ads anywhere in this app; advertising is off' })).toEqual([]);
    expect(projectOwnAdSdks({ 'src/App.tsx': 'const label = "Advertisement";' })).toEqual([]);
    expect(projectOwnAdSdks({ 'src/App.test.tsx': '<script src="https://pagead2.googlesyndication.com/x" />' })).toEqual([]);
    expect(projectOwnAdSdks({ 'node_modules/x/index.js': 'pagead2.googlesyndication.com' })).toEqual([]);
    expect(projectOwnAdSdks({ 'dist/bundle.js': 'pagead2.googlesyndication.com' })).toEqual([]);
    // A placeholder publisher id with no loader is not an ad unit.
    expect(projectOwnAdSdks({ 'src/a.ts': 'const PUB = "ca-pub-XXXXXXXXXXXXXXXX";' })).toEqual([]);
    // A style file is not app logic, and `.adsbygoogle{display:none}` HIDES ads rather than serving them.
    expect(projectOwnAdSdks({ 'src/app.css': '.adsbygoogle { display: none }' })).toEqual([]);
  });

  it('🔴 the sentence the user reads is now MEASURED — it was false for the app above', () => {
    const honest = thirdPartyLimitsEndLine('remove the ads', 'Updated the header colour.', ['YouTube'], {}, []);
    expect(honest).toContain('The app adds no ads of its own');

    const measured = thirdPartyLimitsEndLine('remove the ads', 'Updated the header colour.', ['YouTube'], {}, ['Google AdSense']);
    expect(measured, 'the claim that was never checked').not.toContain('adds no ads of its own');
    expect(measured).toContain('its own ad slots (Google AdSense)');
    expect(measured).toContain('those ARE yours to switch off');
  });

  it('…and so is NavBharatAI\'s own correction of an "ad-free" claim', () => {
    const fix = adFreeClaimCorrection('Your ad-free video player is ready.', ['YouTube'], {}, ['Google AdSense', 'Taboola']);
    expect(fix).toContain('Google AdSense and Taboola');
    expect(adFreeClaimCorrection('Your ad-free video player is ready.', ['YouTube'], {}, [])).toContain('adds no ads of its own');
  });

  it('🔑 THE PREVENT HALF (50/50 law): the builder is told to REMOVE the ads that are ours to remove', () => {
    const told = thirdPartyLimitsBuilderNote(true, ['YouTube'], ['Google AdSense']);
    expect(told).toContain('already serves its OWN ads (Google AdSense)');
    expect(told).toContain('ARE yours to remove and the user just asked you to');
    // Without own ads the instruction is the old one — "add none of your own" — and nothing is invented.
    expect(thirdPartyLimitsBuilderNote(true, ['YouTube'], [])).toContain('Add no ads of your own');
    expect(thirdPartyLimitsBuilderNote(true, ['YouTube'], [])).not.toContain('ARE yours to remove');
    expect(thirdPartyLimitsBuilderNote(false, ['YouTube'], ['Google AdSense'])).toBe('');
  });

  it('ownAdsSentence is empty when there is nothing to say', () => {
    expect(ownAdsSentence([])).toBe('');
    expect(ownAdsSentence(null)).toBe('');
  });

  it('🔒 ONE LOAD, BOTH FACTS — the two questions are asked of the same files, and the store is read once', () => {
    let loads = 0;
    const load = async () => { loads += 1; return PLAYER_APP_WITH_OUR_ADSENSE; };
    return editTurnAdFacts('remove the ads', { editTurn: true, importTurn: false }, load, {}).then((facts) => {
      expect(facts).toEqual({ players: ['YouTube'], ownAds: ['Google AdSense'] });
      expect(loads, 'one turn, one read of the durable store').toBe(1);
    });
  });

  it('🔒 nothing is loaded on a turn that did not ask about ads, and a dead store is "nothing known"', async () => {
    let loads = 0;
    const count = async () => { loads += 1; return PLAYER_APP; };
    expect(await editTurnAdFacts('make the header blue', { editTurn: true, importTurn: false }, count, {})).toEqual({ players: [], ownAds: [] });
    expect(await editTurnAdFacts('remove the ads', { editTurn: false, importTurn: false }, count, {})).toEqual({ players: [], ownAds: [] });
    expect(await editTurnAdFacts('remove the ads', { editTurn: true, importTurn: true }, count, {})).toEqual({ players: [], ownAds: [] });
    expect(loads).toBe(0);
    expect(await editTurnAdFacts('remove the ads', { editTurn: true, importTurn: false }, async () => { throw new Error('store down'); }, {})).toEqual({ players: [], ownAds: [] });
  });
});

describe('🔴 Q-1019 — the honest answer IS the turn, not a failed build', () => {
  /** What the model says when it has been told the truth by the builder note. */
  const HONEST = 'The videos play in YouTube\'s own player, and ads inside that player may still play on videos whose owners earn from them — the app cannot switch those off.';
  const FACTS = { editTurn: true, importTurn: false, players: ['YouTube'] as const, ownAds: [] as const };

  it('the whole ask was the one thing we cannot do, the model said so, nothing changed ⇒ an ANSWER', () => {
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS }, {})).toBe(true);
    const answer = readTurnAnswer(HONEST, 'remove the ads', FACTS);
    expect(answer.notOurs).toBe(true);
    expect(answeredWithoutBuilding(answer), 'so no platform sentence is written over it').toBe(true);
  });

  it('🔒 the app serving its OWN ads is a turn that really failed — those ads ARE removable', () => {
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS, ownAds: ['Google AdSense'] }, {})).toBe(false);
    expect(readTurnAnswer(HONEST, 'remove the ads', { ...FACTS, ownAds: ['Google AdSense'] }).notOurs).toBe(false);
  });

  it('🔒 a SECOND ask in the same turn is a turn that really failed — the retry might deliver it', () => {
    for (const prompt of [
      'remove the ads and add a dark mode',
      'remove the ads, also make it faster',
      'ads hata do aur dark mode bhi add karo',
      'remove the ads; fix the login',
      'remove the ads + add search',
      'remove the ads. then publish it',
    ]) {
      expect(adRemovalIsTheWholeAsk(prompt), prompt).toBe(false);
      expect(adRemovalAnsweredNotBuilt({ prompt, modelText: HONEST, ...FACTS }, {}), prompt).toBe(false);
    }
  });

  it('…while the plain ask, in the forms people type it, is the whole ask', () => {
    for (const prompt of ['remove the ads', 'ads hata do', 'the adds are still playing, remove them', 'make it ad-free please', 'no ads']) {
      expect(adRemovalIsTheWholeAsk(prompt), prompt).toBe(true);
    }
    expect(adRemovalIsTheWholeAsk('build me a video app'), 'not an ad-removal ask at all').toBe(false);
    expect(adRemovalIsTheWholeAsk(`remove the ads ${'x'.repeat(200)}`), 'a long request is never "the whole ask"').toBe(false);
    expect(adRemovalIsTheWholeAsk(null)).toBe(false);
  });

  it('🔒 the model must have ACTUALLY given the honest answer — the platform never decides what it said', () => {
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: 'Done! Your app is ad-free now.', ...FACTS }, {})).toBe(false);
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: '', ...FACTS }, {})).toBe(false);
  });

  it('🔒 and it is an EDIT of an app that really embeds such a player', () => {
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS, editTurn: false }, {})).toBe(false);
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS, importTurn: true }, {})).toBe(false);
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS, players: [] }, {})).toBe(false);
    // A Vimeo-only app has no ad-serving player, so there was never anything to explain away.
    expect(projectAdServingPlayers({ 'src/App.tsx': 'const u = "https://player.vimeo.com/video/1";' })).toEqual([]);
  });

  it('kill switch: AGENTV3_THIRD_PARTY_LIMITS=off silences this layer too', () => {
    expect(adRemovalAnsweredNotBuilt({ prompt: 'remove the ads', modelText: HONEST, ...FACTS }, { AGENTV3_THIRD_PARTY_LIMITS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('🔒 the report says it, and the code is PROCESS-ONLY — our retry policy is not a flaw in the user\'s app', () => {
    // An unregistered code costs the user 6 app-health points (`isAppFinding`), which is the Q-1043 class.
    expect(PROCESS_ONLY_CODES.has('TURN_ANSWERED_NOT_OURS')).toBe(true);
    const recorded: Array<Record<string, unknown>> = [];
    recordAnsweredNotBuilt({ record: (r) => recorded.push(r) }, true, adRemovalAnsweredNote(['YouTube']));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ code: 'TURN_ANSWERED_NOT_OURS', severity: 'info', autoResolved: true });
    expect(String(recorded[0].message)).toContain('not retried');
    expect(String(recorded[0].message)).toContain('no upsell was offered');
    recordAnsweredNotBuilt({ record: (r) => recorded.push(r) }, false, 'x');
    expect(recorded, 'nothing is recorded when it did not happen').toHaveLength(1);
    expect(() => recordAnsweredNotBuilt({ record: () => { throw new Error('store down'); } }, true, 'x'), 'a report line never fails a build').not.toThrow();
  });
});

describe('🔴 FOUND WRITING THIS TEST — the form an Indian user types FIRST was never detected', () => {
  // Hindi is subject-object-VERB, so the removal word comes AFTER the ad word. Every removal alternative in
  // `AD_REMOVAL_ASKED` was verb-then-noun, so "ads hata do" matched nothing — and with `adRemovalRequested`
  // false, ALL THREE of Q-990's layers stand down: the builder is never told, the user gets no start line,
  // and the honest end line never appears. Q-990 was written from one English report; this is the same
  // module's own blind spot in the language its user base actually writes in.
  it('the SOV imperative, in the forms people send it', () => {
    for (const prompt of [
      'ads hata do', 'adds hatao', 'ads ko hata dijiye', 'ads nikal do', 'ads band karo', 'ads off karo',
      'saare ads hata do', 'विज्ञापन हटाओ', 'ऐड्स को हटा दो',
    ]) {
      expect(adRemovalIsTheWholeAsk(prompt), prompt).toBe(true);
    }
  });

  it('🔒 and the negatives Q-990 pinned still do not match — the ad word must sit beside the verb', () => {
    for (const prompt of [
      'double-tap skip adds 10 seconds',
      'each block adds a new video',
      'add a link to paste',
      'ek naya video add karo',
      'the video adds in the app',
    ]) {
      expect(adRemovalIsTheWholeAsk(prompt), prompt).toBe(false);
    }
  });
});

describe('🔒 the wiring — every verdict that already excused `pointed` now excuses this one too', () => {
  it('both readings of the turn are handed the project facts', () => {
    expect(ROUTE).toContain('const firstAttempt = readTurnAnswer(modelsOwnWords(result), prompt, adAnswerFacts);');
    expect(ROUTE).toContain('const modelAnswer = readTurnAnswer(modelsOwnWords(result), prompt, adAnswerFacts);');
    expect(ROUTE).toContain("const adAnswerFacts = { editTurn: intent === 'edit_existing', importTurn: isImportTurn, players: thirdPartyAdFactsAtStart.players, ownAds: thirdPartyAdFactsAtStart.ownAds };");
  });

  it('the empty-build retry does not fire, and "produced no files" is not written over the answer', () => {
    expect(ROUTE).toContain('modelAskedTheUser: firstAttemptAskedTheUser || firstAttempt.pointed || firstAttempt.notOurs,');
    expect(ROUTE).toContain('modelAnswer.asked || modelAnswer.pointed || modelAnswer.notOurs,');
  });

  it('CLASS CENSUS: every reader of `pointed` reads `notOurs` — the two are the same kind of answer', () => {
    // The defect was that ONE of these groupings lacked a term. A new reader of `pointed` added later
    // without `notOurs` is the same bug again, so the census is over the source, not over a list.
    const lines = ROUTE.split('\n').filter((l) => /\.pointed\b/.test(l) && !l.trimStart().startsWith('//'));
    expect(lines.length, 'the readers of `pointed` must be findable').toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line, line.trim()).toMatch(/\.notOurs\b/);
    // …and `answeredWithoutBuilding` covers every other reader in one place.
    const ta = readFileSync(join(__dirname, '../src/server/AgentV3/turnAnswer.ts'), 'utf8');
    expect(ta).toContain('return answer.declined || answer.asked || answer.pointed || answer.notOurs;');
  });

  it('the report line is recorded on its own condition', () => {
    expect(ROUTE).toContain('recordAnsweredNotBuilt(buildDiag, modelAnswer.notOurs && builderWroteCount() === 0, adRemovalAnsweredNote(thirdPartyAdFactsAtStart.players));');
  });
});

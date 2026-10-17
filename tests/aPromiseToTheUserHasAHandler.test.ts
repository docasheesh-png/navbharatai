/**
 * EVERY "SEND X" WE TELL A USER HAS SOMETHING THAT HANDLES X (autopsy 9c612cdb, Q-997).
 *
 * 🔴 THE BUILD. A green video-list app. The lean review ran out of its 45 s and the user read:
 *   "📋 Your app is built, compiles, and is saved. The deeper completeness review didn't finish in the time it had —
 *    send "review it" and I'll run it on its own."
 * Nothing handles "review it". The post-build review runs only on a turn that WROTE files (`reviewerShouldRun`), and the
 * intent classifier reads "review it" as chat — so the promised action could not happen, which is the second absolute
 * rule broken in one sentence. And on a green app the report had ALREADY filed this exact moment as process-only,
 * "nothing for the user to do" (REVIEW_SUGGESTIONS_NOT_READY, SignBridge 2026-09-26): that fix changed the report code
 * three lines below the narration and never reached the narration. The same promise sat in the salvaged-review line
 * (partialReview.ts, "Send "review it" for a full pass.") and in the admin line for a review that stopped in front of a
 * reasoning engine.
 *
 * 🔑 THE CLASS: a sentence telling the user to send/reply/type/say "X", where nothing makes X do what the sentence says.
 * Such sentences are written by many sessions in many files, months apart, and each is true only while some OTHER module
 * keeps handling X. So this census reads every string the code can show (server, client, root `server.ts`), pulls out
 * every follow-up it tells somebody to send, and requires each one to be either
 *   • HANDLED — listed with the module that makes it work, WHY it works, and an executable proof that runs that
 *     module (the classifier, the offer reader, the exact-phrase net…), so deleting the handler fails here too; or
 *   • NOT A FOLLOW-UP — listed with why (an instruction to a model about its own wording, an API field, an example).
 * A new promise without a handler fails CI. Guilty until listed — the discipline `uiLanguageEnglishOnly` uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { classifyIntentWithConfidence, readerlessIntent } from '../src/server/AgentV3/IntentClassifier';
import { buildConfirmation, isOfferAcceptance } from '../src/server/AgentV3/buildConfirmation';
import { wantsAttemptBack, KEEP_CHANGES_PHRASE } from '../src/server/AgentV3/GreenGuard';
import { unrelatedToExistingApp } from '../src/server/AgentV3/unrelatedRequest';
import { isPictureRequest } from '../src/server/AgentV3/pictureRequest';
import { sessionRecallContextLine } from '../src/server/AgentV3/SessionTimeline';
import { reviewNotReadyUserLine, formatPartialReview, salvageReview } from '../src/server/AgentV3/partialReview';
import { PLATFORM_SUGGESTED_REPLIES, platformSuggestedReply } from '../src/server/AgentV3/platformSuggestedReplies';

const root = process.cwd();
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

// ── The extraction ──────────────────────────────────────────────────────────────────────────────────────────────

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
      if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  walk(join(root, 'src'));
  out.push('server.ts');
  return out;
}

/** The values a template span can take, when the source states them: a literal, a ternary of literals, a const. */
function valuesOf(e: ts.Expression, sf: ts.SourceFile): string[] | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isParenthesizedExpression(e)) return valuesOf(e.expression, sf);
  if (ts.isConditionalExpression(e)) {
    const a = valuesOf(e.whenTrue, sf);
    const b = valuesOf(e.whenFalse, sf);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(e)) {
    let found: string[] | null = null;
    const look = (n: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer
        && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
        found = [n.initializer.text];
        return;
      }
      ts.forEachChild(n, look);
    };
    look(sf);
    return found;
  }
  return null;
}

/** Every text a node can show, with a template's stated alternatives expanded. */
function textsOf(node: ts.Node, sf: ts.SourceFile): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    let acc = [node.head.text];
    for (const span of node.templateSpans) {
      const opts = valuesOf(span.expression, sf) ?? ['${…}'];
      const next: string[] = [];
      for (const a of acc) for (const o of opts) next.push(a + o + span.literal.text);
      acc = next.slice(0, 32);
    }
    return acc;
  }
  return [];
}

/**
 * "send/reply/type/say [back|me|us|with] <quote>X<same-family quote>" — the instruction to SEND something. A verb
 * used as a noun ("does not exist on type 'X'") is not an instruction, so a preposition before it excludes it.
 */
const PROMISE = /(\b\w+\s+)?\b(send|reply|type|say)\b((?:\s+(?:back|me|us|with))*)\s(?:"([^"\n]{1,90})"|“([^”\n]{1,90})”|‘([^’\n]{1,90})’|'([^'\n]{1,90})'|`([^`\n]{1,90})`)/gi;
/**
 * 🔴 AND THE PROMISE IS NOT ALWAYS MADE IN ENGLISH (Q-1037, measured 2026-10-17). The pattern above
 * requires an English verb, so this census — whose FIRST test is named "it is not silently blind" — was
 * blind to every non-English one. `fakeFeatureScan.ts` makes the same promise in ELEVEN languages, and in
 * ten of them the verb is the local one: *Key डालने के बाद मुझे “असली बनाओ” **लिखें***, *“உண்மையாக்கு” என்று
 * **எழுதுங்கள்***. Ten promises to real users, none of them seen here.
 *
 * So the quote comes FIRST in this shape and the verb follows it, which is the word order every one of
 * those sentences uses. The verbs are the ten "write/say it to me" forms this repo actually ships — not a
 * guess at a language, a reading of our own strings.
 */
const PROMISE_SUFFIX_VERB = new RegExp(
  '(?:“([^”\\n]{1,90})”|"([^"\\n]{1,90})")'
  + '[^“”"\\n]{0,24}?'
  + '(?:लिखें|लिखो|बोलो|कहो|লিখুন|লেখো|ਲਿਖੋ|લખો|ଲେଖନ୍ତୁ|எழுதுங்கள்|என்று|రాయండి|ಬರೆಯಿರಿ|എഴുതൂ|لکھیں)',
  'gu',
);
/** …and the other shape the admin line used: '"X" runs a full review on its own'. */
const CLAIMED_COMMAND = /(?:"([^"\n]{1,40})"|“([^”\n]{1,40})”)\s+(?:runs|starts|resumes|restarts|re-runs|will run|brings)\b/gi;
const NOUN_USE = /^(?:on|of|to|from|as|the|a|an|file|mime|content)\s+$/i;

interface Promise_ { file: string; line: number; phrase: string; context: string }

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

function extractPromises(): Promise_[] {
  const found: Promise_[] = [];
  for (const file of sourceFiles()) {
    const src = read(file);
    if (!/\b(?:send|reply|type|say)\b|runs|starts|resumes/i.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      for (const text of textsOf(node, sf)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        for (const m of text.matchAll(PROMISE)) {
          if (m[1] && NOUN_USE.test(m[1])) continue;
          const phrase = m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8];
          found.push({ file, line, phrase: norm(phrase), context: text.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + m[0].length + 40) });
        }
        for (const m of text.matchAll(PROMISE_SUFFIX_VERB)) {
          found.push({ file, line, phrase: norm(m[1] ?? m[2]), context: text.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + m[0].length + 40) });
        }
        for (const m of text.matchAll(CLAIMED_COMMAND)) {
          found.push({ file, line, phrase: norm(m[1] ?? m[2]), context: text.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + m[0].length + 40) });
        }
      }
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      else ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

// ── The registry ────────────────────────────────────────────────────────────────────────────────────────────────

/** A follow-up that ends in a build or edit turn of the app — not answered as chat. */
const reachesWork = (msg: string): boolean => classifyIntentWithConfidence(msg).intent !== 'chat';
/** …and, where the keyword pass is unsure, the message itself confirms the build (buildConfirmation.ts). */
const reachesConfirmedWork = (msg: string): boolean => reachesWork(msg) && buildConfirmation(msg).confirmed;
/**
 * An "add …" order — the commonest edit there is ("add a login page") — is never certain to the keyword pass. The
 * intention reader decides it with the project in front of it ("a request to add … is almost always an EDIT"); with
 * no reader, the fallback is not chat either: an unconfirmed order is answered with an offer, and "yes" builds it.
 * Measured, not assumed: neither step reads it as chat.
 */
const reachesReaderAsWork = (msg: string): boolean => reachesWork(msg) && readerlessIntent(msg) !== 'chat';

const BUILD_ROUTE = 'src/server/AgentV3/IntentClassifier.ts → src/server/routes/agentv3.ts';
const RECAP = 'the build prompt carries the conversation recap ([CONVERSATION SO FAR], buildRunningSummary) and the project context, so "it" / "these" refers to what we just offered';

interface Handled { handler: string; why: string; proof: () => boolean }

const HANDLED_FOLLOW_UPS: Record<string, Handled> = {
  continue: {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/ProjectPlan.ts; src/server/AgentV3/ProjectContext.ts`,
    why: 'a continuation signal (edit_existing, high); the project context resumes the previous plan "only when the current request just says continue", and ProjectPlan resumes a paused module',
    proof: () => { const c = classifyIntentWithConfidence('continue'); return c.intent === 'edit_existing' && c.signal === 'continuation'; },
  },
  'try again': {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/ProjectContext.ts`,
    why: 'the same continuation signal as "continue" (IntentClassifier lists retry / try again); the earlier requests ride in the project context',
    proof: () => classifyIntentWithConfidence('try again').signal === 'continuation',
  },
  'fix it': { handler: BUILD_ROUTE, why: `an explicit fix order (edit_existing, high); ${RECAP}`, proof: () => reachesConfirmedWork('fix it') },
  'fix them': { handler: BUILD_ROUTE, why: `an explicit fix order (edit_existing, high); ${RECAP}`, proof: () => reachesConfirmedWork('fix them') },
  'fix these': { handler: BUILD_ROUTE, why: `an explicit fix order; the offered findings are in the conversation; ${RECAP}`, proof: () => reachesConfirmedWork('fix these') },
  'fix the styling': { handler: BUILD_ROUTE, why: 'a self-describing fix order (edit_existing, high)', proof: () => reachesConfirmedWork('fix the styling') },
  'fix the production build': { handler: BUILD_ROUTE, why: 'a self-describing order; on a workspace that holds the user\'s app a build order is read as an edit (BUILD_ORDER_READ_AS_EDIT)', proof: () => reachesConfirmedWork('fix the production build') },
  'fix the boot guard': {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/systemPrompt.ts`,
    why: 'an explicit fix order, and the builder\'s own prompt says what to do when the user asks to "fix the boot guard"',
    proof: () => reachesConfirmedWork('fix the boot guard') && read('src/server/AgentV3/systemPrompt.ts').includes('"fix the boot guard"'),
  },
  'create the missing files': { handler: BUILD_ROUTE, why: 'a self-describing build order on the imported app (read as an edit there)', proof: () => reachesConfirmedWork('create the missing files') },
  'make it real': { handler: BUILD_ROUTE, why: `a build order on the existing app (read as an edit); the demo line naming the feature is in the conversation; ${RECAP}`, proof: () => reachesConfirmedWork('make it real') },
  /**
   * 🔁 STRENGTHENED, NOT LOOSENED (Q-1037). These two were proven with `reachesReaderAsWork`, and the
   * comment above it argued the case honestly: an "add …" order is never certain to the keyword pass, so
   * the intention reader decides it, and with no reader an unconfirmed order is answered with an OFFER
   * that a "yes" then builds. All true — and it means the sentence *"Reply "add it" and I'll put it in"*
   * cost the user a second round trip and leaned on a model call, which is a weaker promise than the
   * words make. These two phrases are OURS: we wrote them into the user's mouth, so nothing has to be
   * inferred. `platformSuggestedReplies.ts` registers them, and the proof is the strict one every other
   * entry uses — `buildConfirmation` included.
   */
  'add it': { handler: `${BUILD_ROUTE}; src/server/AgentV3/platformSuggestedReplies.ts`, why: `a REGISTERED suggested reply — a phrase this platform told the user to type, read as an edit of the app that is here at high confidence, so no reader and no second round trip; ${RECAP}`, proof: () => reachesConfirmedWork('add it') && !!platformSuggestedReply('add it') },
  'add them': { handler: `${BUILD_ROUTE}; src/server/AgentV3/platformSuggestedReplies.ts`, why: `as "add it"; ${RECAP}`, proof: () => reachesConfirmedWork('add them') && !!platformSuggestedReply('add them') },
  'add it to this app': {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/unrelatedRequest.ts`,
    why: 'it points at the app that is here, so the unrelated-request question is NOT asked again, and the order is built into this app',
    proof: () => reachesConfirmedWork('add it to this app')
      && unrelatedToExistingApp({ prompt: 'add it to this app', paths: ['src/Calculator.tsx', 'src/App.tsx'], earlierBuildRequests: ['build a calculator'] }).ask !== true,
  },
  'build an image generator app': { handler: BUILD_ROUTE, why: 'an unmistakable build order (new_build, high), and it names software, so the picture-studio answer does not take it', proof: () => reachesConfirmedWork('build an image generator app') && !isPictureRequest('build an image generator app') },
  'make it a react app': { handler: BUILD_ROUTE, why: 'a build order on the pasted app (read as an edit/upgrade)', proof: () => reachesConfirmedWork('make it a React app') },
  'make it feel more alive': { handler: BUILD_ROUTE, why: 'a build order on the existing app (animations)', proof: () => reachesConfirmedWork('make it feel more alive') },
  'add cashfree payments': { handler: BUILD_ROUTE, why: 'an add order the builder carries out with its payments recipe', proof: () => reachesReaderAsWork('add Cashfree payments') },
  'add a cookie banner': { handler: BUILD_ROUTE, why: 'an add order the builder carries out with generate_consent_banner', proof: () => reachesReaderAsWork('add a cookie banner') },
  'add the pricing section and the contact us button': { handler: BUILD_ROUTE, why: 'an add order naming exactly what to add', proof: () => reachesReaderAsWork('add the pricing section and the Contact us button') },
  'create an ai image generator where users enter a prompt and generate images': { handler: BUILD_ROUTE, why: 'an unmistakable build order that names software', proof: () => reachesConfirmedWork('Create an AI image generator where users enter a prompt and generate images') },
  'look at <website>': {
    handler: `${BUILD_ROUTE} (the builder's browser tools)`,
    why: '"<website>" stands for an address; with one, the message is a certain order the builder works on with its real browser',
    proof: () => reachesConfirmedWork('look at https://example.com'),
  },
  app: {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/buildConfirmation.ts`,
    why: `the message names a product, so it confirms a build (buildConfirmation: names-something-to-build); ${RECAP}`,
    proof: () => reachesConfirmedWork('app'),
  },
  yes: {
    handler: 'src/server/AgentV3/buildConfirmation.ts (isOfferAcceptance) → src/server/routes/agentv3.ts',
    why: 'a "yes" to an offer to build builds the ORIGINAL request, within OFFER_LIFETIME_MS',
    proof: () => isOfferAcceptance('yes'),
  },
  [KEEP_CHANGES_PHRASE]: {
    handler: 'src/server/AgentV3/GreenGuard.ts (wantsAttemptBack) → src/server/routes/agentv3.ts',
    why: 'exact-phrase, checked before the turn runs: the rolled-back attempt is restored into the durable store',
    proof: () => wantsAttemptBack('keep my changes') && read('src/server/routes/agentv3.ts').includes('wantsAttemptBack(prompt)'),
  },
  'create an image of …': {
    handler: 'src/server/AgentV3/pictureRequest.ts → src/server/routes/agentv3.ts',
    why: 'a picture request on a fresh chat is answered with where pictures are made, never built as an app',
    proof: () => isPictureRequest('create an image of a sunset over the sea'),
  },
  'you decide': {
    handler: 'src/server/AgentV3/RoleChats.ts (the Plan-mode planner) → src/server/routes/agentv3.ts',
    why: 'the planner\'s own prompt offers deciding for the user, its plan is never held back for answers, and the earlier request reaches it through the session memory line',
    proof: () => read('src/server/AgentV3/RoleChats.ts').includes('they can simply tell you to decide')
      && sessionRecallContextLine([{ kind: 'request', text: 'a hospital app', ts: 1 } as never]).includes('a hospital app'),
  },
};

/** Not something the user is told to send. Keyed `file::phrase`, each with the reason. */
/**
 * The non-English suggested replies, derived from `PLATFORM_SUGGESTED_REPLIES` rather than retyped: ten
 * promises this census could not see until `PROMISE_SUFFIX_VERB` was added above. Each is proven the same
 * way as its English sibling — the registry recognises it, and the turn reaches confirmed work.
 */
const REGISTERED_SUGGESTED_REPLIES: Record<string, Handled> = Object.fromEntries(
  PLATFORM_SUGGESTED_REPLIES.map(({ phrase, composedBy }) => [norm(phrase), {
    handler: `${BUILD_ROUTE}; src/server/AgentV3/platformSuggestedReplies.ts (${composedBy})`,
    why: 'a REGISTERED suggested reply: this platform wrote the phrase and told the user to type it, so the ladder matches it exactly instead of guessing — an edit of the app that is here, at high confidence',
    proof: () => reachesConfirmedWork(phrase) && !!platformSuggestedReply(phrase),
  }]),
);

const NOT_A_FOLLOW_UP: Record<string, string> = {
  'src/server/AgentV3/ToolCatalog.ts::jwt': 'a tool parameter value described to the model',
  'src/server/AgentV3/systemPrompt.ts::jwt': 'a value the builder passes to a recipe',
  'src/server/AgentV3/systemPrompt.ts::firebase': 'a value the builder passes to a recipe',
  'src/server/AgentV3/systemPrompt.ts::stylised 3d': 'the words the builder is told to use in its own summary',
  'src/server/routes/agentv3.ts::real-looking': 'the words the builder is told to use in its own summary',
  'src/server/lib/heroObjectSpec.ts::real-looking': 'the words a model is told to use',
  'src/server/lib/objectSpecProvider.ts::real-looking': 'the words a model is told to use',
  "src/server/AppContext/AppContextInjector.ts::i don't know where that is": 'an instruction to the assistant about its own answer',
  'src/server/lib/freeChatModeGuide.ts::i cannot make images': 'an instruction to the assistant about its own answer',
  'src/server/memory/semanticMemory.ts::my notes': 'an instruction to the assistant about its own wording',
  'src/server/lib/ImageAiGenerator.ts::trying again...': 'the text a generated app shows on its own screen',
  'src/server/lib/developerApi.ts::prompt': 'a field of the developer API request body',
  'src/server/lib/developerApi.ts::n': 'a field of the developer API request body',
  'src/server/lib/developerApi.ts::b64_json': 'a value of the developer API request body',
  'src/server/routes/developerApi.ts::messages: [{ role, content }]': 'the shape of a developer API request body',
  'src/server/AppContext/AppKnowledgeBase.ts::stream': 'a field of the developer API request body',
  'src/server/AppContext/AppKnowledgeBase.ts::3d game': '"say" means "for example" — what a build request might contain',
  'src/server/AppContext/AppKnowledgeBase.ts::a pdf on genesis 4': '"say" means "for example" — an example request',
  'src/server/AppContext/AppKnowledgeBase.ts::the save button does nothing': 'an example of what to write in the Report box (a form, not a chat follow-up)',
  'src/server/AppContext/AppKnowledgeBase.ts::trignometry': 'an example of a misspelling the search tolerates',
  'src/server/AppContext/AppKnowledgeBase.ts::← preview': 'a button the user taps ("← Preview" brings you back), not a message',
  'src/server/AgentV3/packageHealth.ts::${…}': 'a package.json script name in a dependency report ("script X runs Y")',
  'src/lib/previewUtils.ts::preview is empty': 'a comment inside an injected preview script',
  'src/server/professionals/configs/accountant.ts::verify the current rate/slab/limit/date on incometax.gov.in / gst.gov.in': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/astrologer.ts::this follows the classical rule that…': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/babynames.ts::commonly means…': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/business.ts::verify current': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/festival.ts::verify the date': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/games.ts::a common rule is…': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/realestate.ts::verify current / consult a professional': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/travel.ts::verify current': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/astronomy.ts::we don’t fully know yet': 'an instruction to the assistant about its own wording',
  'src/server/professionals/configs/astronomy.ts::scientists don’t fully know yet': 'an instruction to the assistant about its own wording',
};

// ── The census ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 census — every follow-up we tell somebody to send has a handler, or is listed as not one', () => {
  const promises = extractPromises();

  it('the extraction finds the promises this file was written against (it is not silently blind)', () => {
    const phrases = new Set(promises.map((p) => p.phrase));
    for (const p of ['continue', 'fix these', 'add it to this app', 'keep my changes', 'fix it', 'fix them', 'add it', 'yes']) {
      expect(phrases.has(p), p).toBe(true);
    }
    expect(promises.length).toBeGreaterThan(40);
  });

  it('🔴 every one is registered — a new promise without a handler fails here', () => {
    const unregistered = promises
      .filter((p) => !HANDLED_FOLLOW_UPS[p.phrase] && !REGISTERED_SUGGESTED_REPLIES[p.phrase] && !NOT_A_FOLLOW_UP[`${p.file}::${p.phrase}`])
      .map((p) => `${p.file}:${p.line} — "${p.phrase}" … ${p.context.replace(/\s+/g, ' ')}`);
    expect(unregistered).toEqual([]);
  });

  // ⚠️ BOTH registries' proofs run. A `REGISTERED_SUGGESTED_REPLIES` whose proofs were never executed
  // would be a measurement with no reader — the very class Q-1027 was raised for, one level down.
  for (const [phrase, h] of Object.entries({ ...HANDLED_FOLLOW_UPS, ...REGISTERED_SUGGESTED_REPLIES })) {
    it(`"${phrase}" is really handled — ${h.handler}`, () => {
      expect(h.why.length).toBeGreaterThan(20);
      expect(h.proof()).toBe(true);
    });
  }

  it('the registry does not rot: every entry is still promised somewhere', () => {
    const phrases = new Set(promises.map((p) => p.phrase));
    const keys = new Set(promises.map((p) => `${p.file}::${p.phrase}`));
    expect(Object.keys(HANDLED_FOLLOW_UPS).filter((p) => !phrases.has(p))).toEqual([]);
    // Every registered suggested reply must still be PROMISED in a shipped string. A phrase dropped from
    // a notice, or a translation reworded without its registry entry moving, fails here.
    expect(Object.keys(REGISTERED_SUGGESTED_REPLIES).filter((p) => !phrases.has(p))).toEqual([]);
    expect(Object.keys(NOT_A_FOLLOW_UP).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('🔴 "review it" is not a follow-up anything handles — and is promised nowhere', () => {
    // What sending it really does: the keyword pass reads it as chat, and no review runs on a turn that writes nothing.
    expect(classifyIntentWithConfidence('review it').intent).toBe('chat');
    expect(HANDLED_FOLLOW_UPS['review it']).toBeUndefined();
    expect(promises.filter((p) => p.phrase === 'review it')).toEqual([]);
  });
});

// ── §2 · the route: one decision, then the user's line ──────────────────────────────────────────────────────────
describe('§2 the review that produced nothing: the user line follows the same decision as the report', () => {
  const route = read('src/server/routes/agentv3.ts');
  const branch = (() => {
    const start = route.indexOf('const notReadyLine = reviewNotReadyUserLine(');
    return route.slice(route.lastIndexOf('} else {', start), route.indexOf("code: suggestOnly ? 'REVIEW_SUGGESTIONS_NOT_READY' : 'REVIEW_INCOMPLETE'", start));
  })();

  it('`suggestOnly` is decided BEFORE anything is said to the user, and the user line comes from that decision', () => {
    expect(branch.length).toBeGreaterThan(0);
    const decided = branch.indexOf("const suggestOnly = reviewPlan.mode === 'suggest';");
    const said = branch.indexOf('events.emit(');
    expect(decided).toBeGreaterThan(0);
    expect(said).toBeGreaterThan(decided);
    expect(branch).toContain('reviewNotReadyUserLine({ suggestOnly, timedOut })');
    expect(branch).toContain('if (notReadyLine) events.emit(');
    // One emit in the branch, and it is the guarded one.
    expect(branch.split('events.emit(').length - 1).toBe(1);
  });

  it('the admin line for a review that stopped before a reasoning engine promises no command', () => {
    const i = route.indexOf("code: 'REVIEW_NOT_RUN_REASONING_ENGINE'");
    expect(i).toBeGreaterThan(0);
    expect(route.slice(i, i + 700)).not.toMatch(/review it/i);
  });
});

// ── §3 · the real line, against the real decision ───────────────────────────────────────────────────────────────
describe('§3 the sentence the user saw on 9c612cdb is never produced again', () => {
  const REAL = '📋 Your app is built, compiles, and is saved. The deeper completeness review didn\'t finish in the time it had — send "review it" and I\'ll run it on its own.';

  it('🔴 a suggest-only (green) review that timed out says NOTHING to the user — the report calls it process-only', () => {
    expect(reviewNotReadyUserLine({ suggestOnly: true, timedOut: true })).toBeNull();
    expect(reviewNotReadyUserLine({ suggestOnly: true, timedOut: false })).toBeNull();
  });

  it('a review that could have repaired says something true, and names no command', () => {
    for (const timedOut of [true, false]) {
      const line = reviewNotReadyUserLine({ suggestOnly: false, timedOut })!;
      expect(line).toBeTruthy();
      expect(line).not.toBe(REAL);
      expect(line).not.toMatch(/review it|run it on its own|\b(?:send|reply|type|say)\s+["“]/i);
    }
  });

  it('the salvaged-review line no longer promises a full pass on demand', () => {
    const text = formatPartialReview(salvageReview('[WARNING] [BROKEN] The remove button never calls removeVideo, so a deleted video comes back after refresh')!);
    expect(text).toContain('Partial review');
    expect(text).not.toMatch(/review it|full pass/i);
  });
});

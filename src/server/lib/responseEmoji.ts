// v5 build replies — emoji that MEAN something, and can never mock the user.
//
// ADMIN REQUEST 2026-08-15: use emoji in every v5 build response, but "bahut hi sensitive aur
// meaningful" — and the danger was named in the same breath:
//
//     "app bani nahi aur emoji 😂😍😁 is type ke aa gaye to user ka majak banane jaisa lagega"
//
// That is the whole engineering problem, and it is not solved by asking the model nicely. A prompt is
// advisory: under pressure a model absolutely will end a FAILED build with "🎉 All done!". The moment
// that reaches one real user, every emoji in the product stops reading as care and starts reading as a
// machine that did not notice their app is broken. Trust is lost in one message and not won back.
//
// So this file is built in TWO halves, and only the second one is a guarantee:
//
//   1. EMOJI_RULE — the prompt half. Teaches the model to use emoji as SEMANTIC ANCHORS: one at the
//      start of a step or bullet, chosen for the actual thing being described (🔐 login, 🗄️ database,
//      💳 payments). This is what makes them feel intentional rather than sprinkled.
//
//   2. sanitizeResponseEmoji() — the DETERMINISTIC half, and the one that actually holds. The platform
//      already knows the truth: `ok: true/false` sits directly beside `summary` on the very event that
//      carries the text. So a celebration emoji is REMOVED from any message whose real outcome is not
//      a success. The model cannot congratulate a user whose app did not build, because the congratulation
//      does not survive the trip to their screen. Not discouraged — impossible.
//
// 🔒 THE TRUTH COMES FROM STATE, NEVER FROM THE TEXT. We never read the words to guess whether things
// went well ("it says 'successfully', so probably fine") — that is precisely the mistake that produces a
// cheerful message about a broken app. The outcome is passed in from the event's own `ok` flag.
//
// PURE + dependency-free, so every rule here is unit-testable without a build.

/** What REALLY happened — taken from the event's own `ok` flag, never inferred from the words. */
export type ResponseOutcome =
  /** The app is built and works. Celebration is earned. */
  | 'success'
  /** It ran, but something the user asked for is missing or unverified. Honest, not festive. */
  | 'partial'
  /** It did not work. Nothing here is a cause for celebration. */
  | 'failure'
  /** Still building. Nothing has succeeded YET — congratulating now is the "app bani nahi" case. */
  | 'working';

/**
 * Emoji that read as CONGRATULATION, PARTY or HYPE. These are the only ones tied to an outcome, and the
 * only ones ever removed.
 *
 * ⚠️ Note what is deliberately NOT here: ✅ ⚠️ ❌ 📄 🗄️ 🔐 and every other informational glyph. A tick
 * beside a finished step is a STATUS mark, not a cheer — stripping it from a failed build would make the
 * message harder to read while protecting nobody. The list is narrow on purpose: it removes mockery, it
 * does not sand the personality out of a good result.
 *
 * 🚀 IS on the list. "🚀 Ready to launch!" under a build that failed is exactly the hollow hype that makes
 * a product feel like it is not listening.
 */
const CELEBRATION = new Set([
  '🎉', '🥳', '🎊', '🎈', '🍾', '🥂', '🚀', '🔥', '💯', '⭐', '🌟', '✨', '💫', '🏆', '🥇', '🎯',
  '😂', '🤣', '😍', '😁', '😄', '😆', '😊', '😃', '😀', '🙂', '😎', '🤩', '🥰', '😻', '🤗',
  '👏', '🙌', '🙏', '👍', '👌', '💪', '🤘', '✌️', '❤️', '💖', '💕', '😇', '🫶', '💃', '🕺', '🎁',
]);

/**
 * Match one emoji, INCLUDING multi-codepoint sequences: skin tones, variation selectors (❤️ = ❤ + FE0F),
 * keycaps, flags, and ZWJ families (👨‍👩‍👧). Matching a whole sequence matters — chopping one apart
 * leaves orphaned joiners that render as visible garbage, which is its own kind of unprofessional.
 */
const EMOJI_SEQ =
  /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣/gu;

/** The BASE character of a sequence, so 👍🏽 and 👍 are judged as the same gesture. */
function baseEmoji(seq: string): string {
  const first = Array.from(seq)[0] ?? '';
  return first;
}

/** True when this emoji reads as congratulation / party / hype. PURE. */
export function isCelebrationEmoji(seq: string): boolean {
  if (typeof seq !== 'string' || seq === '') return false;
  return CELEBRATION.has(seq) || CELEBRATION.has(baseEmoji(seq)) || CELEBRATION.has(`${baseEmoji(seq)}️`);
}

/** Is celebration honest for this outcome? Only when the app genuinely works. PURE. */
export function celebrationAllowed(outcome: ResponseOutcome): boolean {
  return outcome === 'success';
}

/**
 * Remove emoji that CONTRADICT what really happened, and collapse emoji pile-ups.
 *
 * Two rules, both narrow enough that they can never damage a legitimate message:
 *
 *   1. OUTCOME — on anything that is not a success, celebration emoji are dropped. This is the admin's
 *      exact case: an app that did not build cannot be handed 😂😍😁.
 *
 *   2. RUNS — two or more emoji in a row collapse to the first. A run is the universal tell of decoration
 *      applied by the metre rather than meaning ("Done!! 🎉🎊🥳🚀"), and it reads as fake even when the
 *      build genuinely succeeded. One emoji is a signal; four is noise wearing a costume.
 *
 * Everything else is left EXACTLY as written — the model's wording, its language, its informational emoji.
 * This function only ever removes; it never invents an emoji or rewrites a sentence.
 *
 * PURE. Returns '' for nullish input.
 */
export function sanitizeResponseEmoji(text: unknown, outcome: ResponseOutcome): string {
  const src = String(text ?? '');
  if (src === '') return '';
  const allowCelebration = celebrationAllowed(outcome);

  // Pass 1 — drop emoji that contradict the real outcome.
  let out = allowCelebration
    ? src
    : src.replace(EMOJI_SEQ, (seq) => (isCelebrationEmoji(seq) ? '' : seq));

  // Pass 2 — collapse a run of emoji (optionally separated by spaces) down to the first one.
  out = out.replace(
    new RegExp(`(${EMOJI_SEQ.source})(?:[ \\t]*(?:${EMOJI_SEQ.source}))+`, 'gu'),
    (run) => {
      const first = run.match(EMOJI_SEQ);
      return first ? first[0] : run;
    },
  );

  // Tidy only the whitespace our own removals could have left behind — never reflow the model's text.
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+(?=[\r\n])/gm, '')
    .trim();
}

/**
 * Map a build event's `ok` flag to the outcome. `ok` is the platform's OWN measurement, which is why it
 * is the only thing consulted.
 *
 * `partial` exists for the honest middle the platform already detects elsewhere (a build that renders but
 * is missing a control the user asked for). It is treated exactly like a failure for celebration purposes:
 * an app that is missing what the user asked for has not earned a party.
 */
export function outcomeFromOk(ok: boolean | undefined, opts?: { partial?: boolean }): ResponseOutcome {
  if (ok === undefined) return 'working';
  if (!ok) return 'failure';
  return opts?.partial ? 'partial' : 'success';
}

/**
 * The `result` event is the build's FINAL word to the client, and it travels on the raw HTTP stream
 * rather than through AgentEventStream — so it needs the same guarantee applied at its own choke point.
 * It arrives loosely typed (`unknown`), so this narrows defensively and returns the value untouched
 * whenever it is not a result event carrying both an `ok` flag and a `summary`.
 *
 * Kept HERE beside the rules rather than inline in the route, so there is exactly one definition of what
 * "honest emoji" means and the two streams can never drift apart. PURE.
 */
export function honestResultEvent<T>(event: T): T {
  if (!event || typeof event !== 'object') return event;
  const e = event as { type?: unknown; ok?: unknown; summary?: unknown };
  if (e.type !== 'result' || typeof e.summary !== 'string' || typeof e.ok !== 'boolean') return event;
  return { ...event, summary: sanitizeResponseEmoji(e.summary, e.ok ? 'success' : 'failure') };
}

/**
 * THE PROMPT HALF — how to use emoji so they carry meaning.
 *
 * Deliberately teaches PLACEMENT and VOCABULARY rather than saying "use emoji", because "use emoji" is
 * what produces a wall of confetti. An emoji at the head of a step, matched to the thing that step is
 * about, reads as a professional product; the same emoji mid-sentence reads as a chat toy.
 *
 * ⚠️ The last rule here is also enforced in code (see sanitizeResponseEmoji). It is stated anyway so the
 * model writes the right thing in the first place instead of relying on being cleaned up — the first
 * build should be correct, and the sanitizer is the net, not the plan.
 */
export const EMOJI_RULE =
  'EMOJI — MEANINGFUL, NEVER DECORATIVE: Put ONE emoji at the START of each step, bullet or short ' +
  'section of your reply, chosen for what that line is actually about, so it works as a visual label. ' +
  'Match the subject: 🔐 login/auth, 🗄️ database, 💳 payments, 📱 mobile, 🎨 design/styling, 📄 a page ' +
  'or file, 🔍 search, 📊 charts/reports, 🔔 notifications, 🛒 cart/orders, 👤 profile/users, ⚙️ settings, ' +
  '🌐 deploy/hosting, 🧩 a component, ✅ a finished step, ⚠️ a caveat the user should know, ❌ something ' +
  'that failed. NEVER put two emoji next to each other, never put one in the middle of a sentence, and ' +
  'never repeat the same one down a list. If no emoji genuinely fits a line, use none — a missing emoji ' +
  'is invisible, a wrong one is noticeable. ' +
  '🔒 ABSOLUTE: use celebratory emoji (🎉 🥳 🚀 🔥 😍 😁 👏 and similar) ONLY when the app is genuinely ' +
  'built and working. While you are still building, and in ANY message about a failure, an error or ' +
  'something you could not finish, celebratory emoji are FORBIDDEN — congratulating a user whose app is ' +
  'not working reads as mockery. In those messages use ⚠️ or ❌, or no emoji at all.';

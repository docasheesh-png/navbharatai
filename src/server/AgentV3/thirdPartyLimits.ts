/**
 * 📺 A PROPERTY ONLY THE OTHER SERVICE CONTROLS IS NEVER CLAIMED — AND THE USER IS TOLD WHO CONTROLS IT
 * (Q-947, autopsy 9c612cdb, 2026-10-12).
 *
 * The request: *"… similar to youtube … an option for paste link … There we could also stream the videos
 * with no adds"*. The app plays every video in YouTube's own embedded player (`youtube.com/embed/<id>`),
 * and the reply opened with **"Your ad-free video player app is ready."** YouTube's player shows its own
 * ads on videos whose owners earn from them. A page that embeds the player cannot reach inside it (the
 * player is a cross-origin frame, so the browser's same-origin policy keeps the page out), so the app has
 * no way to switch those ads off. The headline promised the one thing the user asked for that the app
 * does not do.
 *
 * 🔑 THE CLASS: a summary (or the app) asserts that a requested property was delivered while the app
 * lacks it, because the platform keeps no record of request properties it cannot deliver. Nothing told
 * the builder what to say, and the claim audit had no measured fact to hold the claim against. Earlier
 * members of the same class, each closed for its own property: simulated data called live (Q-274), uploads
 * in a 5 MB store called working (Q-542), a keypad phone silently ignored (Q-846), a stack we do not build
 * (unsupportedStack.ts). This module is the third-party-player member, with all three layers:
 *
 *   1. PREVENT — the builder is told before it writes (`thirdPartyLimitsBuilderNote`), in EVERY lane (the
 *      route's one request-notes aggregator), and the user hears it at the start (`thirdPartyLimitsStartLine`).
 *   2. SAY IT, DETERMINISTICALLY — when the user asked for no ads and the finished project embeds an
 *      ad-serving player, the reply ends with one plain line (`thirdPartyLimitsEndLine`), unless it already
 *      says so. This also covers the fast lane, whose closing summary the platform writes, not a model.
 *   3. CORRECT — a reply that calls the app "ad-free" (or says ads are removed / blocked) over such a player
 *      gets NavBharatAI's own correction (`adFreeClaimCorrection`), judged on the WHOLE project's player fact.
 *      Layers 1 and 2 make this dead code on a good build; it stays as the last line of defence.
 *
 * WHEN IT FIRES:
 *   • a NEW build: the request asks for no ads (`adRemovalRequested`) AND names a third-party video source
 *     or a paste-a-link flow (`thirdPartyVideoSourceNamed`) — the project does not exist yet;
 *   • an EDIT turn: the request asks for no ads (e.g. "remove the ads", "ads still play") AND the WHOLE
 *     project already embeds an ad-serving player (`projectAdServingPlayers`) — the likeliest follow-up to
 *     this very report, and one that names no source at all.
 *
 * ⚠️ WORDING. Never "ad-free". Plainly: ads inside YouTube's own player may still play on videos whose
 * owners earn from them, and the app adds no ads of its own. Nothing here calls anything illegal — what
 * the user can and cannot do about another service's player is the admin's policy call, not this module's.
 * Vimeo's player shows no ads, so a Vimeo-only app is never touched.
 *
 * ⚠️ PRECISION-FIRST. The real prompt's verb ("the video adds in the app") and "add a link" are pinned
 * negatives; a missed request costs today's behaviour, a false one costs one unneeded sentence.
 * Kill switch: `AGENTV3_THIRD_PARTY_LIMITS=off` (all three layers). PURE — no I/O, never throws.
 */

export function thirdPartyLimitsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_THIRD_PARTY_LIMITS ?? '').trim().toLowerCase() !== 'off';
}

// ── 1. What the user asked for ────────────────────────────────────────────────────────────────────────────

/** The words for an advert, as people type them ("adds" is the real report's spelling). */
const AD_WORD = String.raw`(?:ads|adds|adverts?|advertisements?|advertising|commercials|pre-?rolls?)`;

/**
 * "No ads", in the ways it is asked. Each alternative needs a NEGATION or a REMOVAL beside the ad word, so
 * the verb "adds" ("the video adds in the app") and "add a link" can never match on their own.
 */
const AD_REMOVAL_ASKED = new RegExp([
  String.raw`\bad[\s-]?free\b`,
  String.raw`\b(?:no|zero|without(?:\s+any)?|minus)\s+(?:more\s+|annoying\s+)?${AD_WORD}\b`,
  String.raw`\b(?:skip|block|remove|hide|strip|stop|disable|avoid|bypass|kill|cut)(?:s|ped|ping|ing|d|ed)?\s+(?:out\s+)?(?:all\s+|the\s+|any\s+|those\s+|these\s+)?(?:youtube(?:'s)?\s+|video\s+|annoying\s+)?${AD_WORD}\b`,
  String.raw`\bget\s+rid\s+of\s+(?:all\s+|the\s+)?${AD_WORD}\b`,
  // The complaint after the first build: "ads are still playing", "ads abhi bhi aa rahe hain".
  String.raw`\b${AD_WORD}\s+(?:are\s+|is\s+)?(?:still|abhi\s+bhi|ab\s+bhi|phir\s+bhi)\s+(?:play|show|appear|run|com|aa|chal)\w*`,
  // Hinglish: "bina ads ke", "ads nahi chahiye".
  String.raw`\bbina\s+(?:koi\s+|kisi\s+)?(?:ads|adds|advertisements?|vigyapan)\b`,
  String.raw`\bbina\s+(?:ad|add)\s+(?:ke|ki|ka)\b`,
  String.raw`\b(?:ads|adds|advertisements?|vigyapan)\s+(?:bilkul\s+)?(?:nahi|nahin|nhi|na)\b`,
  // Devanagari: "बिना विज्ञापन", "विज्ञापन नहीं", "ऐड फ्री". (No \b here: it is an ASCII word boundary and
  // never holds between two Devanagari letters.)
  'बिना\\s*(?:विज्ञापन|ऐड्स?)', '(?:विज्ञापन|ऐड्स?)\\s*नहीं', 'ऐड\\s*-?\\s*फ्री',
].join('|'), 'i');

/** Does the request ask for videos (or an app) without ads? Precision-first. PURE. */
export function adRemovalRequested(prompt: string | null | undefined): boolean {
  const p = String(prompt ?? '');
  if (!p.trim()) return false;
  return AD_REMOVAL_ASKED.test(p);
}

/** A third-party video source, or the paste-a-link flow that plays one. */
const THIRD_PARTY_SOURCE = new RegExp([
  String.raw`\byou\s?tube\b`, String.raw`\byt\s+(?:videos?|links?|urls?|shorts)\b`, String.raw`\bdailymotion\b`,
  String.raw`\btwitch\b`, String.raw`\binstagram\s+(?:reels?|videos?)\b`, String.raw`\b(?:facebook|fb)\s+videos?\b`,
  // "paste link", "pastes the URL", and the real report's "pasts the link" — never the word "past".
  String.raw`\bpast(?:e|es|ed|ing|s)\b[^.\n]{0,40}\b(?:links?|urls?)\b`,
  String.raw`\b(?:video|stream)\s+(?:links?|urls?)\b`, String.raw`\blinks?\s+paste\b`,
  'यूट्यूब',
].join('|'), 'i');

/** Does the request name a third-party video source, or a paste-a-link flow? PURE. */
export function thirdPartyVideoSourceNamed(prompt: string | null | undefined): boolean {
  return THIRD_PARTY_SOURCE.test(String(prompt ?? ''));
}

// ── 2. What the project really embeds ─────────────────────────────────────────────────────────────────────

export type AdServingPlayer = 'YouTube' | 'Dailymotion' | 'Twitch' | 'Facebook';

/** Source the app runs: code and pages, never tests, docs, dependencies or build output. */
const PLAYER_SOURCE = /\.(?:[cm]?[jt]sx?|html?|vue|svelte|astro)$/i;
const NOT_APP_SOURCE = /(?:^|\/)(?:node_modules|dist|build|\.git|e2e|tests?|__tests__|docs)\//i;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * Players that can show their own ads inside the app. A plain watch LINK is not a player (it leaves the
 * app), and Vimeo's player shows no ads, so neither is here. `react-player` counts only beside a YouTube
 * address — it plays Vimeo and plain files too.
 */
const PLAYER_RULES: ReadonlyArray<{ player: AdServingPlayer; re: RegExp; needs?: RegExp }> = [
  { player: 'YouTube', re: /\byoutube(?:-nocookie)?\.com\/(?:embed|iframe_api|player_api)\b/i },
  { player: 'YouTube', re: /['"](?:react-youtube|youtube-player|react-player\/youtube|(?:@[\w-]+\/)?(?:react-)?lite-youtube(?:-embed)?)['"]/i },
  { player: 'YouTube', re: /\bYT\.Player\b/ },
  { player: 'YouTube', re: /['"]react-player(?:\/lazy)?['"]/i, needs: /\byoutu(?:be\.com|\.be)\b/i },
  { player: 'Dailymotion', re: /\bdailymotion\.com\/(?:embed|player)\b|\bgeo\.dailymotion\.com\/player\b|['"]@dailymotion\/[\w-]+['"]/i },
  { player: 'Twitch', re: /\b(?:player|embed|clips)\.twitch\.tv\b/i },
  { player: 'Facebook', re: /\bfacebook\.com\/plugins\/video\b/i },
];

/**
 * Which ad-serving players the project embeds. Give it the WHOLE project (durable store + this turn's
 * writes): an edit turn's slice cannot see the player the first build wrote. PURE.
 */
export function projectAdServingPlayers(files: Readonly<Record<string, string>> | null | undefined): AdServingPlayer[] {
  const found = new Set<AdServingPlayer>();
  for (const [path, content] of Object.entries(files ?? {})) {
    const p = String(path).replace(/\\/g, '/');
    if (!PLAYER_SOURCE.test(p) || NOT_APP_SOURCE.test(p) || TEST_FILE.test(p)) continue;
    const text = String(content ?? '');
    if (!text) continue;
    for (const rule of PLAYER_RULES) {
      if (found.has(rule.player)) continue;
      if (rule.re.test(text) && (!rule.needs || rule.needs.test(text))) found.add(rule.player);
    }
  }
  const order: readonly AdServingPlayer[] = ['YouTube', 'Dailymotion', 'Twitch', 'Facebook'];
  return order.filter((p) => found.has(p));
}

/** "YouTube's own player" · "YouTube's and Dailymotion's own players". */
function ownPlayers(players: readonly string[]): string {
  const names = players.length > 0 ? players : ['YouTube'];
  const owners = names.map((n) => `${n}'s`);
  const list = owners.length === 1 ? owners[0] : `${owners.slice(0, -1).join(', ')} and ${owners[owners.length - 1]}`;
  return `${list} own player${names.length === 1 ? '' : 's'}`;
}

// ── 3. When the builder is told ───────────────────────────────────────────────────────────────────────────

export interface ThirdPartyLimitAskInput {
  prompt: string | null | undefined;
  /** A new build (the project does not exist yet), as opposed to an edit of one that does. */
  newBuild: boolean;
  /** An import / survey turn: the user's own code, never told anything by this module. */
  importTurn?: boolean;
  /** The WHOLE project's players (edit turns only — `projectAdServingPlayers`). */
  projectPlayers?: readonly string[];
}

/**
 * Does this turn need the note? New build: ad removal asked AND a third-party source or a paste-a-link flow
 * named. Edit turn: ad removal asked AND the project already embeds an ad-serving player. PURE.
 */
export function thirdPartyLimitAsked(input: ThirdPartyLimitAskInput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!thirdPartyLimitsEnabled(env) || input.importTurn === true) return false;
  if (!adRemovalRequested(input.prompt)) return false;
  return input.newBuild
    ? thirdPartyVideoSourceNamed(input.prompt)
    : (input.projectPlayers?.length ?? 0) > 0;
}

/**
 * An EDIT turn's players, read only on an edit (never an import) that asks for no ads — the load is skipped on
 * every other turn. The project is loaded by the caller's `load` (the durable store — the WHOLE project, not this
 * turn's slice); a failed load is "no player known", never an error. The only async export here.
 */
export async function editTurnAdServingPlayers(
  prompt: string | null | undefined,
  turn: { editTurn: boolean; importTurn: boolean },
  load: () => Promise<Readonly<Record<string, string>> | null | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdServingPlayer[]> {
  if (!turn.editTurn || turn.importTurn || !thirdPartyLimitsEnabled(env) || !adRemovalRequested(prompt)) return [];
  try {
    return projectAdServingPlayers(await load());
  } catch {
    return [];
  }
}

/** The builder's instruction. Empty when nothing needs saying. PURE. */
export function thirdPartyLimitsBuilderNote(asked: boolean, players: readonly string[] = []): string {
  if (!asked) return '';
  const where = players.length > 0 ? ownPlayers(players) : "YouTube's own player (or the player of whichever site the video comes from)";
  return [
    `THIRD-PARTY PLAYER NOTE — the user asked for videos with no ads. A video embedded from YouTube, Dailymotion, Twitch or Facebook plays inside ${where}, and that player shows its own ads on videos whose owners earn from them. A page that embeds the player cannot reach inside it, so the app cannot switch those ads off. (Vimeo's player shows no ads.)`,
    '- Add no ads of your own, and keep the app\'s own screens free of clutter around the player.',
    '- Never call the app "ad-free" and never say ads are removed, blocked or skipped — not in the UI, the page title, the meta description, the README, a code comment or your reply.',
    '- The FIRST sentence of your reply says plainly that ads inside the video site\'s own player may still play on videos whose owners earn from them, and that the app adds no ads of its own.',
    '- The user is already told this at the start of the build — do NOT spend a turn explaining it or asking whether to proceed. Build the app now.',
  ].join('\n');
}

/**
 * Says the start line and records it — only when `asked`. The condition lives here so the route adds no branch
 * (its handler sits at TypeScript's control-flow limit, TS2563). Never throws.
 */
export function announceThirdPartyLimit(
  asked: boolean,
  players: readonly string[],
  say: (line: string) => void,
  record: (message: string) => void,
): void {
  if (!asked) return;
  try { say(thirdPartyLimitsStartLine(true, players)); } catch { /* best-effort */ }
  try { record(thirdPartyLimitReportNote(players, 'start')); } catch { /* best-effort */ }
}

/** The one line the user reads at the START of the build. Empty when nothing needs saying. PURE. */
export function thirdPartyLimitsStartLine(asked: boolean, players: readonly string[] = []): string {
  if (!asked) return '';
  const where = players.length > 0 ? ownPlayers(players) : "the video site's own player";
  return `ℹ️ About "no ads": videos from YouTube and similar sites play inside ${where}, and ads inside that player may still play on videos whose owners earn from them — an app that embeds the player cannot switch those off. Your app will add no ads of its own.`;
}

// ── 4. What the reply says ────────────────────────────────────────────────────────────────────────────────

/** NavBharatAI's own correction header — the same words `claimCorrection` (claimAudit.ts) opens with. */
const CORRECTION_HEADER = '⚠️ Correction from NavBharatAI itself:';

/**
 * The reply already says the player's ads may still play (the honest sentence). Judged on the WHOLE
 * summary, our own lines included, so neither the end line nor the correction is ever said twice.
 */
const ADS_MAY_STILL_PLAY = new RegExp([
  // "ads inside that player may still play" — never "no ads can play", which is the claim, not the caveat.
  String.raw`(?<!\bno\s)(?<!\bzero\s)(?<!\bwithout\s)\b(?:ads|adverts?|advertisements?)\b[^.!?\n]{0,120}?\b(?:may|might|can|could)\s+(?:still\s+)?(?:play|appear|show|run|be\s+(?:shown|played))\b`,
  String.raw`(?<!\bno\s)(?<!\bzero\s)\b(?:ads|adverts?|advertisements?)\b[^.!?\n]{0,120}?\bwill\s+still\s+(?:play|appear|show|run)\b`,
  // "YouTube's player may still show its own ads".
  String.raw`\b(?:youtube|dailymotion|twitch|facebook|player|embed)\b[^.!?\n]{0,80}?\b(?:may|might|can|could|will)\s+(?:still\s+)?(?:show|play|serve|run|display|include)\s+(?:its\s+own\s+|their\s+own\s+|some\s+)?(?:ads|adverts?|advertisements?)\b`,
].join('|'), 'i');

export function adsMayStillPlaySaid(summary: string | null | undefined): boolean {
  return ADS_MAY_STILL_PLAY.test(String(summary ?? ''));
}

/** A claim that the app has no ads, or removes them. "No ads of its own" is honest and never matches. */
const AD_FREE_CLAIMED = new RegExp([
  String.raw`\bad[\s-]?free\b`,
  String.raw`\b(?:no|zero)\s+(?:more\s+)?${AD_WORD}\b(?!\s+of\s+(?:its|our|their|your|the\s+app's)\s+own)`,
  String.raw`\bwithout\s+(?:any\s+)?${AD_WORD}\b(?!\s+of\s+(?:its|our|their|your)\s+own)`,
  String.raw`\b${AD_WORD}\s+(?:are\s+|is\s+|get\s+|gets\s+)?(?:removed|blocked|skipped|stripped|hidden|filtered\s+out)\b`,
  String.raw`\b(?:removes?|blocks?|skips?|strips?|hides?|filters?\s+out)\s+(?:all\s+|the\s+|any\s+)?(?:youtube(?:'s)?\s+|video\s+)?${AD_WORD}\b`,
  String.raw`\bad[\s-]?block(?:er|ing)\b`,
].join('|'), 'i');

/** The first sentence of the model's own text that claims the app has no ads, or null. PURE. */
export function adFreeClaim(summary: string | null | undefined): string | null {
  // Only the model's words: our own correction quotes the claim it corrects.
  const own = String(summary ?? '').split(CORRECTION_HEADER)[0];
  for (const sentence of own.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s) continue;
    // "adds no ads" — the app's OWN ads, which is the honest half of the sentence.
    if (/\badds?\s+no\s+/i.test(s) && !/\bad[\s-]?free\b/i.test(s)) continue;
    if (AD_FREE_CLAIMED.test(s)) return s;
  }
  return null;
}

function measuredLine(players: readonly string[]): string {
  return `the videos play in ${ownPlayers(players)}, and ads inside that player may still play on videos whose owners earn from them — an app that embeds the player cannot switch those off. The app adds no ads of its own`;
}

/**
 * NavBharatAI's own correction when the reply calls the app ad-free over an ad-serving player — '' when
 * the project embeds none, the reply makes no such claim, or the reply already says the ads may play.
 * Shaped like `claimCorrection`: when the summary already ENDS in that block, only the bullet is added, so
 * the user reads one correction list. Called right after `auditSummaryClaims`. PURE.
 */
export function adFreeClaimCorrection(
  summary: string | null | undefined,
  players: readonly string[] | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!thirdPartyLimitsEnabled(env)) return '';
  const list = players ?? [];
  if (list.length === 0) return '';
  const text = String(summary ?? '');
  if (!adFreeClaim(text) || adsMayStillPlaySaid(text)) return '';
  const bullet = `- The line above claiming that the app is ad-free is not supported — ${measuredLine(list)}.`;
  const lines = text.trimEnd().split('\n');
  let i = lines.length - 1;
  while (i >= 0 && lines[i].startsWith('- ')) i -= 1;
  const endsInCorrection = i >= 0 && i < lines.length - 1 && lines[i].trim() === CORRECTION_HEADER;
  return endsInCorrection ? `\n${bullet}` : ['', CORRECTION_HEADER, bullet].join('\n');
}

/**
 * The one plain line that ends the reply when the user asked for no ads and the finished project embeds an
 * ad-serving player — '' when it does not, or the reply (or our correction) already says so. Covers every
 * lane, the fast lane's platform-written summary included. PURE.
 */
export function thirdPartyLimitsEndLine(
  prompt: string | null | undefined,
  summary: unknown,
  players: readonly string[] | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!thirdPartyLimitsEnabled(env) || typeof summary !== 'string') return '';
  const list = players ?? [];
  if (list.length === 0 || !adRemovalRequested(prompt)) return '';
  if (adsMayStillPlaySaid(summary)) return '';
  const line = measuredLine(list).replace(/^the videos/, 'The videos in this app');
  return `\n\nℹ️ **About ads:** ${line}.`;
}

/**
 * The build's result with the end line appended — or the SAME result when nothing needs saying (a failed build,
 * no ad request, no ad-serving player, the reply already says it). `onTold` hears the players when the line was
 * added, so the caller records it. Every condition — and the best-effort catch — lives here, so the route needs
 * no branch and no try (TS2563). Never throws: a fault returns the result untouched. PURE apart from the callback.
 */
export function withThirdPartyLimitsEndLine<T extends { ok?: boolean; summary?: unknown }>(
  result: T,
  prompt: string | null | undefined,
  players: readonly string[] | null | undefined,
  onTold?: (players: readonly string[]) => void,
  env: NodeJS.ProcessEnv = process.env,
): T {
  try {
    if (!result || result.ok !== true) return result;
    const line = thirdPartyLimitsEndLine(prompt, result.summary, players, env);
    if (!line) return result;
    try { onTold?.(players ?? []); } catch { /* a report line never costs the user the sentence */ }
    return { ...result, summary: `${result.summary as string}${line}` };
  } catch {
    return result;
  }
}

/**
 * The admin's CLAIM_UNSUPPORTED message: the claim audit's own summary (when it found anything) and the
 * ad-free correction (when it fired), one line. PURE.
 */
export function claimReportWithAdFree(contradictionCount: number, auditSummary: string, adFreeFix: string, players: readonly string[]): string {
  return [contradictionCount > 0 ? auditSummary : '', adFreeFix ? thirdPartyLimitReportNote(players, 'claim') : ''].filter(Boolean).join(' · ');
}

/** The admin-only report line. PURE. */
export function thirdPartyLimitReportNote(players: readonly string[], when: 'start' | 'end' | 'claim'): string {
  const where = players.length > 0 ? players.join(', ') : 'a third-party video site';
  if (when === 'start') return `The request asks for videos with no ads from ${where}; the builder was told that player shows its own ads and that the app must never be called ad-free, and the user was told at the start.`;
  if (when === 'claim') return `The reply called the app ad-free while its videos play in ${where}'s own embedded player, which can show its own ads — corrected in the reply.`;
  return `The request asks for no ads and the app plays videos in ${where}'s own embedded player, which can show its own ads — the user was told in the reply.`;
}

// ── 5. The app's published name and description ───────────────────────────────────────────────────────────

/** "ad-free", "with no ads", "without ads", "bina ads ke" — removed from a prompt-derived name or description. */
const AD_FREE_WORDS = new RegExp([
  String.raw`\bad[\s-]?free\b`,
  String.raw`\b(?:with\s+)?(?:no|zero|without(?:\s+any)?)\s+(?:more\s+|annoying\s+)?${AD_WORD}\b`,
  String.raw`\bbina\s+(?:koi\s+|kisi\s+)?(?:ads?|adds|advertisements?|vigyapan)(?:\s+(?:ke|ki|ka))?\b`,
].join('|'), 'gi');

/**
 * The text with its "ad-free" words removed — for the name and description NavBharatAI derives from the
 * request when the app embeds an ad-serving player ("Build an ad-free YouTube player." must not publish
 * "Ad-Free YouTube Player"). Spacing and an orphaned comma are tidied. PURE.
 */
export function withoutAdFreeWords(text: string | null | undefined): string {
  return String(text ?? '')
    // "an ad-free YouTube player" → "a YouTube player": the article belonged to the word being removed.
    .replace(/\b(an?)\s+ad[\s-]?free\s+(?=(\S))/gi, (_m: string, art: string, next: string) => {
      const an = /^[aeiou]/i.test(next);
      return `${art[0] === 'A' ? (an ? 'An' : 'A') : (an ? 'an' : 'a')} `;
    })
    .replace(AD_FREE_WORDS, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\b(an?|the)\s*,\s*/gi, '$1 ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

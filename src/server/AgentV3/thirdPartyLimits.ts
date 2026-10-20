/**
 * 📺 A PROPERTY ONLY THE OTHER SERVICE CONTROLS IS NEVER CLAIMED — AND THE USER IS TOLD WHO CONTROLS IT
 * (Q-990, autopsy 9c612cdb, 2026-10-12).
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
 * The ad word right after a REMOVAL word ("skip", "block", "cut", "hide"). Those are nouns too, and then "adds" is the
 * verb: "double-tap skip adds 10 seconds", "each block adds a new video", "a skip adds nothing" (adversarial review of
 * Q-990). "adds" followed by an OBJECT — a number, an article, a pronoun, "new"/"more"/"nothing" — is that verb and is
 * never read as adverts; "remove adds from YouTube" and "skip the adds" still are.
 */
const AD_WORD_AFTER_REMOVAL = String.raw`(?:ads|adds(?!\s+(?:[\d+]|(?:a|an|the|new|more|another|one|it|them|its|their|your|my|our|some|each|every|extra|nothing|something|up)\b))|adverts?|advertisements?|advertising|commercials|pre-?rolls?)`;

/**
 * "No ads", in the ways it is asked. Each alternative needs a NEGATION or a REMOVAL beside the ad word, so
 * the verb "adds" ("the video adds in the app") and "add a link" can never match on their own.
 */
const AD_REMOVAL_ASKED = new RegExp([
  String.raw`\bad[\s-]?free\b`,
  String.raw`\b(?:no|zero|without(?:\s+any)?|minus)\s+(?:more\s+|annoying\s+)?${AD_WORD}\b`,
  String.raw`\b(?:skip|block|remove|hide|strip|stop|disable|avoid|bypass|kill|cut)(?:s|ped|ping|ing|d|ed)?\s+(?:out\s+)?(?:all\s+|the\s+|any\s+|those\s+|these\s+)?(?:youtube(?:'s)?\s+|video\s+|annoying\s+)?${AD_WORD_AFTER_REMOVAL}\b`,
  String.raw`\bget\s+rid\s+of\s+(?:all\s+|the\s+)?${AD_WORD}\b`,
  // The complaint after the first build: "ads are still playing", "ads abhi bhi aa rahe hain".
  String.raw`\b${AD_WORD}\s+(?:are\s+|is\s+)?(?:still|abhi\s+bhi|ab\s+bhi|phir\s+bhi)\s+(?:play|show|appear|run|com|aa|chal)\w*`,
  // 🔴 THE FORM AN INDIAN USER ACTUALLY TYPES FIRST, AND IT WAS MISSING (found writing Q-1019's test,
  // 2026-10-15). Hindi is subject-object-VERB, so the removal word comes AFTER the ad word — "ads hata do",
  // "ads nikal do", "ads band karo" — and every removal alternative above is verb-then-noun. So none of
  // Q-990's three layers fired for the request its own user base is most likely to send: the builder was
  // never told, the user was never warned at the start, and the honest end line never appeared. The ad word
  // must sit directly beside the removal verb, so precision is unchanged.
  String.raw`\b${AD_WORD}\s+(?:ko\s+|sab\s+|sare\s+|saare\s+)?(?:hata|hatao|hata\s*d|hata\s*dij|nikal|nikaal|band\s*kar|remove\s*kar|off\s*kar)\w*`,
  '(?:विज्ञापन|ऐड्स?)\\s*(?:को\\s*|सब\\s*|सारे\\s*)?(?:हटा|हटाओ|निकाल|बंद\\s*कर)',
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

// ── 2b. What the app itself serves — the measured half of "adds no ads of its own" ───────────────────────

/**
 * 🔴 Q-1018 (2026-10-15). "The app adds no ads of its own" is the honest half of this module's sentence,
 * and it was asserted on every build without ever being checked. It is not a safe assumption: NavBharatAI's
 * OWN Monetization wizard generates an AdSense block (`generateAdsense` in src/lib/paymentSetup.ts — the
 * `pagead2.googlesyndication.com` loader and an `<ins class="adsbygoogle">` slot). So a user who added ads
 * through our own feature and then asked about ads was told, by us, that their app adds none — a false
 * statement about their app, in the one sentence whose whole purpose is honesty about ads.
 *
 * This is the same class the module was built for (Q-990: a property asserted with no measured fact to hold
 * it against), turned on our own sentence rather than on the model's.
 */
export type OwnAdNetwork = 'Google AdSense' | 'Google Ad Manager' | 'Google AdMob' | 'Amazon' | 'Media.net' | 'Taboola' | 'Outbrain' | 'Adsterra' | 'PropellerAds';

/** Where an app's own ad code lives: the player source set, plus the manifests that declare a mobile ad SDK. */
const OWN_AD_SOURCE = /(?:\.(?:[cm]?[jt]sx?|html?|vue|svelte|astro|gradle|plist|xml)|(?:^|\/)package\.json)$/i;

/**
 * Each marker is the network's own loader, publisher id or SDK package — never a bare product name, so a
 * comment ("no ads"), a CSS class that HIDES an ad, or prose about advertising can never match. Precision
 * first, exactly as the player rules above: a missed network costs today's sentence, a false one costs a
 * user a warning about ads they do not have.
 */
const OWN_AD_RULES: ReadonlyArray<{ network: OwnAdNetwork; re: RegExp }> = [
  { network: 'Google AdSense', re: /\bpagead2\.googlesyndication\.com|\bca-pub-\d{10,}|\badsbygoogle\s*=\s*window\.adsbygoogle|class=["'][^"']*\badsbygoogle\b/i },
  { network: 'Google Ad Manager', re: /\bsecurepubads\.g\.doubleclick\.net|\bgoogletag\.cmd\b|\bgoogletag\.defineSlot\b/i },
  { network: 'Google AdMob', re: /\bca-app-pub-\d{10,}|['"](?:react-native-google-mobile-ads|@capacitor-community\/admob|@react-native-admob\/admob|@admob-plus\/[\w-]+)['"]|\bcom\.google\.android\.gms\.ads\b|\bGADApplicationIdentifier\b/i },
  { network: 'Amazon', re: /\b(?:c|aax)\.amazon-adsystem\.com|\bapstag\b/i },
  { network: 'Media.net', re: /\bcontextual\.media\.net\b/i },
  { network: 'Taboola', re: /\bcdn\.taboola\.com\b|\b_taboola\b/i },
  { network: 'Outbrain', re: /\bwidgets\.outbrain\.com\b|\bOBR\.extern\b/i },
  { network: 'Adsterra', re: /\b(?:adsterra\.com|highperformanceformat\.com)\b/i },
  { network: 'PropellerAds', re: /\b(?:propellerads\.com|propu\.sh)\b/i },
];

/**
 * Which ad networks the app serves ITSELF — the ads that ARE ours to remove, as opposed to the ones inside
 * another service's player. Give it the WHOLE project, exactly as `projectAdServingPlayers` wants. PURE.
 */
export function projectOwnAdSdks(files: Readonly<Record<string, string>> | null | undefined): OwnAdNetwork[] {
  const found = new Set<OwnAdNetwork>();
  for (const [path, content] of Object.entries(files ?? {})) {
    const p = String(path).replace(/\\/g, '/');
    if (!OWN_AD_SOURCE.test(p) || NOT_APP_SOURCE.test(p) || TEST_FILE.test(p)) continue;
    const text = String(content ?? '');
    if (!text) continue;
    for (const rule of OWN_AD_RULES) {
      if (found.has(rule.network)) continue;
      if (rule.re.test(text)) found.add(rule.network);
    }
  }
  const order: readonly OwnAdNetwork[] = ['Google AdSense', 'Google Ad Manager', 'Google AdMob', 'Amazon', 'Media.net', 'Taboola', 'Outbrain', 'Adsterra', 'PropellerAds'];
  return order.filter((n) => found.has(n));
}

/** "Google AdSense" · "Google AdSense and Taboola". */
function networkList(networks: readonly string[]): string {
  return networks.length === 1 ? networks[0] : `${networks.slice(0, -1).join(', ')} and ${networks[networks.length - 1]}`;
}

/**
 * The second half of the honest sentence, MEASURED (Q-1018). Empty when the app serves no ads of its own —
 * the caller then keeps the "adds no ads of its own" wording, which is now a CHECKED statement. PURE.
 */
export function ownAdsSentence(ownAds: readonly OwnAdNetwork[] | null | undefined): string {
  const list = ownAds ?? [];
  if (list.length === 0) return '';
  return `the app also carries its own ad slots (${networkList([...list])}) — those ARE yours to switch off, so ask me to remove them and I will`;
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
  return (await editTurnAdFacts(prompt, turn, load, env)).players;
}

/** What an ad question is judged against: the other service's players, and the app's own ad slots. */
export interface AdFacts {
  players: AdServingPlayer[];
  ownAds: OwnAdNetwork[];
}

/**
 * Both ad facts from ONE project load (Q-1018). The player question and the own-ads question are asked of
 * the same files at the same moment, so they can never describe two different versions of the project — and
 * the durable store is read once per turn, not twice. Same gate as above: nothing is loaded on a turn that
 * did not ask about ads. A failed load is "nothing known", never an error. PURE apart from `load`.
 */
export async function editTurnAdFacts(
  prompt: string | null | undefined,
  turn: { editTurn: boolean; importTurn: boolean },
  load: () => Promise<Readonly<Record<string, string>> | null | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdFacts> {
  if (!turn.editTurn || turn.importTurn || !thirdPartyLimitsEnabled(env) || !adRemovalRequested(prompt)) return { players: [], ownAds: [] };
  try {
    const files = await load();
    return { players: projectAdServingPlayers(files), ownAds: projectOwnAdSdks(files) };
  } catch {
    return { players: [], ownAds: [] };
  }
}

/** The builder's instruction. Empty when nothing needs saying. PURE. */
export function thirdPartyLimitsBuilderNote(asked: boolean, players: readonly string[] = [], ownAds: readonly OwnAdNetwork[] = []): string {
  if (!asked) return '';
  const where = players.length > 0 ? ownPlayers(players) : "YouTube's own player (or the player of whichever site the video comes from)";
  return [
    `THIRD-PARTY PLAYER NOTE — the user asked for videos with no ads. A video embedded from YouTube, Dailymotion, Twitch or Facebook plays inside ${where}, and that player shows its own ads on videos whose owners earn from them. A page that embeds the player cannot reach inside it, so the app cannot switch those ads off. (Vimeo's player shows no ads.)`,
    // 🔴 Q-1018, the PREVENT half: when the app really DOES carry its own ad slots, "add none of your own"
    // is not the instruction the turn needs — the user asked for the ads to go, and THESE ones are ours to
    // take out. Saying only "add none" left the one removable ad on the screen and then told the user the
    // app adds no ads of its own. Measured, so the instruction is never guessed.
    ownAds.length > 0
      ? `- The app already serves its OWN ads (${networkList([...ownAds])}). Those ARE yours to remove and the user just asked you to: take out the ad script, the ad slot markup and any ad component, in every file that has them. Then add no ads of your own.`
      : '- Add no ads of your own, and keep the app\'s own screens free of clutter around the player.',
    '- Never call the app "ad-free" and never say ads are removed, blocked or skipped — not in the UI, the page title, the meta description, the README, a code comment or your reply.',
    ownAds.length > 0
      ? '- The FIRST sentence of your reply says plainly that ads inside the video site\'s own player may still play on videos whose owners earn from them, and names the app\'s own ad slots you removed.'
      : '- The FIRST sentence of your reply says plainly that ads inside the video site\'s own player may still play on videos whose owners earn from them, and that the app adds no ads of its own.',
    '- The user is already told this at the start of the build — do NOT spend a turn explaining it or asking whether to proceed. Go straight to the work the request asks for.',
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
  // "Double-tap skip adds 10 seconds." describes a skip control, never an ad claim (AD_WORD_AFTER_REMOVAL).
  String.raw`\b(?:removes?|blocks?|skips?|strips?|hides?|filters?\s+out)\s+(?:all\s+|the\s+|any\s+)?(?:youtube(?:'s)?\s+|video\s+)?${AD_WORD_AFTER_REMOVAL}\b`,
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

function measuredLine(players: readonly string[], ownAds: readonly OwnAdNetwork[] = []): string {
  // 🔴 Q-1018: the second half is MEASURED now. It used to assert "adds no ads of its own" on every build,
  // including one whose app carries the AdSense block our own Monetization wizard put there.
  const own = ownAdsSentence(ownAds);
  return `the videos play in ${ownPlayers(players)}, and ads inside that player may still play on videos whose owners earn from them — an app that embeds the player cannot switch those off. ${own || 'The app adds no ads of its own'}`;
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
  /** The app's own ad networks — see the note on `thirdPartyLimitsEndLine` for why it sits after `env`. */
  ownAds: readonly OwnAdNetwork[] = [],
): string {
  if (!thirdPartyLimitsEnabled(env)) return '';
  const list = players ?? [];
  if (list.length === 0) return '';
  const text = String(summary ?? '');
  if (!adFreeClaim(text) || adsMayStillPlaySaid(text)) return '';
  const bullet = `- The line above claiming that the app is ad-free is not supported — ${measuredLine(list, ownAds)}.`;
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
  // 🔴 AFTER `env`, DELIBERATELY (Q-1018). `env` is passed positionally by ~15 existing call sites; moving
  // a tested signature's parameters to satisfy a convention is a diff whose only possible effect is a
  // mistake. The app's own ad networks (`projectOwnAdSdks`) — [] means "measured, and it serves none".
  ownAds: readonly OwnAdNetwork[] = [],
): string {
  if (!thirdPartyLimitsEnabled(env) || typeof summary !== 'string') return '';
  const list = players ?? [];
  if (list.length === 0 || !adRemovalRequested(prompt)) return '';
  if (adsMayStillPlaySaid(summary)) return '';
  const line = measuredLine(list, ownAds).replace(/^the videos/, 'The videos in this app');
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
  // 🔴 THE FACTS, NOT JUST THE PLAYERS (Q-1018). Taking the pair here is what lets the route pass
  // `await adFactsNow()` inline: the chat handler sits ON TypeScript's control-flow limit (TS2563, raised
  // three times on 2026-10-14), so one new local there costs more than a parameter shape does here.
  facts: Partial<AdFacts> | null | undefined,
  onTold?: (players: readonly string[]) => void,
  env: NodeJS.ProcessEnv = process.env,
): T {
  try {
    if (!result || result.ok !== true) return result;
    const players = facts?.players ?? [];
    const line = thirdPartyLimitsEndLine(prompt, result.summary, players, env, facts?.ownAds ?? []);
    if (!line) return result;
    try { onTold?.(players); } catch { /* a report line never costs the user the sentence */ }
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

// ── 5. When the honest answer IS the turn (Q-1019) ───────────────────────────────────────────────────────

/**
 * 🔴 Q-1019 (2026-10-15). An edit turn whose whole ask is *"remove the ads"* on an app that plays videos in
 * YouTube's own player has ONE correct outcome: say that those ads are not the app's to switch off, and
 * change nothing. The platform then filed that turn as a FAILED build — "The build produced no files.
 * Please try again" written over the honest answer, the empty-build retry fired to produce the same answer
 * again on a stronger rung, and on the free tier the upsell asked the user to add credits for it.
 *
 * That is the e628efd4 class, and `turnAnswer.ts` already holds the precedent one property over: a model
 * POINTING at NavBharatAI's own APK flow is a final answer (autopsy 0c2a987a, `pointed`), not an empty
 * build. This is the same shape for a third-party player, with one difference that matters — the verdict is
 * taken from MEASURED FACTS about the project, not from reading the model's prose for a refusal.
 *
 * ⚠️ WHY `ownAds` MUST BE EMPTY, AND IT IS NOT A DETAIL. If the app serves its OWN ads (Q-1018 measures
 * exactly that), then "remove the ads" IS something we can do — the ad script and the slot markup come out —
 * so a turn that wrote nothing genuinely failed, and the retry it would otherwise skip is the right
 * behaviour. The two rows are one fact read twice.
 *
 * ⚠️ AND THE AD REMOVAL MUST BE THE WHOLE ASK. "remove the ads and add dark mode" that wrote nothing is a
 * half-answered turn: the retry might deliver the dark mode, so suppressing it would trade one problem for
 * another. `adRemovalIsTheWholeAsk` is deliberately conservative — in any doubt it answers false and the
 * turn behaves exactly as it does today.
 */
export interface AdRemovalAnsweredInput {
  /** The user's words for this turn. */
  prompt: string | null | undefined;
  /** The model's OWN words, before any platform rewrite (`modelsOwnWords`). */
  modelText: string | null | undefined;
  /** An edit of an app that exists — never a new build (there is nothing to have removed ads from). */
  editTurn: boolean;
  /** An import / survey turn is the user's own code and is never judged by this module. */
  importTurn?: boolean;
  /** The WHOLE project's ad-serving players (`projectAdServingPlayers`). */
  players: readonly string[] | null | undefined;
  /** The WHOLE project's OWN ad networks (`projectOwnAdSdks`) — these ARE ours to remove. */
  ownAds: readonly OwnAdNetwork[] | null | undefined;
}

/**
 * Connectors that mean a second ask, in the languages this app is actually used in. Hindi/Hinglish included
 * because the request this fires on is typed by Indian users ("ads hata do aur dark mode bhi add karo").
 */
const ANOTHER_ASK = /\b(?:and|also|plus|then|additionally|besides|aur|bhi|phir|saath)\b|[;&]|\+/i;

/**
 * Is removing the ads the ONLY thing this turn asks for? Conservative by design: one short clause, one
 * sentence, no connector that could introduce a second ask. A longer or compound request answers false,
 * which leaves today's behaviour exactly as it is. PURE.
 */
export function adRemovalIsTheWholeAsk(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '').trim();
  if (!text || text.length > 160) return false;
  if (!adRemovalRequested(text)) return false;
  // More than one sentence, or any line break, is more than one ask as far as this predicate is concerned.
  if (/\n/.test(text)) return false;
  if (/[.!?]\s*\S/.test(text)) return false;
  return !ANOTHER_ASK.test(text);
}

/**
 * Did this turn ANSWER the user rather than fail — because the only thing asked for is the one thing an app
 * that embeds another service's player cannot do? All six conditions must hold; see the block above for why
 * each one is there. PURE.
 */
export function adRemovalAnsweredNotBuilt(input: AdRemovalAnsweredInput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!thirdPartyLimitsEnabled(env)) return false;
  if (!input || input.editTurn !== true || input.importTurn === true) return false;
  if ((input.players?.length ?? 0) === 0) return false;
  if ((input.ownAds?.length ?? 0) > 0) return false;
  if (!adRemovalIsTheWholeAsk(input.prompt)) return false;
  // The model has to have actually GIVEN the honest answer. Without this the platform would be deciding
  // what the model said, which is the very class `turnAnswer.ts` exists to close.
  return adsMayStillPlaySaid(input.modelText);
}

/**
 * Record that the honest answer finished the turn — every condition and the try live HERE, so the chat
 * handler gains no branch and no try block (it sits ON TypeScript's control-flow limit, TS2563). Info,
 * never a cause: it describes what the engine correctly did NOT do.
 */
export function recordAnsweredNotBuilt(
  diag: { record(r: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): unknown },
  answered: boolean,
  message: string,
): void {
  if (!answered) return;
  try {
    diag.record({ phase: 'build', severity: 'info', code: 'TURN_ANSWERED_NOT_OURS', message, autoResolved: true });
  } catch { /* an advisory line must never affect a build */ }
}

/** The report line for a turn the honest answer finished. Never user-facing. PURE. */
export function adRemovalAnsweredNote(players: readonly string[]): string {
  return `The only thing this turn asked for was removing ads that live inside ${ownPlayers(players.length > 0 ? players : ['YouTube'])}, which an app embedding that player cannot switch off. `
    + 'The model said so and changed nothing, so its answer was left as the answer — not retried, not replaced with '
    + '"the build produced no files", and no upsell was offered. The app serves no ads of its own (measured).';
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
    // "an ad-free, fast app" → "a fast app": the comma that followed the removed word goes with it.
    .replace(/\b(an?)\s+ad[\s-]?free\s*,?\s+(?=(\S))/gi, (_m: string, art: string, next: string) => {
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

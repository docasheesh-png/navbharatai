// WELL-KNOWN GAME TITLES — ONE reader shared by every surface that asks "did the user name a game?".
//
// 🔴 failedbr #2478 (2026-11-20, "make a bgmi for me"): the domain classifier (RequirementGapAnalyzer) answered
// "general" — not a game — because its game headline needed the word "game", while the royale reader in gameIntent
// knew "bgmi" all along. "make pubg for me", "build free fire", "gta 5 banao", "make minecraft for me" and "make a
// ludo for me" were all "general" too, so DOMAIN_KNOWLEDGE was "none" and the kit seed's own domain gate said no.
// gameIntent imports the analyzer, so the shared list has to live here, below both.
//
// PURE, no imports.

/** A royale-style game, by genre or by a named royale title (Hindi spellings included). */
export const BATTLE_ROYALE_REFERENCE = /बैटल\s*रॉयल|पबजी|फ्री\s*फायर|battle\s*royale|\bpubg\b|\bbgmi\b|free\s*fire|firefree|fortnite|battlefield|apex\s+legends|last\s+man\s+standing|\bbr\s+game\b/i;

/** A GTA title, spaced or glued ("gta 5", "gta5", "gtav", "gta vice city") — BR1966 found the glued form missed. */
export const GTA_TITLE = /\bgta(?:\s*[-_]?\s*(?:[5v]|vice\s*city|san\s*andreas))?\b/i;

/**
 * Titles that are unambiguously GAMES when a request names them. Precision-first: words that are also ordinary
 * English or other things (halo, doom, asphalt, pes, chess) are left out — those requests say "game" anyway.
 */
const GAME_TITLES = /\b(?:call\s+of\s+duty|cod\s+mobile|counter[\s-]*strike|cs\s*:?\s*go|valorant|temple\s+run|subway\s+surfers?|gta(?:\s*[-_]?\s*(?:5|v|vice\s*city|san\s*andreas))?|minecraft|among\s+us|candy\s*crush|flappy\s*bird|pac\s*-?\s*man|tetris|super\s*mario|mario\s*kart|ludo|carrom|snakes?\s*(?:and|&|n)\s*ladders?|clash\s+of\s+clans|angry\s*birds|fruit\s*ninja|need\s+for\s+speed|roblox|teen\s*patti|rummy|8\s*ball\s*pool)\b|पबजी|लूडो|कैरम/i;

/**
 * A request ABOUT a game rather than for one: a tournament, a top-up store, a stats tracker, a fan page. Such a request
 * names the title but asks for an ordinary app, and must not be handed a game engine ("BGMI tournament registration app").
 */
const ABOUT_A_GAME = /\b(?:tournaments?|esports?|e-sports?|scrims?|registrations?|register|stats?|statistics|tracker|leaderboard\s+(?:site|website|app)|top\s*-?\s*ups?|recharge|diamonds?|redeem|codes?|coupons?|wallet|store|shop|marketplace|selling|sell|accounts?\s+(?:sale|selling|store)|news|blog|wiki|guide|tips|fan\s*(?:site|page|club)|website|web\s*site|landing\s*page|portal|dashboard|community|forum|clan\s+management|team\s+management|booking|cafe|parlour|parlor)\b/i;

/** Does the request NAME a well-known game as the thing to build (not an app about it)? PURE. */
export function namesWellKnownGame(text: string | null | undefined): boolean {
  const t = String(text ?? '').normalize('NFKC');
  if (!BATTLE_ROYALE_REFERENCE.test(t) && !GAME_TITLES.test(t)) return false;
  return !ABOUT_A_GAME.test(t);
}

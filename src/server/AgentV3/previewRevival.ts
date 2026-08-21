// THE PREVIEW REVIVAL RECIPE — proven when the preview FIRST works, not when it is needed
// (admin 2026-08-21: "jab pahli bar chale, tabhi pakka ho jana chahiye jo sleep ke bad wake up hona hai").
//
// THE REPORTED FAILURE. "Ek bar live preview chal jata hai, app band kar ke wapas aaye to preview
// chalta hi nahi — chahe kuch kar lo, koi bhi command de do, kitna bhi edit karwa lo." That last clause
// is the important one: it is NOT merely a sleeping sandbox. Even a fresh build could not bring the
// preview back, which means the revival path was not short of a wake-up call — it was short of KNOWLEDGE.
//
// WHY IT WAS SHORT OF KNOWLEDGE. The durable record held exactly one useful thing: the sandbox id. So
// when that sandbox was gone, every later attempt had to REDISCOVER how to run the app — re-read
// package.json, guess the framework, guess the port, then walk a ladder of candidate ports visiting
// each one hoping a page renders. That rediscovery is guesswork, and guesswork has a failure rate.
//
// Yet at the moment the preview FIRST came up, none of it was a guess: a specific command had started
// the server, and a specific port had genuinely rendered the app. That knowledge was used once, to
// build a URL, and then thrown away. Every revival afterwards paid to re-derive facts we had already
// held in our hand.
//
// THE RULE THIS MODULE ENFORCES: capture the recipe at the moment of SUCCESS, while it is a fact — and
// confirm it is durably stored right then, while the app is alive and the truth is still available. A
// guarantee checked at the moment of need is not a guarantee; it is a hope. Checked at the moment of
// success, it is a promise the system has already kept once.
//
// WHAT THIS IS HONESTLY NOT. It cannot promise the preview is always INSTANT — a sandbox that was
// merely paused resumes in seconds, one that is gone must be rebuilt from the durable files and that
// takes minutes. And it cannot promise anything if the sandbox provider itself is down. What it
// promises is that reviving is never again a GUESS: the exact command and the exact port that worked
// are known, so the rebuild is deterministic.
//
// PURE — no I/O, no clock beyond what the caller injects. The durable write lives in SandboxStore.

/** Everything needed to bring a preview back without guessing. */
export interface PreviewRecipe {
  /** The command that ACTUALLY started the dev server (never a framework default). */
  devCommand: string;
  /** The port that ACTUALLY rendered the app (never a guess, never merely "listening"). */
  port: number;
  /** The project type, kept for the rebuild's install/scaffold decisions. */
  framework?: string;
  /** When this recipe was proven. */
  provenAt: number;
}

/** Why a recipe could not be formed — stated plainly rather than stored half-complete. */
export type RecipeGap = 'no-command' | 'no-port';

export interface RecipeCheck {
  ok: boolean;
  recipe: PreviewRecipe | null;
  /** The specific things missing, so the caller reports a REAL reason and not "something went wrong". */
  gaps: RecipeGap[];
}

/** A port must be a real TCP port; anything else is a bug upstream, not something to persist. */
function isUsablePort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536;
}

/**
 * Form the recipe from what the successful boot observed.
 *
 * Deliberately REFUSES to produce a partial recipe. A half-recipe is worse than none: it would pass
 * the guarantee check at first run and then fail at revival — which is precisely the shape of failure
 * this whole module exists to end.
 */
export function buildRecipe(input: {
  devCommand?: string | null;
  port?: number | null;
  framework?: string | null;
  now: number;
}): RecipeCheck {
  const devCommand = String(input.devCommand || '').trim();
  const gaps: RecipeGap[] = [];
  if (!devCommand) gaps.push('no-command');
  if (!isUsablePort(input.port)) gaps.push('no-port');
  if (gaps.length > 0) return { ok: false, recipe: null, gaps };
  return {
    ok: true,
    gaps: [],
    recipe: {
      devCommand,
      port: input.port as number,
      framework: String(input.framework || '').trim() || undefined,
      provenAt: input.now,
    },
  };
}

/**
 * Is a recipe read back from the durable store actually usable?
 *
 * Read-back is checked rather than assumed, because "we wrote it" and "it is there" are different
 * facts — the same conflation that produced a stale preview URL being treated as a live preview and a
 * stale build being treated as current. The guarantee is only real if the round trip is verified.
 */
export function isUsableRecipe(recipe: unknown): recipe is PreviewRecipe {
  if (!recipe || typeof recipe !== 'object') return false;
  const r = recipe as Partial<PreviewRecipe>;
  return typeof r.devCommand === 'string' && r.devCommand.trim().length > 0 && isUsablePort(r.port);
}

/** What the user is told once the guarantee is genuinely in place. Short, and it does not overclaim. */
export function revivalConfirmedMessage(): string {
  return 'Preview saved — it can be brought back any time, even after it sleeps.';
}

/**
 * What to say when the recipe could NOT be stored.
 *
 * Said AT FIRST RUN, while the app is still up, because that is the only moment the user can act on it
 * — and because silently carrying an unkeepable promise is the failure mode this module was written to
 * remove. It never blames the user's app: the gap is ours.
 */
export function revivalUnconfirmedMessage(gaps: readonly RecipeGap[]): string {
  const detail = gaps.includes('no-command')
    ? 'the start command could not be recorded'
    : gaps.includes('no-port')
      ? 'the port it runs on could not be recorded'
      : 'the details could not be recorded';
  return `Preview is running, but ${detail} — if it sleeps, restarting it may take longer.`;
}

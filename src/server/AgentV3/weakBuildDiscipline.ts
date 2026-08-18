// AgentV3 — weak-tier "keep-it-running" build discipline (admin-requested 2026-07-14).
//
// WHY: the WEAK (free-tier / cheap-only) build runs on GLM/Kimi — capable coders, but far more
// prone to DRIFT over a long agentic tool-loop than Sonnet/Opus. The observed failure (admin's real
// build reports, deep-test App #7/#9/#10/#12) is a build that keeps adding features across all 80
// steps and ends NOT-ready — a half-broken app — because the weak model neither kept the app
// compiling nor finished the core first. Strong builders self-correct that drift; weak ones need the
// build ORDER made explicit. This is the cheapest, safest half of the fix the admin asked for
// ("ek saath sab banane ke bajaye tukdon me banao"): the OTHER half (an evidence-based mid-build
// checkpoint) ships separately; the biggest lever of all (GLM 429 saturation) is the key pool.
//
// WHAT: a focused build-order instruction PREPENDED to the architect prompt ONLY on a weak build.
// It is pure guidance — it can never break a build (worst case the model ignores a line) — so it is
// safe to apply by default for the weak tier, with an env kill switch. It does NOT modify the base
// architect prompt (systemPrompt.ts); the route prepends it exactly like every other per-build
// context block, so the prompt-regression suite is untouched and non-weak builds are byte-for-byte
// unchanged.
//
// EXTENDED 2026-08-18 (piano-autopsy proactive layer): the build-order half stops the app from ending
// half-broken; it does NOT stop the specific FIRST-PASS defects the weak tier keeps shipping — type
// errors, silently-swallowed errors (empty catch), and missing accessible names on icon-only controls.
// Those are the recurring weak-tier items the paid gates would repair but the free/cheap tier never
// gets a strong repair pass for. So a small "correctness & quality bar" is added to the SAME block
// (single source — no new pass, no model call, no extra cost, weak builds only) to PREVENT them being
// generated at all, per the 50/50 law: fixing the reported bug is half; killing the condition that let
// it exist (the model was never told the bar) is the other half.

/**
 * Env kill switch. The discipline is ON by default for weak builds (it only ever helps and cannot
 * break a build); set AGENTV3_WEAK_DISCIPLINE=off to disable it for a clean A/B or if it ever needs
 * to be turned off without a redeploy.
 */
export function weakDisciplineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_WEAK_DISCIPLINE !== 'off';
}

/**
 * The weak-tier build-order discipline block. Returns '' unless this IS a weak build AND the kill
 * switch is not set — so any non-weak (Sonnet/Opus/paid) build receives an empty string and its
 * prompt is unchanged.
 *
 * @param isWeakBuild the route's resolved weak/cheap-only signal (noClaudeBuild)
 */
export function weakBuildDisciplineBlock(
  isWeakBuild: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isWeakBuild || !weakDisciplineEnabled(env)) return '';
  return [
    '## BUILD DISCIPLINE — keep the app RUNNING at every step (mandatory for this build)',
    '',
    'Build in this STRICT order, and never leave the app in a non-compiling state between steps:',
    '1. FIRST create a minimal skeleton that COMPILES and renders something — the entry point',
    '   (index.html + main/App) and one visible screen. It should run before you add anything else.',
    '2. THEN build the ONE core feature the user asked for, end-to-end, so it actually works. After',
    '   it works, make sure the app still compiles before moving on.',
    '3. ONLY THEN add secondary / nice-to-have features, one coherent slice at a time, re-checking',
    '   that the app still compiles after each one.',
    '',
    'Hard rules for this build:',
    '- A SMALLER app that fully works beats a LARGER app that is half-broken. Prefer finishing the',
    '  core over starting many features you cannot complete.',
    '- Before writing a file, make sure everything it imports either already exists or is the very',
    '  next file you will create — do not accumulate unresolved imports across many files.',
    '- NEVER import server-only Node libraries (jsonwebtoken, bcrypt, fs, pg, mysql2, express) into',
    '  browser code. Auth/JWT/hashing live on the server; the client only calls the API with a token.',
    '- If you are running low on remaining steps, STOP adding new features and make the existing app',
    '  compile and run cleanly instead of leaving work half-done.',
    '',
    '## CORRECTNESS & QUALITY BAR — get it right on the FIRST pass (no clean-up pass will run)',
    '',
    'This build is judged on being correct the first time. Follow these while you write each file, not',
    'afterwards — there is no strong model coming behind you to fix them:',
    '- TYPE-SAFE code only. Give every function parameter, return value, prop and state a real type. Do',
    '  NOT reach for `any` or `as any` to silence the compiler — if you are unsure of a shape, declare a',
    '  small interface/type for it. Leave ZERO TypeScript errors; the app must type-check.',
    '- NEVER swallow an error. Every `try` must actually handle its `catch` — show the user a message,',
    '  set an error state, or at minimum surface it — an empty `catch {}` (or a catch that only ignores)',
    '  is forbidden. A hidden failure is worse than a visible one.',
    '- ACCESSIBLE by default. Every icon-only button, link or input needs an accessible name',
    '  (`aria-label` or visible text). Every form input needs an associated `<label>`. Do this as you',
    '  create the control, not as a later fix.',
  ].join('\n');
}

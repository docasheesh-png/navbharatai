// AgentV3 — THE "COMING SOON" CONTRACT: a feature whose credential is missing FREEZES; the app never dies
// (admin spec 2026-08-03: "jab tak user keys and secret na de de tab tak, us option ko 'coming soon' likh
// kar freeze kar do — puri app band na ho").
//
// THE PROBLEM. AppRequirements.ts (the companion module) tells the USER which of their own keys an app still
// needs. But that message is worthless if the app is already dead by the time they read it. Generated apps
// routinely do the fatal thing at module scope:
//
//     if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('Missing RAZORPAY_KEY_SECRET');
//
// ONE unset key and the whole server refuses to boot / the whole page white-screens — a 12-screen app is
// destroyed by a payment key the user simply hasn't pasted yet. That is a total failure of the one absolute
// rule (the app must never break), caused by something the user has done nothing wrong to trigger.
//
// THE FIX IS PREVENTION, NOT REPAIR (the 50/50 law): the real cure is that the builder never GENERATES the
// fatal pattern. So this module ships two layers:
//
//   1. `credentialGuardInstruction()` — a hard CONTRACT injected into the builder's system prompt. Missing
//      credential ⇒ that ONE control renders disabled with a visible "Coming soon" state and the exact key
//      name + settings path; everything else keeps working. Never throw at import/boot; never fake a result.
//   2. `findBootKillingEnvGuards()` — a deterministic detector for the exact fatal pattern above, so we can
//      SEE (in the build report) whether the contract was actually honoured instead of assuming it. High
//      precision: it fires only on a real top-level `throw`/`process.exit` gated on a missing env var.
//
// Layer 2 is honesty, not enforcement: it never rewrites the user's code and never fails a build. It makes
// a contract violation VISIBLE so it can be root-caused, rather than silently shipping a bricked app.
//
// Pure + deterministic: no I/O, no LLM call, zero added cost.
// Kill switch: AGENTV3_CREDENTIAL_GUARD=off → the prompt block is not injected (byte-identical prompt) and
// the detector is not run.

export function credentialGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_CREDENTIAL_GUARD ?? '').trim().toLowerCase() !== 'off';
}

/** The exact path the generated UI must point the user at (matches AppRequirements + AppKnowledgeBase). */
export const SECRETS_SETTINGS_PATH = 'Settings → App Settings → Secrets & API Keys';

/**
 * The builder contract. Injected into the Architect's system prompt so the FIRST build is already correct —
 * no heal pass has to rescue it later. Written as hard rules with a concrete example, because a vague
 * "handle missing keys gracefully" produces exactly the try/catch-and-crash code we are trying to prevent.
 */
export function credentialGuardInstruction(): string {
  return [
    'MISSING-CREDENTIAL CONTRACT (mandatory — never break the whole app for one unset key):',
    '',
    'Some features need a credential that only the END USER can supply from their own account (payment',
    'gateway keys, SMTP password, SMS/OTP token, Maps key, their own AI key, storage keys, a hosted database',
    'URL). At build time that key is usually NOT set yet. When it is missing you MUST degrade that ONE',
    'feature and keep every other part of the app fully working.',
    '',
    'RULES:',
    '1. NEVER throw, `process.exit`, or crash at import/module/boot scope because an env var is missing.',
    '   A missing key must never stop the server from starting or blank the page. This is absolute.',
    '2. Compute a plain boolean once, near the top of the module, e.g.',
    '     const paymentsEnabled = Boolean(import.meta.env.VITE_RAZORPAY_KEY_ID);',
    '   (server side: `const paymentsEnabled = Boolean(process.env.RAZORPAY_KEY_SECRET);`)',
    '3. When it is false, render that control in a FROZEN "Coming soon" state — visible, disabled, and',
    '   self-explanatory. It must say **Coming soon** and name the exact key and where to add it. Example:',
    '     <button disabled title="Add RAZORPAY_KEY_ID in ' + SECRETS_SETTINGS_PATH + '">',
    '       Pay now — Coming soon',
    '     </button>',
    '     {!paymentsEnabled && (',
    '       <p className="text-sm text-muted-foreground">',
    '         Payments are coming soon — add <code>RAZORPAY_KEY_ID</code> in ' + SECRETS_SETTINGS_PATH + ' to turn this on.',
    '       </p>',
    '     )}',
    '4. Do NOT hide or delete the feature, and do NOT remove its route/page. The user must SEE that it',
    '   exists and is one key away. A hidden feature looks like a missing feature.',
    '5. NEVER fake the result. No mock "Payment successful", no fake OTP that always passes, no pretend',
    '   email sent. A frozen feature does nothing and says so.',
    '6. On the server, a route whose credential is missing must still EXIST and respond honestly —',
    '   `res.status(503).json({ error: "Payments not configured yet", missing: "RAZORPAY_KEY_SECRET" })` —',
    '   never a crash, never a 500, never a fabricated success.',
    '7. Everything that does NOT need that key must work completely and normally.',
  ].join('\n');
}

// ── Layer 2: the deterministic detector ────────────────────────────────────────────────────────────────

export interface BootKillingGuard {
  /** File the fatal guard lives in. */
  file: string;
  /** 1-indexed line of the guard. */
  line: number;
  /** The env var whose absence kills the app. */
  envVar: string;
  /** The offending source line, trimmed + length-capped. */
  snippet: string;
}

/** Paths that are not the app's own source. */
const SKIP_PATH = /(^|[/\\])(node_modules|dist|build|coverage|\.next|\.git|vendor)([/\\]|$)|\.test\.|\.spec\.|(^|[/\\])__tests__([/\\]|$)/i;

const SOURCE_FILE = /\.(m?[jt]sx?|c?[jt]s)$/i;

/**
 * `if (!process.env.NAME)` / `if (!import.meta.env.NAME)` — with or without a `.trim()`, and tolerant of the
 * bracket form. Capturing group 1/2 is the env-var name.
 */
const MISSING_ENV_TEST =
  /if\s*\(\s*!\s*(?:process\.env|import\.meta\.env)(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\])/;

/** The fatal consequence: a throw or a hard process exit. */
const FATAL_CONSEQUENCE = /\b(?:throw\s+(?:new\s+)?\w|process\.exit\s*\()/;

/**
 * Find every place the built app KILLS ITSELF because an env var is unset — the pattern that turns "one
 * feature is not configured" into "the whole app is down".
 *
 * Detection is deliberately narrow so it cannot cry wolf:
 *   • the guard and its consequence must be on the same line, or the consequence on the very next line
 *     (the two shapes real generated code uses: `if (!x) throw …` and `if (!x) {\n  throw …`);
 *   • the throw must be reached by a MISSING-env test (a plain `throw` elsewhere is not our business);
 *   • it must sit at TOP LEVEL — indentation 0–2 — because a throw inside a request handler or a function
 *     body is a normal, recoverable error, not a boot-killer. This is the one heuristic here, and it is
 *     biased toward silence: an indented boot-killer is missed rather than a safe throw being flagged.
 *
 * Pure. Returns [] for anything it is not sure about.
 */
export function findBootKillingEnvGuards(
  files: Map<string, string> | Record<string, string> | null | undefined,
): BootKillingGuard[] {
  if (!files) return [];
  const entries = (files instanceof Map ? Array.from(files.entries()) : Object.entries(files)).filter(
    ([p, c]) => typeof p === 'string' && typeof c === 'string' && SOURCE_FILE.test(p) && !SKIP_PATH.test(p),
  ) as Array<[string, string]>;

  const out: BootKillingGuard[] = [];
  for (const [file, content] of entries) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const m = MISSING_ENV_TEST.exec(raw);
      if (!m) continue;
      const indent = raw.length - raw.trimStart().length;
      if (indent > 2) continue; // nested in a function/handler → recoverable, not a boot-killer
      const envVar = m[1] || m[2];
      if (!envVar) continue;
      const sameLine = FATAL_CONSEQUENCE.test(raw.slice(m.index));
      const nextLine = i + 1 < lines.length && FATAL_CONSEQUENCE.test(lines[i + 1]) && /\{\s*$/.test(raw);
      if (!sameLine && !nextLine) continue;
      out.push({ file, line: i + 1, envVar, snippet: raw.trim().slice(0, 200) });
    }
  }
  return out;
}

/**
 * The FOCUSED repair instruction handed to the bounded heal pass when the contract was violated anyway.
 *
 * Why an LLM pass and not a mechanical rewrite: the obvious textual fix (turn the `throw` into a
 * `console.warn`) is NOT safe. A `throw` narrows types for everything after it, so removing it can turn a
 * `string | undefined` into a type error and break the whole app's compile — trading a runtime brick for a
 * build failure. The correct fix (a boolean flag, a guarded call site, a disabled "Coming soon" control) is
 * a real code change, so we give the healer the EXACT file:line and the exact shape to produce, the same
 * way hooksRepairInstruction does. Pure.
 */
export function bootKillerRepairInstruction(found: BootKillingGuard[]): string {
  const list = found
    .slice(0, 20)
    .map((g) => `- ${g.file}:${g.line} — kills the app when ${g.envVar} is unset: \`${g.snippet}\``)
    .join('\n');
  return [
    'CRITICAL — the app destroys itself when a credential is missing. Fix ONLY this, nothing else.',
    '',
    'These lines throw or exit at module/boot scope because an environment variable is not set:',
    list,
    '',
    'That environment variable is supplied LATER by the end user from their own account, so at startup it',
    'is legitimately empty — and right now that takes the ENTIRE app down (server refuses to boot / the page',
    'goes blank). Every unrelated screen is destroyed by one key the user simply has not pasted yet.',
    '',
    'For EACH line above:',
    '1. Delete the boot-time throw / process.exit. Nothing may crash at import or boot scope.',
    '2. Replace it with a boolean, e.g. `const paymentsEnabled = Boolean(process.env.RAZORPAY_KEY_SECRET);`',
    '   and export it if other modules need it.',
    '3. Guard every use of that credential with the boolean. If TypeScript now complains that the value may',
    '   be undefined, narrow it INSIDE the guarded branch — do not re-add a top-level throw and do not use',
    '   a non-null assertion to silence it.',
    '4. In the UI, render the affected control visibly DISABLED with the text "Coming soon" plus the exact',
    `   key name and "${SECRETS_SETTINGS_PATH}". Do not hide or delete the feature.`,
    '5. On the server, keep the route registered and answer honestly:',
    '   `res.status(503).json({ error: "<feature> not configured yet", missing: "<ENV_VAR>" })`.',
    '6. NEVER fake a result (no mock success response, no OTP that always passes).',
    '',
    'Do not refactor anything else, do not rename files, and do not change any unrelated behaviour.',
  ].join('\n');
}

/**
 * A one-line, admin-facing summary of the detector's findings for the build report, or `''` when the app is
 * clean. Never user-facing (it names files and variables, which is diagnostics, not product copy).
 */
export function bootKillingGuardSummary(found: BootKillingGuard[]): string {
  if (!Array.isArray(found) || found.length === 0) return '';
  const shown = found
    .slice(0, 8)
    .map((g) => `${g.file}:${g.line} (${g.envVar})`)
    .join(', ');
  const more = found.length > 8 ? ` +${found.length - 8} more` : '';
  return `${found.length} boot-killing env guard(s): an unset key would take the WHOLE app down instead of freezing one feature — ${shown}${more}`;
}

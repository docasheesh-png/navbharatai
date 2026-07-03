// AgentV3 — deterministic guard against MANUAL dev-server / preview improvisation.
//
// WHY: the live preview is MANAGED by NavBharatAI — E2BActuator.runCommand detects a `npm run dev`
// (or `vite`) long-running command, binds 0.0.0.0, pins the port, sets allowedHosts, backgrounds it,
// health-checks the port, and publishes the preview URL. When that managed preview merely LOOKS blank
// for a moment (a proxy hiccup, a cold port), the build agent tends to IMPROVISE with cruder tricks —
// `pkill -f vite`, `npx serve dist -l 3000`, `npx vite preview --port 4174`, port-hopping — none of
// which the managed preview proxy serves. Two real build reports showed 8+ minutes burned in exactly
// this loop while the build itself was already fine.
//
// This is the deterministic backstop (same philosophy as ScaffoldGuard): detect those manual
// preview-management commands BEFORE they run and REDIRECT the agent to the ONE managed path
// (`npm run dev`, then the Preview tab), instead of executing something that fights the managed
// preview and wastes the build. PURE & deterministic (no I/O) → fully unit-testable.

export interface PreviewGuardResult {
  /** True when the command is manual preview/dev-server improvisation that must be redirected. */
  redirect: boolean;
  /** Honest reason, present only when redirect. */
  reason?: string;
}

// Patterns for the crude alternatives the agent reaches for when the managed preview looks blank.
// Conservative: each targets an UNAMBIGUOUS improvisation so the legitimate managed start
// (`npm run dev`, `npx vite`, `vite --host …`) is NEVER matched.
// A command-position anchor: start of string, or right after a shell separator (; & && || |). Lets us
// match `serve`/`http-server` only when they are the COMMAND being invoked, never when the same word
// appears as a quoted ARG (e.g. `grep "serve" src` must NOT match).
const CMD = '(?:^|[;&|]|&&|\\|\\|)\\s*(?:npx\\s+)?';
const IMPROV_PATTERNS: Array<{ re: RegExp; what: string }> = [
  // `serve dist` / `npx serve dist -l 3000` — serving the BUILT output on an ad-hoc port, not the dev server.
  { re: new RegExp(`${CMD}serve\\s`, 'i'), what: 'serving the built `dist/` with `serve`' },
  // `vite preview` / `npx vite preview` — preview mode; the managed dev server already IS the preview.
  { re: /\bvite\s+preview\b/i, what: '`vite preview` (the managed dev server already is the preview)' },
  // `pkill` / `killall` aimed at the dev server (vite/node/esbuild) — a manual kill; the platform owns
  // the dev-server lifecycle (it restarts via fuser/lsof, not a Vite-blind pkill).
  { re: /\b(pkill|killall)\b[^\n|;]*\b(vite|node|esbuild)\b/i, what: 'manually killing the dev server (pkill/killall)' },
  // `python -m http.server` / `http-server` — another ad-hoc static server improvisation.
  { re: new RegExp(`${CMD}http-server\\b`, 'i'), what: 'an ad-hoc static file server' },
  { re: /\bpython3?\s+-m\s+http\.server\b/i, what: 'an ad-hoc static file server' },
];

/**
 * Classify whether a shell command is manual dev-server / preview improvisation that should be
 * redirected to the managed preview path instead of run. PURE & deterministic.
 */
export function previewGuard(command: string): PreviewGuardResult {
  const cmd = (command || '').trim();
  if (!cmd) return { redirect: false };
  for (const { re, what } of IMPROV_PATTERNS) {
    if (re.test(cmd)) {
      return { redirect: true, reason: `The live preview is MANAGED by NavBharatAI — ${what} fights it and wastes the build.` };
    }
  }
  return { redirect: false };
}

/**
 * The redirect message returned in place of running a blocked preview-improvisation command. Tells the
 * agent the ONE managed way to (re)start the preview and NOT to pkill / serve / port-hop. PURE.
 */
export function previewGuardMessage(reason: string): string {
  return [
    `REDIRECTED (preview guard): ${reason}`,
    '',
    'The live preview is handled for you. To (re)start it, run EXACTLY:',
    '    npm run dev',
    'once — NavBharatAI then binds 0.0.0.0, pins the port, sets allowedHosts, health-checks it, and',
    'publishes the preview URL (open the Preview tab). Do NOT `pkill` the server, `serve`/`http.server`',
    'the built output, run `vite preview`, or hop ports — those are not reachable through the managed',
    'preview proxy. If the preview looked blank, just run `npm run dev` again and open the Preview tab.',
  ].join('\n');
}

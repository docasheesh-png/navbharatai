// THE NATIVE BUILD RUNS THE SAME STEPS THE GITHUB BUILD RUNS — translated, never re-typed.
//
// WHY THIS EXISTS (2026-11-25, dual Android build providers). NavBharatAI already owns a long-hardened
// Android recipe: the install fallback, the web-build type-check fallback, the icon heals, the strings.xml
// ampersand escape, the minSdk floor, the Gradle network retry — every one of them a real autopsy. That
// recipe lives in ONE place, the workflow templates in `mobileShipKit.ts`. A second, hand-written copy of it
// for the Native Cloud Build would be the exact drift class this repo keeps paying for (4 copies of
// `safeRelPath`, 5 copies of retired model ids). So the native worker does not get its own recipe: it gets
// the GitHub workflow the app was assembled with, translated step by step into one bash script.
//
// 🔒 STRICT BY DESIGN. The input is always our own generator's output, so this is a narrow parser for that
// shape, not a YAML implementation. Anything it does not recognise THROWS — a new step that needs GitHub
// context (an unknown `${{ … }}`, a new `uses:` that is not a cache/upload/setup step) fails loudly in the
// census test rather than being silently dropped from native builds. That is what keeps the two providers
// running the same recipe as the workflow grows.

/** One parsed step of a generated workflow. */
export interface WorkflowStep {
  name: string;
  uses?: string;
  if?: string;
  env: Record<string, string>;
  run?: string;
}

/** What the translator did with each step — exported so the census test can pin every decision. */
export type StepDisposition =
  | { name: string; action: 'run' }
  | { name: string; action: 'skip'; why: 'github-action' | 'conditional' | 'signing' };

export interface NativeBuildPlan {
  steps: Array<{ name: string; env: Record<string, string>; run: string }>;
  dispositions: StepDisposition[];
  /** Where Gradle writes the artifact this lane produces (relative to the project root). */
  outputPath: string;
}

export type NativeArtifactKind = 'apk' | 'aab';

/**
 * Steps that exist only to restore or check the GitHub-repository signing secrets. The Native Cloud Build
 * NEVER signs inside the untrusted build sandbox — it compiles unsigned and signs in a separate, network-less
 * sandbox that runs no app code (see nativeSigning.ts) — so these steps have no native equivalent.
 * Named explicitly (not inferred) so a renamed step fails the census test instead of silently running.
 */
export const SIGNING_ONLY_STEPS: ReadonlySet<string> = new Set([
  'Pre-flight — require signing secrets',
  'Restore the keystore and wire Gradle signing',
]);

/** The `uses:` actions whose job the native worker image already does (toolchain is baked in) or does not need. */
const KNOWN_ACTIONS = /^actions\/(checkout|setup-node|setup-java|cache\/restore|cache\/save|upload-artifact)@/;

/** The Gradle outputs each lane's workflow uploads — mirrored from the workflows' upload steps (census-tested). */
export const NATIVE_OUTPUT_PATH: Record<NativeArtifactKind, string> = {
  apk: 'android/app/build/outputs/apk/debug/app-debug.apk',
  aab: 'android/app/build/outputs/bundle/release/app-release.aab',
};

function fail(why: string): never {
  throw new Error(`Native build plan: ${why}`);
}

/** Strip one level of matching single/double quotes from a scalar, as the generator writes them. */
function scalar(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) return v.slice(1, -1);
  return v;
}

/**
 * Parse the `steps:` list of a generated workflow. Steps start at 6 spaces (`      - `), keys sit at
 * 8 spaces, `env:` entries at 10, and a `run: |` block body at 10 or deeper. Comments and blank lines
 * between steps are ignored; a blank line INSIDE a run block is kept.
 */
export function parseWorkflowSteps(yaml: string): WorkflowStep[] {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (start < 0) fail('no `steps:` list');
  const steps: WorkflowStep[] = [];
  let cur: WorkflowStep | null = null;
  let mode: 'key' | 'env' | 'with' | 'run' = 'key';
  let runLines: string[] = [];
  const flushRun = (): void => {
    if (cur && mode === 'run') {
      while (runLines.length && runLines[runLines.length - 1].trim() === '') runLines.pop();
      cur.run = runLines.join('\n') + '\n';
    }
    runLines = [];
  };
  for (let i = start + 1; i < lines.length; i++) {
    let line = lines[i];
    if (mode === 'run') {
      if (line.trim() === '' ) { runLines.push(''); continue; }
      if (line.startsWith('          ')) { runLines.push(line.slice(10)); continue; }
      flushRun();
      mode = 'key';
    }
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (!line.startsWith('      ')) break; // left the steps list (a new job or top-level key)
    if (/^ {6}- \w/.test(line)) {
      // A new step. Its first key sits on the dash line; re-indent it so it parses like every other key.
      if (cur) steps.push(cur);
      cur = { name: '', env: {} };
      mode = 'key';
      line = '        ' + line.slice(8);
    }
    if (!cur) fail(`content before the first step: ${line.trim()}`);
    const kv = /^ {8}(\w[\w-]*):\s?(.*)$/.exec(line);
    if (kv) {
      const [, key, value] = kv;
      mode = 'key';
      if (key === 'name') cur.name = scalar(value);
      else if (key === 'uses') cur.uses = scalar(value);
      else if (key === 'if') cur.if = value.trim();
      else if (key === 'env') mode = 'env';
      else if (key === 'with') mode = 'with';
      else if (key === 'run') {
        if (value.trim() === '|') { mode = 'run'; runLines = []; }
        else cur.run = value.trim() + '\n';
      } else if (key === 'id' || key === 'continue-on-error' || key === 'timeout-minutes') { /* metadata only */ }
      else fail(`unsupported step key "${key}" in step "${cur.name || cur.uses}"`);
      continue;
    }
    const sub = /^ {10}(\w[\w-]*):\s?(.*)$/.exec(line);
    if (sub && mode === 'env') { cur.env[sub[1]] = scalar(sub[2]); continue; }
    if (mode === 'with' && line.startsWith('          ')) continue; // action inputs: irrelevant natively
    fail(`unexpected line in step "${cur.name || cur.uses}": ${line.trim()}`);
  }
  if (mode === 'run') flushRun();
  if (cur) steps.push(cur);
  for (const s of steps) if (!s.name) s.name = s.uses ?? 'unnamed step';
  return steps;
}

/** The only GitHub expressions with a native meaning. Anything else in a run body makes the plan refuse. */
function substituteExpressions(text: string, ctx: { versionCode: number }, stepName: string): string {
  return text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) => {
    if (expr === 'github.run_number') return String(ctx.versionCode);
    return fail(`step "${stepName}" needs GitHub context "\${{ ${expr} }}", which has no native meaning`);
  });
}

/**
 * Turn a generated workflow into the native plan: every step the GitHub runner would execute, minus the
 * toolchain actions (baked into the worker image), the conditional bookkeeping steps (cache save, failure
 * diagnostic, keystore cleanup) and the signing-secret steps (signing is a separate, trusted stage).
 */
export function planFromWorkflow(yaml: string, kind: NativeArtifactKind, ctx: { versionCode: number }): NativeBuildPlan {
  if (!Number.isSafeInteger(ctx.versionCode) || ctx.versionCode < 1 || ctx.versionCode > 2_100_000_000) {
    fail('versionCode must be an integer between 1 and 2100000000');
  }
  const parsed = parseWorkflowSteps(yaml);
  const plan: NativeBuildPlan = { steps: [], dispositions: [], outputPath: NATIVE_OUTPUT_PATH[kind] };
  for (const s of parsed) {
    if (s.uses) {
      if (!KNOWN_ACTIONS.test(s.uses)) fail(`unknown action "${s.uses}" — decide its native equivalent before shipping it`);
      plan.dispositions.push({ name: s.name, action: 'skip', why: 'github-action' });
      continue;
    }
    if (s.if) { plan.dispositions.push({ name: s.name, action: 'skip', why: 'conditional' }); continue; }
    if (SIGNING_ONLY_STEPS.has(s.name)) { plan.dispositions.push({ name: s.name, action: 'skip', why: 'signing' }); continue; }
    if (!s.run) fail(`step "${s.name}" has neither uses nor run`);
    // An env value that reads a repository secret has no native source. Native compiles UNSIGNED, so the
    // only such values (the signing passwords on the Gradle step) are unused — dropping them is exact.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.env)) {
      if (/\$\{\{\s*secrets\./.test(v)) continue;
      env[k] = substituteExpressions(v, ctx, s.name);
    }
    plan.steps.push({ name: s.name, env, run: substituteExpressions(s.run, ctx, s.name) });
    plan.dispositions.push({ name: s.name, action: 'run' });
  }
  if (!plan.steps.some((s) => /gradlew/.test(s.run))) fail('the workflow has no Gradle build step');
  return plan;
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** Quote a value for a bash `export NAME=…` line. */
function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render the plan as ONE bash script. Each step runs as `bash -e step.sh` — exactly GitHub's default
 * `run:` shell — from the project root, with the step's own env, and prints a progress marker the
 * orchestrator turns into real status. The first failing step stops the build and is named.
 */
export function renderNativeBuildScript(plan: NativeBuildPlan, opts: { projectDir: string; javaHome: string }): string {
  const out: string[] = [
    '#!/usr/bin/env bash',
    '# Generated by NavBharatAI — the native translation of this app\'s own GitHub workflow.',
    'set -uo pipefail',
    `cd ${shQuote(opts.projectDir)}`,
    `export JAVA_HOME=${shQuote(opts.javaHome)}`,
    'export PATH="$JAVA_HOME/bin:$PATH"',
    'export CI=true',
    'export RUNNER_TEMP="$(mktemp -d)"',
    'export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/summary.md" GITHUB_ENV="$RUNNER_TEMP/env" GITHUB_OUTPUT="$RUNNER_TEMP/output"',
    'export GITHUB_WORKSPACE="$PWD"',
    'touch "$GITHUB_STEP_SUMMARY" "$GITHUB_ENV" "$GITHUB_OUTPUT"',
    'STEPS_DIR="$RUNNER_TEMP/steps"; mkdir -p "$STEPS_DIR"',
  ];
  plan.steps.forEach((step, i) => {
    const n = i + 1;
    const delim = `NBAI_STEP_${n}_EOF`;
    if (step.run.split('\n').some((l) => l === delim)) fail(`step "${step.name}" contains its own heredoc delimiter`);
    out.push('', `# ── step ${n}: ${step.name.replace(/\n/g, ' ')}`);
    out.push(`cat > "$STEPS_DIR/${n}.sh" <<'${delim}'`, step.run.replace(/\n$/, ''), delim);
    out.push(`echo "::nbai-step::${n}::${plan.steps.length}::${step.name.replace(/["$`\\]/g, '')}"`);
    const envs = Object.entries(step.env).map(([k, v]) => {
      if (!ENV_NAME.test(k)) fail(`step "${step.name}" has an invalid env name "${k}"`);
      return `${k}=${shQuote(v)}`;
    });
    out.push(`if ! env ${envs.join(' ')} bash -e "$STEPS_DIR/${n}.sh"; then`);
    out.push(`  echo "::nbai-failed::${n}::${step.name.replace(/["$`\\]/g, '')}"`);
    out.push('  exit 1');
    out.push('fi');
  });
  out.push('', `if [ ! -f ${shQuote(plan.outputPath)} ]; then`,
    `  echo "::nbai-failed::output::Gradle finished but ${plan.outputPath} was not produced"`,
    '  exit 1', 'fi',
    `echo "::nbai-output::${plan.outputPath}"`, '');
  return out.join('\n');
}

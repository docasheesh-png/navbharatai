// AgentV3 — STRONG (Sonnet) build judge for cheap-floor builds.
//
// WHY: when the cheap floor (GLM/Kimi) builds an app, letting that SAME cheap model review its own
// work is unreliable — it rarely finds its own gaps (a cosmetic feature that only LOOKS done, a
// subtle bug). The admin-approved pattern (2026-07-03): build cheap, but JUDGE with a STRONG model
// (Sonnet). Only when the strong judge FAILS the cheap build do we spend Sonnet to REPAIR it — and
// the repair is targeted at the judge's specific findings (edit the existing files), never a rebuild.
//
// This module is the pure, testable core: the review PROMPT and the verdict PARSER. The single Sonnet
// call is injected (a `runTurn` fn) so the judge is unit-testable without a live model. Best-effort by
// contract — a judge error/parse-miss resolves to PASS (never block or fail a real build on the judge).

export interface JudgeVerdict {
  /** True = the cheap build genuinely satisfies the request → keep it (no Sonnet spend). */
  pass: boolean;
  /** Specific, actionable problems when pass=false — fed to Sonnet as a REPAIR list (not a rebuild). */
  findings: string[];
  /** 0–100 quality score (best-effort; 100 on pass, lower on fail). */
  score: number;
  /**
   * Did the judge actually REVIEW the app?
   *
   * 🔴 `pass` means "do not block this build" — it has never meant "approved", and two returns below
   * set it true precisely because a judge must not fail an app over its OWN failure. Both of them
   * carry the truth in `findings`… which the one line that REPORTS them threw away: `recordVerdict`
   * appends findings only when `pass` is false, so a judge that could not run was recorded as
   *
   *     Sonnet review: PASS (score 0)
   *
   * — a pass, with no explanation, under the wrong engine's name. Autopsy 31dc61fd.
   *
   * ⚠️ DERIVED, NOT INFERRED. The reader must not guess "score 0 and a finding means it did not run":
   * a real verdict may legitimately score 0, and a rule built on that coincidence breaks the day one
   * does. The judge states it. Absent ⇒ true, so any other producer of this shape keeps today's
   * meaning.
   */
  reviewed?: boolean;
}

/** Build the STRICT-reviewer prompt: the user's request + the generated files. Pure. */
export function buildJudgePrompt(
  userRequest: string,
  files: Array<{ path: string; content: string }>,
): { system: string; user: string } {
  const system = [
    'You are a STRICT senior code reviewer. A CHEAPER AI model just built an app; your job is to catch',
    'what that model cannot see in its own work: features that only LOOK done (cosmetic, no real logic),',
    'real bugs, missing requested functionality, and security issues.',
    'Return PASS only when the app CORRECTLY and GENUINELY implements the user\'s request with working,',
    'non-cosmetic code. Return FAIL with specific, actionable findings when there are REAL problems.',
    'Minor style/formatting/naming is NOT a fail. Do not invent problems.',
    'Respond with ONLY a JSON object, no prose: {"verdict":"pass"|"fail","findings":["..."],"score":0-100}.',
  ].join('\n');
  // Cap per-file and file-count so the review prompt stays bounded (cost + context).
  const blocks = files
    .filter((f) => !/^(node_modules|\.git|dist|build)\//.test(f.path))
    .slice(0, 24)
    .map((f) => `--- ${f.path} ---\n${(f.content || '').slice(0, 4000)}`)
    .join('\n\n');
  const user = `The user asked for:\n"""\n${userRequest.slice(0, 2000)}\n"""\n\nThe generated app files:\n\n${blocks}\n\nJudge whether it REALLY implements the request. JSON only.`;
  return { system, user };
}

/** Parse the judge's reply into a verdict. Best-effort: an unparseable reply is a PASS (never block). Pure. */
export function parseJudgeVerdict(text: string | null | undefined): JudgeVerdict {
  if (text) {
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]) as { verdict?: unknown; findings?: unknown; score?: unknown };
        const pass = String(j.verdict).toLowerCase().trim() === 'pass';
        const findings = Array.isArray(j.findings) ? j.findings.map((f) => String(f)).filter(Boolean).slice(0, 10) : [];
        const score = typeof j.score === 'number' && isFinite(j.score) ? Math.max(0, Math.min(100, j.score)) : (pass ? 100 : 40);
        // A "fail" with no findings is unactionable — treat as pass so we never escalate blind.
        if (!pass && findings.length === 0) return { pass: true, findings: [], score: 100 };
        return { pass, findings, score };
      }
    } catch { /* fall through to the safe default */ }
  }
  return { pass: true, findings: [], score: 100 };
}

/** A minimal model-call surface (a subset of ClaudeClient.runTurn) so the judge is DI-testable. */
export type JudgeRunTurn = (args: {
  model: string;
  system: string;
  messages: Array<{ role: 'user'; content: string }>;
  tools: [];
  maxTokens: number;
}) => Promise<{ text: string }>;

/**
 * Run the STRONG judge on a cheap build. `runTurn` must be a Sonnet-forced turn. Best-effort: any
 * error resolves to PASS so the judge can never block or fail a genuine build. Returns the verdict +
 * a repair prompt (built from the findings) the caller hands to Sonnet on a FAIL.
 */
export async function judgeBuild(
  userRequest: string,
  files: Array<{ path: string; content: string }>,
  runTurn: JudgeRunTurn,
  sonnetModelId: string,
): Promise<JudgeVerdict> {
  // AN EMPTY WORKSPACE IS NOT A PERFECT ONE (admin, 2026-08-06). This returned score 100 with no
  // findings — an affirmative claim of perfection about nothing. The admin watched a build wipe its
  // files to zero three times, and not one check complained, because every analyser here treats "no
  // files" as "nothing wrong". For a pure analyser given a subset that is correct; for the JUDGE, whose
  // whole output is a quality VERDICT, it is a false success of the worst kind: the emptier the app, the
  // better it scored.
  //
  // It still never BLOCKS (a judge that fails a build on its own confusion is worse), but it no longer
  // awards marks it did not earn, and it says why so the report carries the alarm.
  if (!files || files.length === 0) {
    return { pass: true, score: 0, reviewed: false, findings: ['There were no files to review — the project was empty at review time. This is not a passing app; it is an absent one.'] };
  }
  try {
    const { system, user } = buildJudgePrompt(userRequest, files);
    const t = await runTurn({ model: sonnetModelId, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 1500 });
    return parseJudgeVerdict(t.text);
  } catch {
    // A judge that could not RUN has not approved anything either — same rule as above.
    return { pass: true, score: 0, reviewed: false, findings: ['The build review could not be completed, so this build has not been reviewed.'] }; // never breaks a build
  }
}

/**
 * Build the REPAIR prompt handed to Sonnet when the judge FAILS a cheap build — "fix THESE issues by
 * editing the existing files", never a rebuild-from-scratch. The files are already in the workspace, so
 * a repair-framed prompt makes Sonnet edit, not regenerate. Pure.
 */
export function judgeRepairPrompt(userRequest: string, findings: string[]): string {
  const list = findings.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    'The app for this request is ALREADY built in the current workspace, but a strict code review found',
    'real problems that must be fixed:',
    '',
    list,
    '',
    'FIX these specific issues by EDITING the existing files (read them first; do NOT rebuild the app',
    'from scratch and do NOT create a new project). Keep everything that already works. After fixing,',
    'verify the app builds and the requested feature genuinely works (not just visually).',
    '',
    `Original request, for reference: ${userRequest.slice(0, 800)}`,
  ].join('\n');
}

/**
 * How a verdict should be RECORDED in the admin build report. Pure, so the wording is testable.
 *
 * Three outcomes, not two. `pass` answers "may this build proceed?"; it was never an answer to
 * "what did the judge find?", and reporting it as one is how "the reviewer could not run" came to be
 * filed as a passing review (autopsy 31dc61fd).
 *
 * ⚠️ THE DETAIL IS KEPT ON EVERY OUTCOME, including a genuine pass. The old line appended findings
 * only on failure, so the honest sentence the judge had written was discarded by the reader — the
 * exact shape of losing an explanation that already existed.
 */
export function describeJudgeVerdict(v: JudgeVerdict): {
  label: 'PASS' | 'FAIL' | 'NOT RUN';
  severity: 'info' | 'warning';
  detail: string;
} {
  const detail = (v.findings || []).slice(0, 3).join('; ');
  if (v.reviewed === false) {
    // A warning, not info: a judge that never runs is a gate that silently stopped existing, and a
    // misconfigured provider can make that permanent without a single failing build to reveal it.
    return { label: 'NOT RUN', severity: 'warning', detail };
  }
  return { label: v.pass ? 'PASS' : 'FAIL', severity: v.pass ? 'info' : 'warning', detail };
}

/**
 * The ADMIN-ONLY name of the engine that judged. Exhaustive by construction.
 *
 * 🔴 The inline ternary this replaces had no branch for `nemotron` and fell through to `'Sonnet'`, so
 * the report named an engine that had not run — and would have done so for every Nemotron judge from
 * the day that vendor was added. A record that quietly attributes work to the wrong provider is worse
 * than one that says "unknown", because nobody doubts it.
 *
 * ⚠️ Never reaches a user (White-Label Law) — this is the admin report's label only.
 */
export function judgeEngineLabel(kind: 'grok' | 'sonnet' | 'opus' | 'glm' | 'nemotron'): string {
  switch (kind) {
    case 'grok': return 'Grok';
    case 'glm': return 'GLM';
    case 'opus': return 'Opus';
    case 'nemotron': return 'Nemotron';
    case 'sonnet': return 'Sonnet';
    default: {
      // A new kind must be named here, at the point where somebody has to think about it — rather
      // than silently becoming whichever branch the old ternary ended on.
      const never: never = kind;
      return String(never);
    }
  }
}

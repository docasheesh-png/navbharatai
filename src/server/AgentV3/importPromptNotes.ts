// Import-turn prompt notes, extracted verbatim from routes/agentv3.ts (owner item 5: agentv3.ts is at the
// TypeScript control-flow-analysis size limit). Pure string builders; re-exported from routes/agentv3.ts so
// existing importers are unchanged. Behaviour-preserving move — no logic edits.

/**
 * Fix 41 (report 2026-07-08) — the instruction injected into the architect prompt when a GitHub-URL
 * import FAILED this turn. Without it the model, seeing an empty workspace and a "survey this repo"
 * ask, replied "I don't see a repository URL in your message — please share it" 15 seconds after the
 * platform itself said "I couldn't clone <url>". This makes the model ACKNOWLEDGE the exact URL and
 * the real reason (private/no-access/bad-url) and tell the user how to grant access — never re-ask
 * for the URL they already gave. Returns '' when no import failed. Pure.
 */
export function failedImportPromptNote(failed: { url: string; reason: string } | null | undefined): string {
  if (!failed || !failed.url) return '';
  return [
    'IMPORTANT — A GITHUB IMPORT WAS ALREADY ATTEMPTED AND FAILED THIS TURN.',
    `The user DID provide a repository URL: ${failed.url}`,
    `The import failed because ${failed.reason}.`,
    'Do NOT ask the user for the repository URL — they already gave it. Acknowledge that this exact',
    'URL could not be accessed, and if it is private tell them to connect the GitHub account that owns',
    'it via ⚙ → GitHub (or double-check the URL). Keep the reply short and do not contradict the',
    'message the platform already showed them. Do NOT clone the repository yourself into a temp',
    'directory and report success — those files would NOT persist into the workspace.',
  ].join('\n');
}

/**
 * INSTANT-CONNECT survey note (admin 2026-07-24). When the GitHub API tree + key files were fetched
 * up-front, give the architect the repo's real structure and key-file contents so it can survey the app
 * IMMEDIATELY — no waiting on the full download/land. Bounded so a huge repo never floods the prompt.
 * Returns '' when there is no instant-connect data. Pure.
 */
export function importSurveyPromptNote(
  survey: { url: string; fileCount: number; structure: string; keyFiles: Record<string, string>; truncated: boolean } | null | undefined,
): string {
  if (!survey || !survey.url) return '';
  const lines = [
    'IMPORTED PROJECT — you are connected to the user\'s GitHub repository and its files are being loaded into the workspace.',
    `Repository: ${survey.url}`,
    `It contains ${survey.fileCount} file(s)${survey.truncated ? ' (large repo — the listing below is partial)' : ''}. Top-level structure: ${survey.structure}.`,
  ];
  const keys = Object.keys(survey.keyFiles);
  if (keys.length > 0) {
    lines.push('', 'Key files (read directly from the repo, for your survey):');
    for (const k of keys) {
      lines.push(`\n----- ${k} -----\n${survey.keyFiles[k]}`);
    }
  }
  lines.push('', 'Use this to give an accurate survey of what the app is and how it is structured. Do not claim you cannot see the repository — you are connected to it.');
  return lines.join('\n');
}

/** The leading marker of the honesty-backstop prefix — used to avoid prepending it twice. */
export const IMPORT_HONESTY_PREFIX_MARK = '⚠️ The GitHub import did not complete';

/**
 * HONESTY BACKSTOP (mitrify autopsy 2026-07-23, rule 5). When a GitHub import FAILED this turn, the
 * user-facing summary must NOT read as an import success — even if the model's prose claims it cloned the
 * repo "successfully". (Real case: the model surveyed a `/tmp` clone that never landed, so the workspace was
 * empty while the summary said "ready for further work".) This prepends the platform's honest verdict so the
 * truth is the FIRST thing the user reads; the model's prose still follows but can no longer stand alone as a
 * false success. Returns '' when no import failed. Pure.
 */
export function importHonestySummaryPrefix(failed: { url: string; reason: string } | null | undefined): string {
  if (!failed || !failed.url) return '';
  return `${IMPORT_HONESTY_PREFIX_MARK} — ${failed.url} could not be imported (${failed.reason}). Your workspace does not contain that repository, so anything below is not a saved import.\n\n———\n`;
}

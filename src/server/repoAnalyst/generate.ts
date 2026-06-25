import { callGemini, callClaude, callGroq } from '../lib/aiCalls';
import { fetchPublicRepo, type RepoSnapshot } from './githubFetch';
import { buildRepoContext, findRepoRef, type AnalystTurn } from './analyst';

/**
 * GitHub Repo Analyst — "Improver" file generator.
 *
 * Given a public repo (fetched read-only) and what the user wants improved, the
 * model returns concrete, ORIGINAL files (tests, README, CI, .gitignore, fixes,
 * etc.) the user can drop into THEIR OWN fork — license-respecting (learn the
 * patterns, write original code), never pushing to repos the user doesn't own.
 * Self-contained: imports only the shared AI helpers + the public-repo fetcher.
 */

export interface GeneratedFile { path: string; content: string; }
export interface GenerateResult { summary: string; files: GeneratedFile[]; }

const FILE_OPEN = /^===\s*FILE:\s*(.+?)\s*===$/;
const FILE_CLOSE = /^===\s*END FILE\s*===$/;

/**
 * Parse the model's delimited output into files + a summary. The agreed format:
 *   ...optional summary text...
 *   === FILE: path/to/file ===
 *   <file content>
 *   === END FILE ===
 * Text outside file blocks becomes the summary. Pure & dependency-free (tested).
 */
export function parseGeneratedFiles(text: string): GenerateResult {
  const lines = (text || '').split('\n');
  const files: GeneratedFile[] = [];
  const summaryLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FILE_OPEN);
    if (open) {
      const path = sanitizePath(open[1]);
      const body: string[] = [];
      i++;
      while (i < lines.length && !FILE_CLOSE.test(lines[i])) { body.push(lines[i]); i++; }
      if (i < lines.length) i++; // skip the END FILE line
      let content = body.join('\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
      content = stripCodeFence(content);
      if (path && content.trim()) files.push({ path, content });
    } else {
      if (lines[i].trim()) summaryLines.push(lines[i]);
      i++;
    }
  }
  return { summary: summaryLines.join('\n').trim(), files };
}

/** Keep paths safe & relative — no absolute paths or traversal. */
function sanitizePath(p: string): string {
  let s = p.trim().replace(/^["'`]|["'`]$/g, '');
  s = s.replace(/^[/\\]+/, '');
  s = s.split(/[\\/]+/).filter((seg) => seg && seg !== '.' && seg !== '..').join('/');
  return s.slice(0, 200);
}

/** If the whole content is wrapped in a single ```lang fence, unwrap it. */
function stripCodeFence(content: string): string {
  const m = content.match(/^```[a-zA-Z0-9._-]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] + '\n' : content;
}

const GEN_PERSONA = `You are the "Improver" mode of GitHub Repo Analyst inside NavBharatAI. Based on the REAL repository content provided, you generate concrete, high-quality, ORIGINAL files the user can add to THEIR OWN fork to fix gaps and improve the project (e.g. missing tests, README, CI workflow, .gitignore, error handling, type configs, docs).

RULES (non-negotiable):
- Generate ORIGINAL files written by you, tailored to this repo's real stack/structure — do NOT reproduce substantial copyrighted source from the repo or elsewhere. Respect the repo's LICENSE (note attribution/compliance where relevant). General info, not legal advice.
- Base everything on the actual fetched content; if you must assume something not visible, say so in the summary. Don't invent the repo's existing code.
- Output FORMAT — follow EXACTLY so it can be parsed:
  First, a short plain-text summary of what you're providing and why (2–6 lines).
  Then, for EACH file, a block delimited precisely as:
=== FILE: relative/path/here ===
<the full file content>
=== END FILE ===
  Use relative paths only (no leading slash, no .. ). Put real, complete, working content in each file (not placeholders). Keep to the few highest-impact files (typically 1–5).
- These are suggestions for the user's own fork; you cannot and do not push to any repository.`;

async function resilientCall(systemPrompt: string, prompt: string): Promise<string> {
  try { const t = await callGemini(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callClaude(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callGroq(`${systemPrompt}\n\n${prompt}`, undefined, []); if (t && t.trim()) return t; } catch { /* fall through */ }
  throw new Error('All AI providers are busy right now. Please try again in a moment.');
}

/**
 * Generate improvement files for a public repo referenced in the message/history.
 * `instruction` is what the user wants (e.g. "add tests and a CI workflow"); if
 * empty, the model picks the highest-impact gaps to fill.
 */
export async function runRepoImprovementGen(
  message: string,
  history: AnalystTurn[] = [],
  token?: string,
): Promise<GenerateResult> {
  const ref = findRepoRef(message, history);
  if (!ref) {
    return { summary: 'Please analyse a public GitHub repository first (paste its URL), then I can generate improvement files for it.', files: [] };
  }

  let snapshot: RepoSnapshot;
  try {
    snapshot = await fetchPublicRepo(ref, token);
  } catch (err: any) {
    return { summary: `⚠️ ${err?.message || `Could not fetch ${ref.owner}/${ref.repo}.`}`, files: [] };
  }

  const context = buildRepoContext(snapshot);
  const wanted = message && message.trim() ? message.trim() : 'Fill the highest-impact gaps you identified (e.g. missing tests, README, CI, .gitignore, error handling).';
  const system = GEN_PERSONA;
  const prompt = [
    'Generate improvement files for this REAL repository (fetched live from GitHub):',
    '',
    context,
    '',
    `What to generate: ${wanted}`,
    '',
    'Remember the exact === FILE: path === / === END FILE === format, original content only, relative paths, highest-impact files only.',
  ].join('\n');

  const raw = await resilientCall(system, prompt);
  const result = parseGeneratedFiles(raw);
  if (!result.files.length && !result.summary) {
    result.summary = 'The model did not return any files in the expected format. Please try again, or ask for a specific file (e.g. "generate a CI workflow").';
  }
  return result;
}

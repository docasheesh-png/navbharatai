import { callGemini, callClaude, callGroq } from '../lib/aiCalls';
import { parseRepoRef, fetchPublicRepo, type RepoSnapshot } from './githubFetch';

/**
 * GitHub Repo Analyst & Improver — engine.
 *
 * Reads a PUBLIC repo for real (read-only) and analyses the ACTUAL fetched
 * content — it never invents a repo's contents. Self-contained: imports only
 * the shared AI helpers and the public-repo fetcher (nothing from Engineer AI
 * or the AgentV3 engine).
 */

export interface AnalystTurn { role: 'user' | 'assistant'; content: string; }

const PERSONA = `You are GitHub Repo Analyst & Improver inside NavBharatAI — an expert software engineer who analyses PUBLIC GitHub repositories and gives honest, practical, actionable feedback and improvement plans. You work ONLY from the real repository content provided to you below; you never invent files, code, or facts about the repo.

WHAT YOU DO:
- Give a clear OVERVIEW: what the project is/does, its tech stack, and maturity.
- Identify STRENGTHS (good patterns worth learning from) and GAPS/WEAKNESSES (missing tests, docs, CI, error handling, security concerns, structure issues, etc.).
- Flag obvious QUALITY & SECURITY issues you can see in the provided files (e.g. secrets committed, no input validation, no error handling, missing .gitignore) — clearly noting these are observations from a partial view.
- Give a PRIORITISED, concrete IMPROVEMENT PLAN with specific, actionable steps and short illustrative code snippets the user could adopt in THEIR OWN project/fork.

HOW YOU "COPY GOOD THINGS" (license-respecting, non-negotiable):
- You help users LEARN good patterns/ideas and ADAPT them into their own original code — you do NOT facilitate copying substantial copyrighted source code verbatim to relabel as one's own.
- Always note the repo's LICENSE and what it generally permits/requires (e.g. MIT/Apache allow reuse WITH attribution & license terms; GPL is copyleft; "no license" means default copyright — reuse not granted). Tell users to read and comply with the actual license, and that you are not giving legal advice.
- Frame reuse as: understand the approach, then write your own implementation and attribute/comply as the license requires.

HONESTY (non-negotiable):
- Base every claim on the provided content. If something wasn't fetched (truncated tree/files, no README), SAY you can't see it rather than guessing. Don't fabricate metrics, vulnerabilities, or features.
- You analyse and ADVISE; you cannot push changes to repositories you don't own (no write access). "Improve" means the plan, guidance and code snippets you give the user to apply themselves (or in their fork). For building it out, suggest the user use NavBharatAI's Engineer AI.
- Be specific and useful, not generic. Prioritise high-impact, realistic improvements.`;

const DISCLAIMER = `Note: this analysis is based only on the public repository data fetched (which may be partial/truncated) — verify against the full source. License/legal points are general information, not legal advice: read and comply with the repo's actual LICENSE before reusing any code, and attribute as required. The analyst reads public repos read-only and cannot modify repositories you don't own.`;

/** Build the grounding block describing the real fetched repo. Pure & testable. */
export function buildRepoContext(s: RepoSnapshot): string {
  const lines: string[] = [];
  lines.push(`REPOSITORY: ${s.ref.owner}/${s.ref.repo}  (${s.url})`);
  if (s.description) lines.push(`Description: ${s.description}`);
  lines.push(`Default branch: ${s.defaultBranch} | Stars: ${s.stars} | Forks: ${s.forks} | Open issues: ${s.openIssues}${s.archived ? ' | ARCHIVED' : ''}`);
  lines.push(`License: ${s.license || 'NONE detected (default copyright — reuse not granted unless the owner permits)'}`);
  lines.push(`Primary language: ${s.primaryLanguage || 'unknown'} | Languages: ${s.languages.join(', ') || 'unknown'}`);
  if (s.topics.length) lines.push(`Topics: ${s.topics.join(', ')}`);
  if (s.pushedAt) lines.push(`Last pushed: ${s.pushedAt}`);

  if (s.tree.length) {
    lines.push('', `FILE TREE (${s.tree.length} files${s.treeTruncated ? ', TRUNCATED' : ''}):`);
    lines.push(s.tree.join('\n'));
  } else {
    lines.push('', 'FILE TREE: (could not be read)');
  }

  if (s.readme) {
    lines.push('', 'README (excerpt):', s.readme);
  } else {
    lines.push('', 'README: (none found)');
  }

  if (s.keyFiles.length) {
    lines.push('', 'KEY FILES:');
    for (const f of s.keyFiles) {
      lines.push(`--- ${f.path}${f.truncated ? ' (truncated)' : ''} ---`);
      lines.push(f.content);
    }
  }

  if (s.notes.length) lines.push('', `FETCH NOTES: ${s.notes.join(' ')}`);
  return lines.join('\n');
}

async function resilientCall(systemPrompt: string, prompt: string): Promise<string> {
  try { const t = await callGemini(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callClaude(prompt, undefined, [], systemPrompt); if (t && t.trim()) return t; } catch { /* fall through */ }
  try { const t = await callGroq(`${systemPrompt}\n\n${prompt}`, undefined, []); if (t && t.trim()) return t; } catch { /* fall through */ }
  throw new Error('All AI providers are busy right now. Please try again in a moment.');
}

/** Find the most recent repo reference in the current message or recent history. */
export function findRepoRef(message: string, history: AnalystTurn[]) {
  const fromMsg = parseRepoRef(message);
  if (fromMsg) return fromMsg;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      const r = parseRepoRef(history[i].content);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Run one Repo Analyst turn. If a public GitHub repo is referenced (now or
 * earlier in the chat), fetch it for real and analyse the actual content;
 * otherwise guide the user to share a repo URL. `token` is optional (only to
 * raise GitHub rate limits / read accessible repos).
 */
export async function runRepoAnalystChat(
  message: string,
  history: AnalystTurn[] = [],
  token?: string,
): Promise<string> {
  const ref = findRepoRef(message, history);

  if (!ref) {
    // No repo yet — answer generally but steer to a repo URL.
    const system = `${PERSONA}\n\n${DISCLAIMER}`;
    const prompt = `The user hasn't given a GitHub repository to analyse yet. Their message: "${message}".\nIf they're asking how this works or a general question, answer briefly and helpfully, then ask them to paste a PUBLIC GitHub repo URL (or owner/repo) so you can fetch and analyse it for real.`;
    return resilientCall(system, prompt);
  }

  let snapshot: RepoSnapshot;
  try {
    snapshot = await fetchPublicRepo(ref, token);
  } catch (err: any) {
    // Surface the friendly fetch error directly to the user.
    return `⚠️ ${err?.message || `Could not fetch ${ref.owner}/${ref.repo}.`}`;
  }

  const context = buildRepoContext(snapshot);
  const transcript = (history || [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Analyst'}: ${m.content}`)
    .join('\n');

  const system = `${PERSONA}\n\n${DISCLAIMER}`;
  const prompt = [
    'You are analysing this REAL repository (content fetched live from GitHub):',
    '',
    context,
    '',
    transcript ? `Conversation so far:\n${transcript}\n` : '',
    `User's request: ${message}`,
    '',
    'Respond grounded ONLY in the repo content above. If the user asked a specific question, answer it; otherwise give a structured analysis: Overview, Tech stack, Strengths, Gaps/Weaknesses, Security/Quality flags (note these are from a partial view), License & reuse note, and a Prioritised improvement plan with short, adoptable code snippets. Be specific and honest about what you could and could not see.',
  ].join('\n');

  return resilientCall(system, prompt);
}

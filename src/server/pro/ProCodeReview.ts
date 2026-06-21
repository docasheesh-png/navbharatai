/**
 * Phase 95+97 — Pro Code Review: OWASP Security + Quality + Tech Debt.
 *
 * Makes ONE focused AI call to review the entire workspace for:
 *   - Security: injection, XSS, hardcoded credentials, CSRF, insecure dependencies
 *   - Quality: unused vars, dead code, duplicate logic, long functions
 *   - Performance: N+1 queries, unoptimized loops, unnecessary re-renders
 *   - Tech Debt (Phase 97): TODO/FIXME comments, deprecated APIs, untyped `any`
 *
 * Returns structured findings with file:line:severity:description:fix so the
 * Pro chat can show actionable inline comments rather than a wall of text.
 */

import type { VirtualFileSystem } from '../project/ProjectModel';
import type { ModelCall } from '../project/aiEdits';

export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewFinding {
  file: string;
  line?: number;
  severity: ReviewSeverity;
  category: 'security' | 'quality' | 'performance' | 'tech_debt' | 'accessibility';
  description: string;
  fix: string;
}

export interface CodeReviewResult {
  findings: ReviewFinding[];
  summary: string;
  score: number; // 0-100: 100 = perfect, 0 = critical issues
  techDebt: string[]; // TODO/FIXME comments found
}

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer specializing in security (OWASP Top 10), code quality, and tech debt.
Analyze the provided source files and return a JSON object (no markdown fences):
{
  "findings": [
    { "file": "src/...", "line": 42, "severity": "critical|high|medium|low|info", "category": "security|quality|performance|tech_debt|accessibility", "description": "...", "fix": "..." }
  ],
  "summary": "1-2 sentence summary of the overall code health",
  "score": 0-100,
  "techDebt": ["TODO: ...", "FIXME: ..."]
}

Review checklist:
SECURITY: SQL/NoSQL injection, XSS (innerHTML with user data), hardcoded API keys/passwords, insecure JWT handling, missing input validation, CSRF
QUALITY: unused imports/variables, dead code, functions >50 lines, deep nesting (>4 levels), duplicate code blocks
PERFORMANCE: synchronous file I/O in async context, N+1 query patterns, missing React.memo/useMemo/useCallback, large bundle imports
TECH DEBT: TODO/FIXME comments, deprecated APIs (moment.js, class components), TypeScript \`any\` types, missing error handling
ACCESSIBILITY: missing alt attributes, missing ARIA labels, non-semantic HTML for interactive elements`;

/**
 * Review source files in a VFS for security, quality, performance, and tech debt.
 * Returns structured findings with actionable fix suggestions.
 */
export async function reviewCode(
  vfs: VirtualFileSystem,
  callModel: ModelCall,
): Promise<CodeReviewResult> {
  const files = vfs.paths().filter((p) =>
    /\.(ts|tsx|js|jsx|py|go|rs|java|php|rb)$/.test(p) &&
    !/node_modules|\.min\.|dist\//.test(p),
  ).slice(0, 20); // Review up to 20 files to stay within token limits

  if (!files.length) {
    return { findings: [], summary: 'No source files found.', score: 100, techDebt: [] };
  }

  const fileContents = files.map((f) => {
    const content = vfs.readText(f) || '';
    return `=== ${f} ===\n${content.slice(0, 3000)}`; // 3k chars per file
  }).join('\n\n');

  const prompt = `Review these source files:\n\n${fileContents.slice(0, 60_000)}`;

  try {
    const raw = await callModel(REVIEW_SYSTEM_PROMPT, prompt);
    // Parse JSON — strip any accidental markdown fences
    const cleaned = raw.replace(/^```[^\n]*\n?|```$/gm, '').trim();
    const result = JSON.parse(cleaned) as CodeReviewResult;
    return {
      findings: Array.isArray(result.findings) ? result.findings : [],
      summary: typeof result.summary === 'string' ? result.summary : 'Review complete.',
      score: typeof result.score === 'number' ? Math.max(0, Math.min(100, result.score)) : 50,
      techDebt: Array.isArray(result.techDebt) ? result.techDebt : [],
    };
  } catch {
    // If JSON parse fails, return a minimal result so the caller doesn't crash
    return {
      findings: [],
      summary: 'Code review complete (structured output unavailable).',
      score: 70,
      techDebt: [],
    };
  }
}

/**
 * Format a CodeReviewResult as a Markdown report for display in Pro chat.
 */
export function formatReviewReport(result: CodeReviewResult): string {
  const icon: Record<ReviewSeverity, string> = {
    critical: '🔴', high: '🟠', medium: '🟡', low: '🟢', info: 'ℹ️',
  };

  const lines: string[] = [
    `## Code Review Report`,
    `**Quality Score:** ${result.score}/100`,
    `**Summary:** ${result.summary}`,
    '',
  ];

  if (result.findings.length === 0) {
    lines.push('✅ No significant issues found.');
  } else {
    const bySeverity = (['critical', 'high', 'medium', 'low', 'info'] as ReviewSeverity[])
      .map((sev) => ({ sev, items: result.findings.filter((f) => f.severity === sev) }))
      .filter(({ items }) => items.length > 0);

    for (const { sev, items } of bySeverity) {
      lines.push(`### ${icon[sev]} ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${items.length})`);
      for (const f of items) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        lines.push(`- **${loc}** — ${f.description}`);
        lines.push(`  *Fix:* ${f.fix}`);
      }
      lines.push('');
    }
  }

  if (result.techDebt.length > 0) {
    lines.push(`### 📋 Tech Debt (${result.techDebt.length} items)`);
    result.techDebt.slice(0, 10).forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }

  return lines.join('\n');
}

import { Pattern } from './PatternTypes';

/**
 * P-PME.10 — Architecture Decision Record (ADR) auto-capture.
 *
 * Every build implicitly chooses an architecture (pattern + stack) but never recorded WHY. This turns
 * the pattern-selection result into a standard ADR markdown file (title, chosen pattern + stack,
 * alternatives considered with their scores, the reason, date) to drop into the generated workspace
 * under `docs/decisions/ADR-NNN.md`. Pure + dependency-free + unit-tested.
 */

export interface RankedPattern {
  pattern: Pattern;
  score: number;
  matchedConstraints?: string[];
  rejectedConstraints?: string[];
}

export interface ADRInput {
  /** Sequence number (1-based) → ADR-001, ADR-002, … */
  number: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Ranked patterns, highest score first; [0] is the chosen one. */
  ranked: RankedPattern[];
}

export interface ADRFile { path: string; content: string }

/** Zero-pad an ADR number to 3 digits (ADR-001). */
export function adrId(n: number): string {
  return `ADR-${String(Math.max(1, Math.floor(n))).padStart(3, '0')}`;
}

function stackLine(p: Pattern): string {
  const s = p.defaultStack;
  const parts = [
    `frontend: ${s.frontend}`, `backend: ${s.backend}`, `database: ${s.database}`,
    s.orm ? `orm: ${s.orm}` : '', `auth: ${s.auth}`, s.realtime ? `realtime: ${s.realtime}` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

/** Render an ADR markdown document from the ranked pattern selection. Pure. */
export function generateADR(input: ADRInput): ADRFile {
  const { number, date, ranked } = input;
  if (!ranked || ranked.length === 0) {
    throw new Error('generateADR requires at least one ranked pattern.');
  }
  const id = adrId(number);
  const chosen = ranked[0];
  const alternatives = ranked.slice(1);

  const lines: string[] = [];
  lines.push(`# ${id}: Adopt the "${chosen.pattern.id}" architecture`);
  lines.push('');
  lines.push(`- **Status:** Accepted`);
  lines.push(`- **Date:** ${date}`);
  lines.push('');
  lines.push('## Context');
  lines.push(chosen.pattern.description || 'An architecture pattern was selected for this build.');
  lines.push('');
  lines.push('## Decision');
  lines.push(`Use **${chosen.pattern.id}** (score ${chosen.score}).`);
  lines.push('');
  lines.push(`Stack: ${stackLine(chosen.pattern)}.`);
  if (chosen.matchedConstraints && chosen.matchedConstraints.length) {
    lines.push('');
    lines.push(`Satisfies: ${chosen.matchedConstraints.join(', ')}.`);
  }
  lines.push('');
  lines.push('## Alternatives considered');
  if (alternatives.length === 0) {
    lines.push('- _None — only one pattern matched the requirements._');
  } else {
    for (const alt of alternatives) {
      lines.push(`- **${alt.pattern.id}** (score ${alt.score}) — not chosen (lower score).`);
    }
  }
  lines.push('');
  lines.push('## Consequences');
  lines.push(`The project is built on the ${chosen.pattern.id} stack above. Revisit this ADR if the requirements change materially.`);
  lines.push('');

  return { path: `docs/decisions/${id}.md`, content: lines.join('\n') };
}

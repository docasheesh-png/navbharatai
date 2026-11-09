import { SINGLE_HTML_FILE_SIGNAL } from './frameworkDetect';

/** Precision-first positive directive, not a quoted/negated ban on a one-file architecture. */
export function requiresSingleHtml(text: string): boolean {
  const source = String(text ?? '');
  for (const match of source.matchAll(new RegExp(SINGLE_HTML_FILE_SIGNAL.source, 'gi'))) {
    const prefix = source.slice(Math.max(0, (match.index ?? 0) - 100), match.index);
    const clause = prefix.split(/[.!?;:\n]/).pop() ?? '';
    if (!/\b(?:do\s+not|don['’]?t|never|not|no|avoid|without)\b[^,]{0,70}$/i.test(clause)) return true;
  }
  return false;
}

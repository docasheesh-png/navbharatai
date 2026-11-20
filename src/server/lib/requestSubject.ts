/**
 * The request's SUBJECT: what the app IS, read from the first line and cut where the feature list starts. Moved out
 * of `appScopeAnalyzer.ts` unchanged (failedbr #2090) so `RequirementGapAnalyzer.ts`, which that module imports, can
 * read the same subject without an import cycle or a second copy. PURE.
 */
import { withoutMachineText } from './machineText';

/**
 * WHAT THE APP IS, not every word in the request (Q-398, autopsy Sur Taal; admin accepted). The hint
 * matched a small word ANYWHERE, so a nine-screen music player was "single-purpose" because one of its
 * features is a Sleep Timer — and a social network with a countdown timer would be too. The subject is
 * the first line of the request, cut at the first word that starts the feature list ("with", "—", ":",
 * "jisme", "के साथ"…). A small word there names the app; a small word after it names a feature. PURE.
 */
const FEATURE_LIST_START = /\s(?:with|having|including|featuring|that|which|where|jisme|jismein|jisme?n|jinme|wala|wali)\s|\s*[—–:;(]\s*|\s-\s|,|\s(?:के\s+साथ|जिसमें|जिसमे|जहाँ|जहां)\s/i;
export function requestSubject(raw: string): string {
  const text = withoutMachineText(String(raw ?? ''), { drop: true });
  const first = text.split('\n').map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? '';
  const cut = first.search(FEATURE_LIST_START);
  return (cut > 0 ? first.slice(0, cut) : first).trim();
}


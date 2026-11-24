// Whether the ten representative games may be called certified.
// A rules pass is not a browser pass. Anything not executed stays unverified. PURE.

export type RepresentativeId =
  | '2d-platformer' | '2d-shooter' | '3d-racing' | '3d-shooter' | 'open-world'
  | 'chess' | 'ludo' | 'puzzle' | 'fighting' | 'physics-sim';

export const REPRESENTATIVE_GAMES: readonly RepresentativeId[] = [
  '2d-platformer', '2d-shooter', '3d-racing', '3d-shooter', 'open-world',
  'chess', 'ludo', 'puzzle', 'fighting', 'physics-sim',
];

export interface RuleResult {
  id: RepresentativeId;
  status: 'passed' | 'failed' | 'not-verified';
  /** What was actually run. Empty is not allowed for a pass. */
  evidence: string;
}

export interface RepresentativeVerdict {
  passed: RepresentativeId[];
  failed: RepresentativeId[];
  unverified: RepresentativeId[];
  /** True only when all ten were executed and passed. Browser coverage is a separate evidence string. */
  rulesCertified: boolean;
}

export function judgeRepresentative(results: readonly RuleResult[]): RepresentativeVerdict {
  const byId = new Map(results.map((r) => [r.id, r]));
  const passed: RepresentativeId[] = [];
  const failed: RepresentativeId[] = [];
  const unverified: RepresentativeId[] = [];
  for (const id of REPRESENTATIVE_GAMES) {
    const row = byId.get(id);
    if (!row || row.status === 'not-verified' || !row.evidence.trim()) unverified.push(id);
    else if (row.status === 'passed') passed.push(id);
    else failed.push(id);
  }
  return { passed, failed, unverified, rulesCertified: passed.length === REPRESENTATIVE_GAMES.length && failed.length === 0 && unverified.length === 0 };
}

/**
 * Decide whether Doctor AI's second-opinion safety cross-check ("audit") reply is a CLEAN pass that
 * carries no warning and should be dropped (return null), vs. a real danger note that must be surfaced.
 *
 * The audit prompt asks the model to answer exactly "OK" when the primary reply is safe. The bug this
 * fixes: a `/^ok\b/i` prefix test also matched a genuine warning that merely STARTS with "OK", e.g.
 * "OK, but the paracetamol dose 100 mg/kg is a 10x overdose — reduce to 15 mg/kg." — silently dropping
 * an overdose warning. Only an EXACT OK / OK. / OK! (trimmed, case-insensitive) — or an empty reply
 * (nothing to show) — counts as clean; anything else is a note that must reach the doctor.
 */
export function isAuditReplyClean(text: string): boolean {
  const t = (text || '').trim();
  return t === '' || /^ok[.!]?$/i.test(t);
}

// AgentV3 — A REPAIR PASS THAT CHANGED NOTHING DOES NOT GET TO SAY IT CHANGED SOMETHING (autopsy 6cd698cc,
// 2026-10-01).
//
// The end-of-build stylesheet repair was handed 29 class names with no style rule. It read the stylesheet,
// grepped it, read four screens, and wrote nothing. Its last turn said: "I added the missing CSS rules so the
// chat interface styles match the class names used in the components. The stylesheet now defines every one of
// the 29 previously unmatched classes…". Every turn's text is shown to the user as it is written, so the user
// read that sentence; eleven seconds later the platform's own count said all 29 were still undefined, in an
// admin-only line the user never sees.
//
// THE CLASS: the build's SUMMARY has a claim audit (`auditSummaryClaims`) and a sub-agent's task result carries
// the files it really wrote beside its claim (`taskResultWithWrites`). A repair pass's closing text had neither:
// it reached the user unchecked. The fact that settles it is free and exact — did this run write anything? —
// so a final turn of a platform repair that claims a change while the run changed nothing is withheld, and the
// user is told plainly that nothing changed. PURE.

/** "I added / fixed / updated …", "the stylesheet now defines …" — a sentence that says the app was changed. */
const CLAIMED_CHANGE = new RegExp(
  [
    String.raw`\b(?:I|we)(?:'ve|\s+have)?\s+(?:now\s+|also\s+|just\s+|successfully\s+)?(?:added|fixed|updated|wrote|written|created|defined|changed|replaced|rewrote|rewritten|restyled|repaired|appended|implemented|corrected|removed|renamed|moved|wired|connected|styled|resolved|made)\b`,
    String.raw`\b(?:now\s+(?:defines|has|includes|works|renders|uses))\b`,
    String.raw`\b(?:has|have)\s+been\s+(?:added|fixed|updated|replaced|corrected|resolved|implemented|defined)\b`,
    String.raw`\b(?:fixed|added|updated|resolved)\s*[:—-]`,
  ].join('|'),
  'i',
);

/** Does this reply say that something in the app was changed? PURE. */
export function claimsAChange(text: string): boolean {
  return CLAIMED_CHANGE.test(String(text ?? ''));
}

export interface RepairClaimInput {
  /** The run is one of OUR repair passes (`platformRequest`), not the user's own request. */
  platformRequest: boolean;
  /** This turn called no tool — it is the run's closing answer. */
  finalTurn: boolean;
  /** Changes this RUN made (its own writes plus delegations that wrote). */
  changesThisRun: number;
  text: string;
}

/** Withhold this turn's text from the user: a repair's closing claim of a change that never happened. PURE. */
export function repairClaimWithoutChange(i: RepairClaimInput): boolean {
  return i.platformRequest && i.finalTurn && i.changesThisRun === 0 && claimsAChange(i.text);
}

/** What the user is shown in its place. */
export const NO_CHANGE_LINE = 'No change was made in that step.';

/** The admin line (`REPAIR_CLAIM_WITHHELD`). PURE. */
export function repairClaimNote(text: string): string {
  const said = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return `A repair pass wrote no file but its closing reply claimed a change; the reply was withheld from the user and "${NO_CHANGE_LINE}" shown instead. It said: "${said}"`;
}

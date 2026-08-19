// DOCTOR AI — TREATMENT-GRADE REPORT CROSS-CHECK (admin 2026-08-18: "har chhoti bariki dhyan se dekh
// kar reply kare — doctor isi report se patient ko treatment start kar sakta hai").
//
// Doctor AI already runs an independent second-AI safety audit on actionable advice — but that audit
// reads TEXT only, so when the turn analysed an ECG/X-ray/USG it was checking a reading it could not
// see. These pure builders extend the audit so the second AI receives the SAME report image/PDF and
// re-reads it: wrong quoted values, a missed obvious abnormality, or a misread lead/region get caught
// by a second pair of eyes before the doctor acts on the reply.
//
// PURE (no network) so the prompt contract and the multimodal shape are unit-testable. Fail-open
// behaviour (an audit error never blocks the reply) stays where it was, in the route.

export interface AuditReportFile {
  fileData: string; // base64
  fileType: string;
  fileName: string;
}

/**
 * The audit instruction. With a report attached, the auditor is explicitly told to RE-READ the report
 * itself and verify the reply against it — not merely sanity-check the prose.
 */
export function buildAuditPrompt(caseContext: string, reply: string, hasReport: boolean): string {
  return `You are a senior physician performing a SAFETY AUDIT of another AI assistant's reply to a doctor. Review ONLY for genuinely dangerous problems:
- wrong or unsafe drug dose / frequency / route
- a missed contraindication (allergy, pregnancy/breastfeeding, renal/hepatic, age/weight)
- a missed red flag / emergency needing urgent action
- a factually dangerous or clearly incorrect clinical statement${hasReport ? `
- REPORT CROSS-CHECK (a medical report is attached): re-read the attached report YOURSELF and verify the reply against it — a value quoted differently from what the report actually shows, an obvious abnormality on the report the reply missed, or a misread lead/region/measurement. The doctor may start treatment from this reading, so check it against the report itself, not just for internal consistency.` : ''}

CASE CONTEXT:
${caseContext}

AI REPLY TO AUDIT:
${reply}

If you find NO safety issue, output EXACTLY: OK
Otherwise output up to 3 short bullet points, each naming the issue and the correction. Do NOT rewrite the whole reply. Be terse.`;
}

/**
 * The multimodal contents for the audit call — the report file first (so the auditor sees it), then
 * the instruction. Without a file it is the plain text shape the audit always used.
 */
export function buildAuditContents(
  prompt: string,
  file?: AuditReportFile | null,
): Array<{ role: 'user'; parts: Array<Record<string, unknown>> }> {
  const parts: Array<Record<string, unknown>> = [];
  if (file?.fileData && file.fileType) {
    parts.push({ inlineData: { mimeType: file.fileType, data: file.fileData } });
  }
  parts.push({ text: prompt });
  return [{ role: 'user', parts }];
}

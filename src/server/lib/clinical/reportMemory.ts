// DOCTOR AI — REPORT MEMORY (admin 2026-08-18).
//
// THE REPORTED FAILURE, from a real Doctor AI transcript: the doctor sent an ECG image and got a full
// first-pass analysis (vision worked), then asked "ecg me lead V2 dekh ke batao kya yeh theek hai" —
// and Doctor AI answered "main yahan par asli ECG image dekh nahi sakta". ROOT CAUSE: the attachment
// (`fileData`) travels only in the turn it was sent; the server-side session history stores TEXT only,
// so every follow-up about the report reached the model with no image at all. The model's honesty was
// correct — the pipeline had genuinely dropped the image.
//
// THE FIX CLASS: remember the session's recently-sent report files (image/PDF) server-side, and when a
// LATER turn has no new file but plainly asks about the report, RE-ATTACH the stored file to that
// turn's model call — so "look at lead V2" actually puts the ECG in front of the vision model again,
// with the doctor's specific question beside it.
//
// Deliberate cost bias: a false-positive match merely re-sends an image the cheap vision tier reads for
// a fraction of a paisa; a false NEGATIVE reproduces the reported failure. So the matcher is generous.
//
// PURE (injected clock, no I/O) so every rule here is unit-testable.

/** A report file the doctor sent — kept exactly as the route received it. */
export interface StoredReportFile {
  fileData: string; // base64
  fileType: string;
  fileName: string;
}

interface StoredEntry extends StoredReportFile {
  ts: number;
}

/** Only image/PDF attachments are report files needing re-attachment — document types (Word/Excel/
 *  text) are extracted to TEXT at upload time and that text already persists in the chat history. */
export function isVisionReportType(fileType: string): boolean {
  const t = String(fileType || '').toLowerCase();
  return t.startsWith('image/') || t === 'application/pdf';
}

/**
 * Does this follow-up message ask about the attached report?
 *
 * Generous by design (see the cost bias above): report/modality names (English + the Hinglish forms a
 * real Indian doctor types), ECG leads and waveform terms, imaging anatomy words, and "look at / check"
 * verbs in both languages. Matched against the doctor's own words only.
 */
export function referencesAttachedReport(message: string): boolean {
  const m = ` ${String(message || '').toLowerCase()} `;
  if (!m.trim()) return false;
  const patterns: RegExp[] = [
    // The report/modality itself, by name.
    /\b(ecg|ekg|x-?ray|xray|usg|ultrasound|sonography|scan|report|film|image|photo|picture|cxr|mri|\bct\b|echo|doppler|opg|mammo|angio)\b/,
    // ECG specifics: leads, waves, segments, intervals, axis.
    /\b(lead\s*(i{1,3}|avr|avl|avf|v\s*[1-6])|v\s*[1-6]|p\s*wave|q\s*wave|r\s*wave|s\s*wave|t\s*wave|qrs|st\s*(segment|elevation|depression)|pr\s*interval|qt[c]?|axis|rhythm|rbbb|lbbb|bundle)\b/,
    // Imaging specifics: zones/regions a doctor would point at.
    /\b(opacity|shadow|lesion|fracture|effusion|consolidation|cardiomegaly|infiltrate|nodule|mass|cavity|costophrenic|hilar|apex|apical|zone|liver|kidney|gall\s*bladder|cyst|calcul)\b/,
    // Hinglish ask-verbs aimed at the report ("isme kya hai", "dekho", "batao is report me").
    /\b(dekh|dekho|dekhkar|dekhke|isme|is\s*(report|image|ecg|xray|x-ray|film|scan))\b/,
  ];
  return patterns.some((re) => re.test(m));
}

/**
 * Is the doctor asking to COMPARE this report with an earlier one?
 *
 * Clinically this is the question that changes management — "is this RBBB new or was it already there?"
 * — so when it is asked, the earlier report of the session travels to the model alongside the new one.
 */
export function asksForComparison(message: string): boolean {
  const m = ` ${String(message || '').toLowerCase()} `;
  if (!m.trim()) return false;
  // Hinglish stems are prefix-matched (no trailing \b): a doctor writes "pichhla", "purani", "pehle
  // wala" — a word boundary after the stem would reject every one of those inflections.
  return /\b(compare|comparison|comparative|versus|vs|previous|prior|earlier|old|older|last (one|report|ecg|film|scan)|serial|interval change|new change|tulna)\b/.test(m)
    || /\b(puran\w*|pichhl\w*|pichl\w*|pehle wal\w*|purane wal\w*)/.test(m);
}

/** How long a session's report files stay re-attachable. Matches the clinical store's own 24h TTL. */
const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
/** Most-recent files kept per session — a case discussion rarely juggles more at once. */
const MAX_FILES_PER_SESSION = 3;

/**
 * The per-session report file store. In-memory with a TTL, exactly like the SDA clinical store beside
 * it — a report is session-scoped working material, not a patient record, and it must expire with the
 * session rather than accumulate.
 */
export class SessionReportStore {
  private files = new Map<string, StoredEntry[]>();

  remember(sessionId: string, file: StoredReportFile, now: number): void {
    if (!sessionId || !file?.fileData || !isVisionReportType(file.fileType)) return;
    const list = this.files.get(sessionId) || [];
    list.push({ fileData: file.fileData, fileType: file.fileType, fileName: file.fileName || 'report', ts: now });
    while (list.length > MAX_FILES_PER_SESSION) list.shift();
    this.files.set(sessionId, list);
  }

  /** The most recently sent, still-fresh report file for this session — or null. */
  latest(sessionId: string, now: number): StoredReportFile | null {
    const list = this.files.get(sessionId);
    if (!list?.length) return null;
    const fresh = list[list.length - 1];
    if (now - fresh.ts > REPORT_TTL_MS) {
      this.files.delete(sessionId);
      return null;
    }
    return { fileData: fresh.fileData, fileType: fresh.fileType, fileName: fresh.fileName };
  }

  /**
   * Every still-fresh report of this session, oldest first — what a COMPARISON needs ("purane ECG se
   * compare karo"): the earlier film and the new one go to the model together.
   */
  all(sessionId: string, now: number): StoredReportFile[] {
    const list = this.files.get(sessionId);
    if (!list?.length) return [];
    const fresh = list.filter((f) => now - f.ts <= REPORT_TTL_MS);
    if (!fresh.length) {
      this.files.delete(sessionId);
      return [];
    }
    return fresh.map((f) => ({ fileData: f.fileData, fileType: f.fileType, fileName: f.fileName }));
  }

  /** Drop every session whose newest file has expired. Called from the route's existing sweep timer. */
  sweep(now: number): void {
    for (const [id, list] of this.files.entries()) {
      const newest = list[list.length - 1];
      if (!newest || now - newest.ts > REPORT_TTL_MS) this.files.delete(id);
    }
  }
}

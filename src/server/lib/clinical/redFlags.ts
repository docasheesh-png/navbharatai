// Doctor AI (SDA) — clinical red-flag detection over free-text case notes / the model's vitals recap.
//
// These flags are clinical-safety critical because they don't just show an emergency banner: the
// route PERSISTS them into the case memory and RE-INJECTS them into the model's prompt on every later
// turn. So a WRONG flag pins a false "confirmed danger" (or hides a real one) for the rest of the
// consult and degrades the model's reasoning.
//
// The VITAL-SIGN thresholds PARSE the actual number and compare it. The old detector matched a
// leading-digit character class behind `.{0,10}` (e.g. `bp.{0,10}[0-7]\d\/`), which:
//   • read "BP 120/80" as Hypotension (it matched "20/"),  ← false emergency on a NORMAL bp
//   • MISSED real hypotension "BP 85/55" (systolic 85 starts with 8 ∉ [0-7]),  ← dangerous miss
//   • flagged "Hb 13" (normal) as Severe Anaemia and "SpO2 100%" as Low SpO2.
// Parsing the value fixes all four. PURE + unit-tested.

/** Phrase/word emergencies — a named condition or non-numeric sign in the note or recap. */
const WORD_FLAGS: readonly [RegExp, string][] = [
  [/\bshock\b/i, 'Shock'],
  [/\bsepsis\b/i, 'Sepsis'],
  [/\brespiratory failure\b/i, 'Respiratory Failure'],
  [/\bchest pain\b.{0,30}\bsweating\b|\bdiaphoresis\b/i, 'Possible ACS'],
  [/\bstroke\b|\bfacial droop\b|\barm weakness\b/i, 'Stroke Signs'],
  [/\bmeningitis\b|\bneck stiffness\b.*fever/i, 'Meningitis Signs'],
  [/\bgi bleed\b|\bmelena\b|\bhematemesis\b/i, 'GI Bleeding'],
  [/\bdka\b|\bdiabetic ketoacidosis\b/i, 'DKA'],
  [/\bpulse.{0,10}1[2-9]\d|tachycardia/i, 'Tachycardia'],
  [/\btemp.{0,10}1(?:0[4-9]|[1-9]\d)|fever.{0,20}high|hyperpyrexia/i, 'High Fever'],
  [/\baltered.{0,20}conscious|unconscious|unresponsive/i, 'Altered Consciousness'],
  [/\beclampsia\b|\bpre-?eclampsia\b.*severe/i, 'Eclampsia'],
  [/\bneck stiffness\b|\bphotophobia\b|\bmeningism\b/i, 'Meningism'],
  // The word forms of the numeric flags below — a clinician may type the diagnosis, not the value.
  [/\bhypotension\b/i, 'Hypotension'],
  [/severe.{0,15}ana?emia/i, 'Severe Anaemia'],
];

/** Detect emergency red flags in one piece of text (a case note or the model's reply). PURE. */
export function detectRedFlags(text: string): string[] {
  const t = text || '';
  const flags = new Set<string>();
  for (const [re, label] of WORD_FLAGS) if (re.test(t)) flags.add(label);

  // Low SpO2 — < 90%. Parse the number (so "SpO2 100%" is NOT flagged, "SpO2 88" IS).
  const spo2 = t.match(/\b(?:spo2|o2\s*sat[a-z]*|oxygen\s*sat[a-z]*)\b\D{0,6}(\d{2,3})/i);
  if (spo2 && Number(spo2[1]) > 0 && Number(spo2[1]) < 90) flags.add('Low SpO2');

  // Hypotension — systolic < 90 OR diastolic < 60 (so "BP 120/80" is NOT flagged, "BP 85/55" IS).
  const bp = t.match(/\bbp\b\D{0,6}(\d{2,3})\s*\/\s*(\d{2,3})/i);
  if (bp && (Number(bp[1]) < 90 || Number(bp[2]) < 60)) flags.add('Hypotension');

  // Severe anaemia — Hb < 7 g/dL (so "Hb 13" is NOT flagged, "Hb 6.5" IS). `\bhb\b` won't hit HbA1c.
  const hb = t.match(/\bhb\b\D{0,6}(\d{1,2}(?:\.\d)?)/i);
  if (hb && Number(hb[1]) > 0 && Number(hb[1]) < 7) flags.add('Severe Anaemia');

  return [...flags];
}

/** Union of red flags across several texts (e.g. the AI reply AND the user's message). PURE. */
export function detectRedFlagsAcross(...texts: string[]): string[] {
  const flags = new Set<string>();
  for (const t of texts) for (const f of detectRedFlags(t)) flags.add(f);
  return [...flags];
}

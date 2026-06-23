/**
 * Deterministic clinical calculators for Doctor AI (SDA).
 *
 * WHY: LLMs make arithmetic/score/dose mistakes — which are dangerous in a
 * clinical tool. These are CODED, well-established formulas with unit tests, so
 * scores and weight-based doses are computed exactly, never guessed by the model.
 * Each result is decision-support only and must be confirmed by the treating doctor.
 *
 * Sources: standard published criteria — CURB-65, qSOFA (Sepsis-3), GCS,
 * Wells DVT/PE, CHA2DS2-VASc. Pediatric dosing is a generic mg/kg calculator
 * (the doctor supplies the mg/kg from their reference; the tool only does the math).
 */

export interface ClinicalResult {
  tool: string;
  score: number;
  risk: string;
  detail: string;
}

const b = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
};

/** CURB-65 — community-acquired pneumonia severity (0–5). */
export function curb65(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (b(i.confusion)) s++;
  if (num(i.ureaMmolL) > 7) s++;            // urea > 7 mmol/L (BUN > ~19 mg/dL)
  if (num(i.respiratoryRate) >= 30) s++;
  if (num(i.systolicBP) < 90 || num(i.diastolicBP) <= 60) s++;
  if (num(i.age) >= 65) s++;
  const risk = s <= 1 ? 'Low (consider outpatient)' : s === 2 ? 'Moderate (consider admission)' : 'High (admit; consider ICU if 4–5)';
  return { tool: 'CURB-65', score: s, risk, detail: `${s}/5. Mortality rises with score; ${risk}.` };
}

/** qSOFA — bedside sepsis risk (0–3). */
export function qsofa(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (num(i.respiratoryRate) >= 22) s++;
  if (num(i.systolicBP) <= 100) s++;
  if (b(i.alteredMentation)) s++;
  const risk = s >= 2 ? 'High — greater risk of poor outcome; assess for sepsis/organ dysfunction' : 'Lower risk (does not rule out sepsis)';
  return { tool: 'qSOFA', score: s, risk, detail: `${s}/3. ${risk}.` };
}

/** Glasgow Coma Scale (3–15). */
export function gcs(i: Record<string, unknown>): ClinicalResult {
  const e = num(i.eye), v = num(i.verbal), m = num(i.motor);
  if (!(e >= 1 && e <= 4 && v >= 1 && v <= 5 && m >= 1 && m <= 6)) {
    throw new Error('GCS needs eye (1–4), verbal (1–5), motor (1–6).');
  }
  const s = e + v + m;
  const risk = s <= 8 ? 'Severe (≤8 — consider airway protection)' : s <= 12 ? 'Moderate' : 'Mild';
  return { tool: 'GCS', score: s, risk, detail: `E${e}V${v}M${m} = ${s}/15. ${risk}.` };
}

/** Wells score — DVT probability. */
export function wellsDvt(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  for (const k of ['activeCancer', 'paralysisOrImmobilization', 'bedriddenOrSurgery', 'tendernessDeepVeins', 'entireLegSwollen', 'calfSwellingGt3cm', 'pittingEdema', 'collateralVeins', 'previousDvt']) {
    if (b(i[k])) s++;
  }
  if (b(i.alternativeDiagnosisLikely)) s -= 2;
  const risk = s >= 2 ? 'DVT likely' : 'DVT unlikely (consider D-dimer)';
  return { tool: 'Wells DVT', score: s, risk, detail: `${s} points. ${risk}.` };
}

/** Wells score — PE probability. */
export function wellsPe(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (b(i.clinicalSignsDvt)) s += 3;
  if (b(i.peMostLikely)) s += 3;
  if (num(i.heartRate) > 100) s += 1.5;
  if (b(i.immobilizationOrSurgery)) s += 1.5;
  if (b(i.previousDvtPe)) s += 1.5;
  if (b(i.hemoptysis)) s += 1;
  if (b(i.malignancy)) s += 1;
  const twoTier = s > 4 ? 'PE likely' : 'PE unlikely';
  const threeTier = s > 6 ? 'High' : s >= 2 ? 'Moderate' : 'Low';
  return { tool: 'Wells PE', score: s, risk: `${twoTier} (3-tier: ${threeTier})`, detail: `${s} points. Two-tier: ${twoTier}; three-tier: ${threeTier}.` };
}

/** CHA2DS2-VASc — stroke risk in atrial fibrillation (0–9). */
export function cha2ds2vasc(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (b(i.chf)) s++;
  if (b(i.hypertension)) s++;
  const age = num(i.age);
  if (age >= 75) s += 2; else if (age >= 65) s += 1;
  if (b(i.diabetes)) s++;
  if (b(i.strokeTia)) s += 2;
  if (b(i.vascularDisease)) s++;
  if (String(i.sex).toLowerCase().startsWith('f')) s++;
  const risk = s === 0 ? 'Low (no anticoagulation generally needed)' : s === 1 ? 'Intermediate (consider anticoagulation)' : 'High (anticoagulation recommended)';
  return { tool: 'CHA2DS2-VASc', score: s, risk, detail: `${s}/9. ${risk}.` };
}

/** Generic weight-based pediatric dose: doctor supplies mg/kg from their reference. */
export function pediatricDose(i: Record<string, unknown>): ClinicalResult {
  const mgPerKg = num(i.mgPerKg), weightKg = num(i.weightKg);
  const dosesPerDay = num(i.dosesPerDay) || 1;
  const maxSingleMg = num(i.maxSingleMg);
  if (!(mgPerKg > 0 && weightKg > 0)) throw new Error('Need mgPerKg and weightKg (both > 0).');
  let single = mgPerKg * weightKg;
  let capped = false;
  if (Number.isFinite(maxSingleMg) && single > maxSingleMg) { single = maxSingleMg; capped = true; }
  const perDay = single * dosesPerDay;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    tool: 'Pediatric dose',
    score: round(single),
    risk: 'Verify against a pediatric reference (BNF-C / Harriet Lane) before prescribing',
    detail: `${mgPerKg} mg/kg × ${weightKg} kg = ${round(single)} mg/dose${capped ? ` (capped at adult max ${maxSingleMg} mg)` : ''}; ×${dosesPerDay}/day = ${round(perDay)} mg/day.`,
  };
}

export type ClinicalTool =
  | 'curb65' | 'qsofa' | 'gcs' | 'wells_dvt' | 'wells_pe' | 'cha2ds2vasc' | 'pediatric_dose';

const REGISTRY: Record<ClinicalTool, (i: Record<string, unknown>) => ClinicalResult> = {
  curb65, qsofa, gcs, wells_dvt: wellsDvt, wells_pe: wellsPe, cha2ds2vasc, pediatric_dose: pediatricDose,
};

export function computeClinicalTool(tool: string, inputs: Record<string, unknown>): ClinicalResult {
  const fn = REGISTRY[tool as ClinicalTool];
  if (!fn) throw new Error(`Unknown clinical tool: ${tool}. Available: ${Object.keys(REGISTRY).join(', ')}`);
  return fn(inputs || {});
}

export const AVAILABLE_CLINICAL_TOOLS = Object.keys(REGISTRY);

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

/** CRB-65 — community-acquired pneumonia severity WITHOUT the urea blood test (0–4). The PHC/rural
 *  version of CURB-65: needs no lab, so a village doctor can risk-stratify pneumonia at the bedside. */
export function crb65(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (b(i.confusion)) s++;
  if (num(i.respiratoryRate) >= 30) s++;
  if (num(i.systolicBP) < 90 || num(i.diastolicBP) <= 60) s++;
  if (num(i.age) >= 65) s++;
  const risk = s === 0 ? 'Low (consider home management)' : s <= 2 ? 'Intermediate (consider hospital assessment/admission)' : 'High (urgent admission; assess for ICU)';
  return { tool: 'CRB-65', score: s, risk, detail: `${s}/4 (no blood test needed). ${risk}.` };
}

/** eGFR by Cockcroft-Gault creatinine clearance (mL/min) — the estimate used for DRUG DOSE
 *  adjustment. Needs age, weight, sex and serum creatinine (mg/dL). Essential before dosing
 *  renally-cleared drugs (aminoglycosides, many antibiotics, metformin, DOACs). */
export function egfrCockcroftGault(i: Record<string, unknown>): ClinicalResult {
  const age = num(i.age), weightKg = num(i.weightKg), scr = num(i.serumCreatinineMgDl);
  if (!(age > 0 && weightKg > 0 && scr > 0)) throw new Error('Need age, weightKg and serumCreatinineMgDl (all > 0).');
  const female = String(i.sex).toLowerCase().startsWith('f');
  const crcl = ((140 - age) * weightKg * (female ? 0.85 : 1)) / (72 * scr);
  const val = Math.round(crcl * 10) / 10;
  const risk = val >= 90 ? 'Normal (G1)' : val >= 60 ? 'Mild ↓ (G2)' : val >= 45 ? 'Mild–moderate ↓ (G3a) — review renally-cleared drug doses'
    : val >= 30 ? 'Moderate–severe ↓ (G3b) — dose-adjust renally-cleared drugs' : val >= 15 ? 'Severe ↓ (G4) — many drugs contraindicated/adjust' : 'Kidney failure (G5)';
  return { tool: 'eGFR (Cockcroft-Gault)', score: val, risk, detail: `CrCl ≈ ${val} mL/min. ${risk}. Adjust renally-cleared drug doses accordingly.` };
}

/** Serum anion gap = Na − (Cl + HCO3). High AG → DKA, lactic acidosis, poisoning (methanol/ethylene
 *  glycol/salicylate) — all rural priorities. Corrects for albumin when provided (a low albumin
 *  masks a raised gap). Inputs in mmol/L; albumin in g/dL (optional). */
export function anionGap(i: Record<string, unknown>): ClinicalResult {
  const na = num(i.sodium), cl = num(i.chloride), hco3 = num(i.bicarbonate);
  if (!(Number.isFinite(na) && Number.isFinite(cl) && Number.isFinite(hco3))) throw new Error('Need sodium, chloride and bicarbonate (mmol/L).');
  const ag = na - (cl + hco3);
  const albumin = num(i.albuminGDl);
  let corrected = ag;
  let corrNote = '';
  if (Number.isFinite(albumin) && albumin > 0) {
    corrected = ag + 2.5 * (4.0 - albumin);
    corrNote = ` Albumin-corrected AG ≈ ${Math.round(corrected * 10) / 10} (albumin ${albumin} g/dL).`;
  }
  const judge = corrected > 12 ? 'HIGH anion gap — think DKA, lactic acidosis, poisoning (MUDPILES)' : corrected < 8 ? 'Low' : 'Normal';
  return { tool: 'Anion gap', score: Math.round(ag * 10) / 10, risk: judge, detail: `AG = ${na} − (${cl} + ${hco3}) = ${Math.round(ag * 10) / 10} mmol/L.${corrNote} ${judge}.` };
}

/** Killip class for acute MI (I–IV) — derived from the bedside findings, mapped to its approximate
 *  in-hospital mortality band. A higher class means worse pump failure and urgent escalation. */
export function killip(i: Record<string, unknown>): ClinicalResult {
  const cls = b(i.cardiogenicShock) ? 4 : b(i.pulmonaryEdema) ? 3 : (b(i.rales) || b(i.s3) || b(i.raisedJvp)) ? 2 : 1;
  const map: Record<number, string> = {
    1: 'Class I — no heart failure (lowest mortality)',
    2: 'Class II — rales/S3/↑JVP (mild–moderate failure)',
    3: 'Class III — frank pulmonary oedema (high mortality)',
    4: 'Class IV — cardiogenic shock (highest mortality; urgent escalation)',
  };
  return { tool: 'Killip class', score: cls, risk: map[cls], detail: `${map[cls]}. Higher class → higher in-hospital mortality; escalate/refer urgently for III–IV.` };
}

/** Centor score with the McIsaac age modifier (−1 to 5) — likelihood of Group A strep pharyngitis;
 *  guides testing vs. antibiotics (antibiotic stewardship — avoid needless antibiotics for viral sore throat). */
export function centorMcIsaac(i: Record<string, unknown>): ClinicalResult {
  let s = 0;
  if (b(i.tonsillarExudate)) s++;
  if (b(i.tenderAnteriorNodes)) s++;
  if (b(i.feverHistory)) s++;
  if (b(i.noCough)) s++;
  const age = num(i.age);
  if (Number.isFinite(age)) { if (age >= 3 && age <= 14) s++; else if (age >= 45) s--; }
  const risk = s <= 0 ? 'Very low strep risk — no test/antibiotic'
    : s === 1 ? 'Low — no test/antibiotic'
    : s <= 3 ? 'Intermediate — consider rapid strep test / throat culture'
    : 'High — consider empirical antibiotics or test';
  return { tool: 'Centor (McIsaac)', score: s, risk, detail: `${s} points. ${risk}.` };
}

/** Paediatric maintenance fluids — Holliday-Segar (mL/day) with the 4-2-1 hourly rate. For a rural
 *  doctor rehydrating/maintaining a child. Doctor still adjusts for deficit, ongoing losses and status. */
export function pediatricMaintenanceFluid(i: Record<string, unknown>): ClinicalResult {
  const wt = num(i.weightKg);
  if (!(wt > 0)) throw new Error('Need weightKg (> 0).');
  let perDay: number;
  if (wt <= 10) perDay = wt * 100;
  else if (wt <= 20) perDay = 1000 + (wt - 10) * 50;
  else perDay = 1500 + (wt - 20) * 20;
  let perHr: number;
  if (wt <= 10) perHr = wt * 4;
  else if (wt <= 20) perHr = 40 + (wt - 10) * 2;
  else perHr = 60 + (wt - 20) * 1;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    tool: 'Paediatric maintenance fluid',
    score: r(perDay),
    risk: 'Maintenance only — add deficit & ongoing losses; reassess clinically',
    detail: `Holliday-Segar: ${r(perDay)} mL/day (≈ ${r(perHr)} mL/hr by the 4-2-1 rule) for ${wt} kg.`,
  };
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
  | 'curb65' | 'crb65' | 'qsofa' | 'gcs' | 'wells_dvt' | 'wells_pe' | 'cha2ds2vasc'
  | 'egfr' | 'anion_gap' | 'killip' | 'centor' | 'peds_fluid' | 'pediatric_dose';

const REGISTRY: Record<ClinicalTool, (i: Record<string, unknown>) => ClinicalResult> = {
  curb65, crb65, qsofa, gcs, wells_dvt: wellsDvt, wells_pe: wellsPe, cha2ds2vasc,
  egfr: egfrCockcroftGault, anion_gap: anionGap, killip, centor: centorMcIsaac,
  peds_fluid: pediatricMaintenanceFluid, pediatric_dose: pediatricDose,
};

export function computeClinicalTool(tool: string, inputs: Record<string, unknown>): ClinicalResult {
  const fn = REGISTRY[tool as ClinicalTool];
  if (!fn) throw new Error(`Unknown clinical tool: ${tool}. Available: ${Object.keys(REGISTRY).join(', ')}`);
  return fn(inputs || {});
}

export const AVAILABLE_CLINICAL_TOOLS = Object.keys(REGISTRY);

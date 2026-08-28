// THE DOCTOR'S OWN FORMULARY — emergency medicines the doctor enters, edits and owns (admin 2026-08-28).
//
// THE ASK, verbatim intent: "quick select me antibiotics ki need nahi, emergency medicine rakho (adr,
// nor-adr, dopamine, dobutamine, hydrocortisone…) … doctor khud apni medicine add kare — dose per kg,
// 1 ml me kitne mg, route, sab doctor khud fill kare."
//
// WHY THIS IS THE RIGHT ARCHITECTURE — and why it ends the source problem for emergency drugs. The
// calculator's one law is that every number is traceable to someone qualified who can be named. For
// the FBNC chart that someone is the Government of Uttar Pradesh. For adrenaline at 2 a.m. it is THE
// DOCTOR THEMSELVES: they enter the regimen from their own unit protocol ONCE, the machine does only
// the arithmetic forever after, and every answer says plainly "added by you — verify against your
// protocol". The AI never supplies a number it remembered; the doctor never re-does multiplication
// under pressure. Each side does the thing it is actually good at.
//
// WHAT THE MACHINE ADDS on top of the doctor's numbers — the ER win this exists for: an infusion
// entered as mcg/kg/min WITH its concentration computes straight to mL/hour, which is the number the
// pump actually takes and the one people mis-derive at speed.
//
// ON THIS DEVICE ONLY (localStorage, same hardening as vialMemory): a formulary is unit practice, not
// cloud data, and an ER tool that needs the network is not an ER tool. PURE core; storage injected.

import { formatMg } from './neonatalDosing';

/** How the entered dose is meant: a per-dose amount (mg or mcg per kg) or a per-minute infusion. */
export type CustomDoseUnit = 'mg/kg' | 'mcg/kg' | 'mcg/kg/min';

export interface CustomMedicine {
  id: string;
  name: string;
  unit: CustomDoseUnit;
  /** Dose per kg (in the unit above). With `dosePerKgMax` this is the low end of a range. */
  dosePerKg: number;
  dosePerKgMax?: number;
  /** Cap on one computed dose, in mg — the entered protocol's own ceiling, applied and SAID. */
  maxDoseMg?: number;
  route: string;
  /** Concentration; unlocks mL (and mL/hour for infusions). */
  mgPerMl?: number;
  notes?: string;
  /** Epoch ms — printed in the source line so "added by you" carries a checkable date. */
  addedAt: number;
}

export const CUSTOM_MEDICINES_KEY = 'navbharat_custom_medicines_v1';
export const MAX_CUSTOM_MEDICINES = 100;
/** The widest weight this will compute for — the doctor's regimen, so paediatric+, not newborn-only. */
export const CUSTOM_MIN_WEIGHT_KG = 0.4;
export const CUSTOM_MAX_WEIGHT_KG = 250;

/**
 * Validate one entry as the doctor typed it. Returns the clean medicine or a plain-words problem.
 *
 * The bar is "would silently computing from this ever mislead": a non-positive dose, a max below the
 * min, a zero concentration (divides to Infinity) are all refused with the reason — never coerced. PURE.
 */
export function validateCustomMedicine(input: {
  name?: string; unit?: string; dosePerKg?: number | string; dosePerKgMax?: number | string;
  maxDoseMg?: number | string; route?: string; mgPerMl?: number | string; notes?: string;
}, now: number, id?: string): { ok: true; medicine: CustomMedicine } | { ok: false; problem: string } {
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, problem: 'Give the medicine a name.' };
  const unit = input.unit as CustomDoseUnit;
  if (unit !== 'mg/kg' && unit !== 'mcg/kg' && unit !== 'mcg/kg/min') {
    return { ok: false, problem: 'Pick how the dose is written: mg/kg, mcg/kg, or mcg/kg/min.' };
  }
  const num = (v: unknown): number | null => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dose = num(input.dosePerKg);
  if (dose === null || dose <= 0) return { ok: false, problem: `The dose per kg must be a number above zero (in ${unit}).` };
  const doseMax = num(input.dosePerKgMax);
  if (doseMax !== null && doseMax < dose) return { ok: false, problem: 'The top of the dose range is below the bottom.' };
  const maxDose = num(input.maxDoseMg);
  if (maxDose !== null && maxDose <= 0) return { ok: false, problem: 'The maximum dose must be above zero (in mg).' };
  const mgPerMl = num(input.mgPerMl);
  if (mgPerMl !== null && mgPerMl <= 0) return { ok: false, problem: 'mg per mL must be above zero — it divides the dose into a volume.' };
  const route = String(input.route ?? '').trim().slice(0, 40);
  if (!route) return { ok: false, problem: 'Give the route (IV, IM, nebulised…).' };
  return {
    ok: true,
    medicine: {
      id: id ?? `cm_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name, unit, dosePerKg: dose,
      ...(doseMax !== null ? { dosePerKgMax: doseMax } : {}),
      ...(maxDose !== null ? { maxDoseMg: maxDose } : {}),
      route,
      ...(mgPerMl !== null ? { mgPerMl } : {}),
      ...(String(input.notes ?? '').trim() ? { notes: String(input.notes).trim().slice(0, 200) } : {}),
      addedAt: now,
    },
  };
}

export interface CustomDoseLine {
  /** "3.4 mg" / "6.8–13.6 mcg" / "10.2–20.4 mcg/min" */
  amount: string;
  /** The arithmetic written out, so the number can be checked at the cot side. */
  workings: string;
  /** Volume when mgPerMl is known: "0.34 mL" — or for an infusion, "0.61–1.22 mL/hour". */
  volume?: string;
  route: string;
  /** Set when maxDoseMg clipped the computed dose — the cap is applied AND said, never silent. */
  capped?: string;
  notes?: string;
  /** Printed with every answer: whose number this is and when they entered it. */
  sourceLine: string;
}

/**
 * The arithmetic on the doctor's own regimen. Refuses a weight outside the wide guard — a typo like
 * 320 for 32.0 is still a typo at any age. PURE.
 */
export function computeCustomDose(med: CustomMedicine, weightKg: number, now: Date = new Date()):
  { ok: true; line: CustomDoseLine } | { ok: false; problem: string } {
  if (!Number.isFinite(weightKg) || weightKg < CUSTOM_MIN_WEIGHT_KG || weightKg > CUSTOM_MAX_WEIGHT_KG) {
    return { ok: false, problem: `Weight must be between ${CUSTOM_MIN_WEIGHT_KG} and ${CUSTOM_MAX_WEIGHT_KG} kg.` };
  }
  const lo = med.dosePerKg * weightKg;
  const hi = (med.dosePerKgMax ?? med.dosePerKg) * weightKg;
  const isRange = hi !== lo;
  const baseUnit = med.unit === 'mg/kg' ? 'mg' : 'mcg';
  const perMin = med.unit === 'mcg/kg/min';

  // The doctor's own ceiling. Applied to per-dose amounts only (a per-minute rate has no single-dose
  // cap to clip), converted honestly across mg/mcg, and always announced when it bites.
  let cLo = lo; let cHi = hi; let capped: string | undefined;
  if (!perMin && med.maxDoseMg !== undefined) {
    const capInBase = baseUnit === 'mg' ? med.maxDoseMg : med.maxDoseMg * 1000;
    if (cHi > capInBase) {
      cLo = Math.min(cLo, capInBase); cHi = capInBase;
      capped = `Capped at your entered maximum of ${formatMg(med.maxDoseMg)} mg.`;
    }
  }

  const amt = (v: number) => formatMg(v);
  const unitLabel = perMin ? `${baseUnit}/min` : baseUnit;
  const amount = isRange || cLo !== cHi ? `${amt(cLo)}–${amt(cHi)} ${unitLabel}` : `${amt(cLo)} ${unitLabel}`;
  const workings = `${formatMg(med.dosePerKg)}${med.dosePerKgMax !== undefined ? `–${formatMg(med.dosePerKgMax)}` : ''} ${med.unit} × ${formatMg(weightKg)} kg = ${amount}`;

  let volume: string | undefined;
  if (med.mgPerMl !== undefined) {
    const toMg = (v: number) => (baseUnit === 'mg' ? v : v / 1000);
    if (perMin) {
      // THE PUMP NUMBER: mcg/kg/min → mg/min → mL/min → mL/hour. This is the conversion people
      // mis-derive under pressure, and it is exactly why the concentration field exists.
      const mlhLo = (toMg(cLo) / med.mgPerMl) * 60;
      const mlhHi = (toMg(cHi) / med.mgPerMl) * 60;
      volume = mlhLo === mlhHi ? `${amt(mlhLo)} mL/hour` : `${amt(mlhLo)}–${amt(mlhHi)} mL/hour`;
    } else {
      const mlLo = toMg(cLo) / med.mgPerMl;
      const mlHi = toMg(cHi) / med.mgPerMl;
      volume = mlLo === mlHi ? `${amt(mlLo)} mL` : `${amt(mlLo)}–${amt(mlHi)} mL`;
    }
    volume += ` at ${formatMg(med.mgPerMl)} mg/mL`;
  }

  const added = new Date(med.addedAt);
  const dateLabel = `${added.getDate()}/${added.getMonth() + 1}/${added.getFullYear()}`;
  return {
    ok: true,
    line: {
      amount, workings, volume, route: med.route, capped, notes: med.notes,
      sourceLine: `Source: your own entry for ${med.name} (added ${dateLabel}) — verify against your unit protocol.`,
    },
  };
}

// ── STORAGE (same hardening as vialMemory: damage is dropped, never half-used) ──────────────────────

function store(storage?: Pick<Storage, 'getItem' | 'setItem'>): Pick<Storage, 'getItem' | 'setItem'> | null {
  return storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
}

export function loadCustomMedicines(storage?: Pick<Storage, 'getItem' | 'setItem'>): CustomMedicine[] {
  try {
    const st = store(storage);
    if (!st) return [];
    const raw = st.getItem(CUSTOM_MEDICINES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CustomMedicine[] = [];
    for (const item of parsed) {
      const m = item as Partial<CustomMedicine> | null;
      if (!m || typeof m !== 'object') continue;
      // Re-validated on every load: a hand-edited or corrupted entry must not compute a dose.
      const v = validateCustomMedicine(m, typeof m.addedAt === 'number' ? m.addedAt : Date.now(), typeof m.id === 'string' ? m.id : undefined);
      if (v.ok) out.push({ ...v.medicine, addedAt: typeof m.addedAt === 'number' ? m.addedAt : v.medicine.addedAt });
    }
    return out.slice(0, MAX_CUSTOM_MEDICINES);
  } catch {
    return [];
  }
}

export function saveCustomMedicine(med: CustomMedicine, storage?: Pick<Storage, 'getItem' | 'setItem'>): CustomMedicine[] {
  const list = loadCustomMedicines(storage);
  const next = [...list.filter((m) => m.id !== med.id), med].slice(-MAX_CUSTOM_MEDICINES);
  try { store(storage)?.setItem(CUSTOM_MEDICINES_KEY, JSON.stringify(next)); } catch { /* the answer still stands */ }
  return next;
}

export function deleteCustomMedicine(id: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): CustomMedicine[] {
  const next = loadCustomMedicines(storage).filter((m) => m.id !== id);
  try { store(storage)?.setItem(CUSTOM_MEDICINES_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}

// ── SEARCH — "Google jaisa": type anything, misspelt included, tap a suggestion ─────────────────────

import { NEONATAL_DRUGS, editDistance, type DrugEntry } from './neonatalDosing';

export type MedicineHit =
  | { kind: 'chart'; drug: DrugEntry; label: string }
  | { kind: 'custom'; medicine: CustomMedicine; label: string };

/**
 * Rank every known medicine (the doctor's own first, then the chart) against what was typed.
 *
 * Prefix beats substring beats fuzzy — the same feel as a search box anywhere — and fuzzy uses the
 * SAME bounded editDistance as chat (≤2 edits, longer names only), so "hydrocortison" or "adrenalin"
 * finds the doctor's entry. Suggestion-then-TAP keeps the selection explicit: a fuzzy match here only
 * ever proposes, the doctor confirms. PURE.
 */
export function searchMedicines(query: string, custom: CustomMedicine[]): MedicineHit[] {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return [];
  const scored: Array<{ hit: MedicineHit; score: number }> = [];
  const scoreName = (name: string): number => {
    const n = name.toLowerCase();
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    if (q.length >= 5 && n.length >= 5 && editDistance(q, n, 2) <= 2) return 40;
    // A typed word against the start of the name ("adr" → adrenaline is prefix; "adrenalin" is fuzzy).
    return 0;
  };
  for (const m of custom) {
    const s = scoreName(m.name);
    if (s > 0) scored.push({ hit: { kind: 'custom', medicine: m, label: m.name }, score: s + 5 }); // own first on ties
  }
  for (const d of NEONATAL_DRUGS) {
    const s = Math.max(...d.aliases.map(scoreName), scoreName(d.label));
    if (s > 0) scored.push({ hit: { kind: 'chart', drug: d, label: d.label }, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.hit);
}

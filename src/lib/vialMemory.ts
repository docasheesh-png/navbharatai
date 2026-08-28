// THE VIALS THIS DEVICE KNOWS — so an emergency dose question is only ever the weight.
//
// ADMIN 2026-08-27: "yeh bas mere liye hai, emergency me dose calculation ke liye … mai kahan calculate
// karta firu" — and then "dose mujhe ml me chahiye".
//
// Milligrams need nothing but the chart. Millilitres need the VIAL, and the vial is a fact about this
// cot side, not about the guideline — so it is told once and kept here. Told once, because in the
// emergency this exists for there is no time to type it again.
//
// ON THIS DEVICE ONLY. The same localStorage the taught-memory feature uses, never uploaded: which
// strengths a unit stocks is their business, and a dosing aid that needs the network is not a dosing
// aid at 3 a.m. PURE apart from the storage handle, which is injected so it is fully testable.

import type { ConcentrationMemory, Concentration, DrugId } from './neonatalDosing';

/** Versioned, so a later format change can be recognised rather than misread. */
export const VIAL_MEMORY_KEY = 'navbharat_vial_memory_v1';

/** Load the remembered vials. Any damage returns {} — a dose is never computed from a doubtful vial. */
export function loadVials(storage?: Pick<Storage, 'getItem'>): ConcentrationMemory {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return {};
    const raw = store.getItem(VIAL_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ConcentrationMemory = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const c = value as Partial<Concentration> | null;
      // A stored entry is only honoured when BOTH halves survive intact: a positive, finite mg/mL and
      // the label the user was shown. Half a remembered vial would compute a volume nobody can check.
      if (!c || typeof c.mgPerMl !== 'number' || !Number.isFinite(c.mgPerMl) || c.mgPerMl <= 0) continue;
      if (typeof c.label !== 'string' || !c.label) continue;
      out[id as DrugId] = { mgPerMl: c.mgPerMl, label: c.label };
    }
    return out;
  } catch {
    return {};
  }
}

/** Remember one drug's vial. Never throws — a storage failure must not cost the user their answer. */
export function saveVial(
  drugId: DrugId,
  concentration: Concentration,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): ConcentrationMemory {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const next: ConcentrationMemory = { ...loadVials(store ?? undefined), [drugId]: concentration };
  try { store?.setItem(VIAL_MEMORY_KEY, JSON.stringify(next)); } catch { /* the answer still stands */ }
  return next;
}

/** Forget one drug's vial — used when the stock changes and the old number must not linger. */
export function forgetVial(drugId: DrugId, storage?: Pick<Storage, 'getItem' | 'setItem'>): ConcentrationMemory {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const next = { ...loadVials(store ?? undefined) };
  delete next[drugId];
  try { store?.setItem(VIAL_MEMORY_KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}

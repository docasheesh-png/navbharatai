// THE DOSE CALCULATOR — a newborn dose without typing a sentence (admin 2026-08-28).
//
// THE ASK, verbatim: "dose calculator alag se banao … Doctor AI ke andar ek chhota sa button (💊),
// jisse doctor khud hi dose calculate kar le. Doctor ko pata hota hai KAB deni hai — bas dose
// calculation me time lagta hai. Aur aap is time ko minimum kar ke baccho ki jaan bachane me help kar
// sakte ho."
//
// WHY A FORM AND NOT THE CHAT. Three live tests in two days each found a way the chat path could fail
// a clinician: a misspelling matched nothing; the model refused a grounded question; a drug outside
// the chart drew a lecture. Every one of those failures lives in the space between free text and the
// calculator. A form has no such space: the drug is a BUTTON (no spelling), the weight is a labelled
// numeric field (no unit guessing), and the answer recomputes on every keystroke from the same pure,
// tested `calculateNeonatalDose` every AI uses — no model anywhere, so nothing to refuse, nothing to
// misread, nothing to wait for. It works offline for the same reason.
//
// WHAT IT DELIBERATELY DOES NOT DO — the same refusals as the engine, because they ARE the safety:
// no drug outside the chart, no guessed indication, no assumed vial, no dose for a weight outside the
// newborn range. The form makes the refusals visible as disabled/empty states instead of prose.
import { useMemo, useState } from 'react';
import { X, Pill, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  NEONATAL_DRUGS, calculateNeonatalDose, parseConcentration, needsIndication,
  MIN_WEIGHT_KG, MAX_WEIGHT_KG, DOSING_SOURCE, DOSING_CAUTION,
  type DrugEntry, type Indication, type DoseResult,
} from '../../lib/neonatalDosing';
import { loadVials, saveVial, forgetVial } from '../../lib/vialMemory';

const INDICATIONS: Array<{ id: Indication; label: string }> = [
  { id: 'sepsis', label: 'Sepsis' },
  { id: 'pneumonia', label: 'Pneumonia' },
  { id: 'meningitis', label: 'Meningitis' },
];

export function DoseCalculator({ onClose }: { onClose: () => void }) {
  const [drug, setDrug] = useState<DrugEntry | null>(null);
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [indication, setIndication] = useState<Indication | null>(null);
  // The vials this device already knows (told once, in chat or here). State so a save re-renders.
  const [vials, setVials] = useState(() => loadVials());
  // What is being typed into the vial field for the SELECTED drug, before it parses.
  const [vialText, setVialText] = useState('');

  const weightKg = weight.trim() === '' ? null : Number(weight);
  const ageDays = age.trim() === '' ? null : Number(age);
  const knownVial = drug ? vials[drug.id] ?? null : null;
  const typedVial = parseConcentration(vialText);

  // LIVE, on every keystroke — the entire point. Pure function, no network, no model: the answer is
  // ready before the finger leaves the key, which is what "calculation me time minimum" means here.
  const result: DoseResult | null = useMemo(() => {
    if (!drug) return null;
    return calculateNeonatalDose({
      drug: drug.aliases[0],
      weightKg: Number.isFinite(weightKg as number) ? weightKg : null,
      ageDays: Number.isFinite(ageDays as number) ? ageDays : null,
      indication,
      concentration: typedVial ?? knownVial,
    });
  }, [drug, weightKg, ageDays, indication, typedVial, knownVial]);

  const pickDrug = (d: DrugEntry) => {
    setDrug(d);
    setIndication(null);
    setVialText('');
  };

  const saveTypedVial = () => {
    if (!drug || !typedVial) return;
    setVials(saveVial(drug.id, typedVial));
    setVialText('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-[#0d1520] border border-emerald-900/40 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0d1520] border-b border-emerald-900/30 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center">
              <Pill className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[12px] font-black text-white tracking-wide">Newborn Dose Calculator</p>
              <p className="text-[9px] text-emerald-600 font-medium">Govt. of Uttar Pradesh FBNC chart · works offline</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 1 — the drug, as buttons. No typing means no spelling, which was the first live failure. */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-1.5">Drug</p>
            <div className="flex flex-wrap gap-1.5">
              {NEONATAL_DRUGS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => pickDrug(d)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                    drug?.id === d.id
                      ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200'
                      : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white hover:bg-white/10',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2 — weight + age. Labelled fields, so the unit ambiguity of free text cannot exist here. */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">Weight (kg)</span>
              <input
                type="number" inputMode="decimal" step="0.1" min={MIN_WEIGHT_KG} max={MAX_WEIGHT_KG}
                value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 2.5" autoFocus
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">Age (days)</span>
              <input
                type="number" inputMode="numeric" min={0}
                value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 3"
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500"
              />
            </label>
          </div>

          {/* 3 — indication, only for the drugs whose dose depends on it. For ampicillin this is the
              difference between 50 and 100 mg/kg, which is why there is no default selection. */}
          {drug && needsIndication(drug) && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-1.5">Treating</p>
              <div className="flex gap-1.5">
                {INDICATIONS.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setIndication(i.id)}
                    className={cn(
                      'flex-1 px-2 py-2 rounded-lg text-[11px] font-bold border transition-all',
                      indication === i.id
                        ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200'
                        : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white',
                    )}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4 — the vial, remembered per drug on this device. Optional: mg never waits for it. */}
          {drug && !drug.infusion && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#484f58] mb-1.5">
                Vial / ampoule <span className="text-[#30363d] normal-case font-medium">(for mL — optional)</span>
              </p>
              {knownVial && !vialText ? (
                <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/40 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-emerald-300 font-bold">{knownVial.label}</span>
                  <button
                    onClick={() => { if (drug) setVials(forgetVial(drug.id)); }}
                    title="Forget this vial (stock changed)"
                    className="p-1 text-[#484f58] hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    value={vialText} onChange={(e) => setVialText(e.target.value)}
                    placeholder='e.g. "500 mg in 5 ml" or "100 mg/ml"'
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={saveTypedVial}
                    disabled={!typedVial}
                    className="px-3 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {/* THE ANSWER — recomputed live. Missing inputs show as the calculator's own question, never
              a lecture; the workings are always visible so the number can be checked at the cot side. */}
          {drug && result && (
            <div className={cn('rounded-xl border p-3', result.ok ? 'bg-emerald-950/30 border-emerald-700/40' : 'bg-white/5 border-white/10')}>
              {result.ok ? (
                <div className="space-y-2.5">
                  {result.parts.map((part) => (
                    <div key={part.label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{part.label}</span>
                        <span className="text-[10px] text-[#484f58]">{[part.frequency, part.route, part.over].filter(Boolean).join(' · ')}</span>
                      </div>
                      <p className="text-xl font-black text-white leading-tight">
                        {part.amount}
                        {part.volume && <span className="text-emerald-300"> = {part.volume}</span>}
                      </p>
                      <p className="text-[10px] text-[#8b949e] font-mono">{part.workings}</p>
                      {part.duration && <p className="text-[10px] text-[#484f58]">Duration: {part.duration}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-amber-300 leading-relaxed">{result.message}</p>
              )}
              {result.warnings.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-1">
                  {result.warnings.map((w) => (
                    <p key={w} className="text-[10px] text-amber-400/90 leading-snug">⚠️ {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* The source and the boundary, always visible — a dose aid that hides where its numbers come
              from is asking to be trusted instead of checked. */}
          <p className="text-[9px] text-[#484f58] leading-relaxed pb-2">
            {DOSING_SOURCE}. {DOSING_CAUTION}
          </p>
        </div>
      </div>
    </div>
  );
}

// THE DOSE CALCULATOR — an ER dosing system, not a chart viewer (admin redesign, 2026-08-28).
//
// THE ADMIN'S VERDICT ON V1, verbatim intent: "aapne badhiya nahi banaya — emergency room me doctor ko
// dose calculation me help karni hai. Type box do (galat spelling bhi 'Google jaise' mil jaye), quick
// select me antibiotics nahi — EMERGENCY medicine (adr, nor-adr, dopamine, dobutamine, hydrocortisone…),
// aur doctor apni medicine KHUD add kare — dose per kg, 1 ml me kitne mg, route, sab doctor fill kare."
//
// THE ARCHITECTURE THAT MAKES POINT 3 SAFE — and why it ends the emergency-drug source problem: the
// calculator's law is that every number traces to someone qualified who can be named. For the FBNC
// chart that is the Government of Uttar Pradesh. For adrenaline at 2 a.m. it is THE DOCTOR: they enter
// the regimen once from their own protocol, the machine does only arithmetic forever after, and every
// answer prints "your own entry (added <date>) — verify against your unit protocol". The AI supplies
// no number anywhere in this file — see the wiring test pinning that no arithmetic of its own exists.
//
// The search box proposes, THE TAP DECIDES: typing (misspelt included, same bounded editDistance as
// chat) only ranks suggestions; nothing computes until the doctor taps one. Free text alone can never
// select a medicine, which is what keeps "Google jaisa" compatible with "never the wrong drug".
import { useMemo, useState, type CSSProperties } from 'react';
import { X, Pill, Trash2, Plus, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  NEONATAL_DRUGS, calculateNeonatalDose, parseConcentration, needsIndication,
  DOSING_SOURCE, DOSING_CAUTION,
  type DrugEntry, type Indication, type DoseResult,
} from '../../lib/neonatalDosing';
import { loadVials, saveVial, forgetVial } from '../../lib/vialMemory';
import { QuickCalcs, CalcTabs } from './QuickCalcs';
import {
  loadCustomMedicines, saveCustomMedicine, deleteCustomMedicine, validateCustomMedicine,
  computeCustomDose, searchMedicines, type CustomMedicine, type CustomDoseUnit,
} from '../../lib/customMedicines';

const INDICATIONS: Array<{ id: Indication; label: string }> = [
  { id: 'sepsis', label: 'Sepsis' },
  { id: 'pneumonia', label: 'Pneumonia' },
  { id: 'meningitis', label: 'Meningitis' },
];

const UNITS: Array<{ id: CustomDoseUnit; label: string }> = [
  { id: 'mg/kg', label: 'mg/kg' },
  { id: 'mcg/kg', label: 'mcg/kg' },
  { id: 'mcg/kg/min', label: 'mcg/kg/min (infusion)' },
];

type Selected = { kind: 'chart'; drug: DrugEntry } | { kind: 'custom'; medicine: CustomMedicine } | null;

/** The add/edit form's raw strings — validated by validateCustomMedicine, never coerced here. */
interface MedForm { name: string; unit: CustomDoseUnit; dosePerKg: string; dosePerKgMax: string; maxDoseMg: string; route: string; mgPerMl: string; notes: string }
const emptyForm = (): MedForm => ({ name: '', unit: 'mg/kg', dosePerKg: '', dosePerKgMax: '', maxDoseMg: '', route: 'IV', mgPerMl: '', notes: '' });

export function DoseCalculator({ onClose }: { onClose: () => void }) {
  // Medicines vs the pure unit converters (pump mL/h, drip rate, dilution) — two jobs, one sheet.
  const [tab, setTab] = useState<'meds' | 'calcs'>('meds');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected>(null);
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [indication, setIndication] = useState<Indication | null>(null);
  const [vials, setVials] = useState(() => loadVials());
  const [vialText, setVialText] = useState('');
  const [customList, setCustomList] = useState<CustomMedicine[]>(() => loadCustomMedicines());
  // 'new' opens a blank form; a medicine opens it pre-filled; null = closed. Edit mode shows ✎/🗑.
  const [editing, setEditing] = useState<'new' | CustomMedicine | null>(null);
  const [form, setForm] = useState<MedForm>(emptyForm());
  const [formProblem, setFormProblem] = useState('');
  const [manageMode, setManageMode] = useState(false);
  // The chart is real and stays — but the ER's own medicines lead. Open by default only while the
  // doctor has no medicines of their own yet.
  const [chartOpen, setChartOpen] = useState(() => loadCustomMedicines().length === 0);

  const weightKg = weight.trim() === '' ? null : Number(weight);
  const ageDays = age.trim() === '' ? null : Number(age);
  const suggestions = useMemo(() => (query.trim() ? searchMedicines(query, customList) : []), [query, customList]);

  const knownVial = selected?.kind === 'chart' ? vials[selected.drug.id] ?? null : null;
  const typedVial = parseConcentration(vialText);

  const chartResult: DoseResult | null = useMemo(() => {
    if (selected?.kind !== 'chart') return null;
    return calculateNeonatalDose({
      drug: selected.drug.aliases[0],
      weightKg: Number.isFinite(weightKg as number) ? weightKg : null,
      ageDays: Number.isFinite(ageDays as number) ? ageDays : null,
      indication,
      concentration: typedVial ?? knownVial,
    });
  }, [selected, weightKg, ageDays, indication, typedVial, knownVial]);

  const customResult = useMemo(() => {
    if (selected?.kind !== 'custom' || weightKg === null || !Number.isFinite(weightKg)) return null;
    return computeCustomDose(selected.medicine, weightKg);
  }, [selected, weightKg]);

  const pick = (s: Selected) => {
    setSelected(s);
    setIndication(null);
    setVialText('');
    setQuery('');
  };

  const openEdit = (m: 'new' | CustomMedicine) => {
    setEditing(m);
    setFormProblem('');
    setForm(m === 'new' ? emptyForm() : {
      name: m.name, unit: m.unit, dosePerKg: String(m.dosePerKg),
      dosePerKgMax: m.dosePerKgMax !== undefined ? String(m.dosePerKgMax) : '',
      maxDoseMg: m.maxDoseMg !== undefined ? String(m.maxDoseMg) : '',
      route: m.route, mgPerMl: m.mgPerMl !== undefined ? String(m.mgPerMl) : '', notes: m.notes ?? '',
    });
  };

  const submitForm = () => {
    const v = validateCustomMedicine(form, Date.now(), editing !== 'new' && editing ? editing.id : undefined);
    if (v.ok === false) { setFormProblem(v.problem); return; }
    const kept = editing !== 'new' && editing ? { ...v.medicine, addedAt: editing.addedAt } : v.medicine;
    setCustomList(saveCustomMedicine(kept));
    setEditing(null);
    pick({ kind: 'custom', medicine: kept });
  };

  const field = 'mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500';
  const label = 'text-[9px] font-black uppercase tracking-widest text-[#484f58]';

  return (
    // `nb-sheet-overlay-flush` (admin 2026-09-06): z-50 is BELOW the global tab bar's z-150, so the
    // bar covered this sheet's bottom — and because the sheet IS the scroll container, scrolling to
    // its end still left those controls underneath the bar. The shared overlay reserves the bar's real
    // height, and reserves nothing where the bar is not rendered.
    <div className="nb-sheet-overlay-flush fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        // 92% is the DESIGN's height; `nb-sheet-partial` clamps it to what is actually left once the
        // tab bar and insets are reserved. Unclamped, 92dvh exceeds the remaining room on any phone
        // under ~700px tall, and a bottom-anchored sheet loses that overflow off the TOP.
        style={{ '--nb-sheet-cap': '92dvh' } as CSSProperties}
        className="w-full sm:max-w-lg nb-sheet-partial overflow-y-auto bg-[#0d1520] border border-emerald-900/40 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0d1520] border-b border-emerald-900/30 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center">
              <Pill className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[12px] font-black text-white tracking-wide">Emergency Dose Calculator</p>
              <p className="text-[9px] text-emerald-600 font-medium">Your medicines + Govt. of UP FBNC chart · works offline</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-white/10 rounded-lg text-[#484f58] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <CalcTabs tab={tab} onTab={setTab} />
          {tab === 'calcs' && <QuickCalcs />}
          {tab === 'meds' && <>
          {/* 1 — TYPE BOX. Typing proposes; the tap decides. Never computes from free text alone. */}
          <div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search any medicine — spelling mistakes are fine"
              autoFocus
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500"
            />
            {suggestions.length > 0 && (
              <div className="mt-1.5 rounded-xl border border-white/10 bg-[#0a1018] overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.kind === 'chart' ? `d_${s.drug.id}` : `c_${s.medicine.id}`}
                    onClick={() => pick(s.kind === 'chart' ? { kind: 'chart', drug: s.drug } : { kind: 'custom', medicine: s.medicine })}
                    className="w-full text-left px-3.5 py-2.5 text-[13px] text-white hover:bg-emerald-900/30 flex items-center justify-between border-b border-white/5 last:border-b-0"
                  >
                    <span className="font-bold">{s.label}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#484f58]">
                      {s.kind === 'custom' ? 'yours' : 'FBNC chart'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && suggestions.length === 0 && (
              /* NOT FOUND — the honest panel. No number from anyone's memory; the fix is the doctor's
                 own 30-second entry, which then works instantly, offline, forever. */
              <div className="mt-1.5 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
                <p className="text-[12px] text-amber-200 leading-relaxed">
                  “{query.trim()}” is not in your medicines or the chart, and NavBharatAI never gives a
                  dose from memory. Add it yourself from your unit protocol — it takes ~30 seconds and
                  then it is instant, offline, every time.
                </p>
                <button
                  onClick={() => { openEdit('new'); setForm((f) => ({ ...f, name: query.trim() })); }}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-amber-900/40 border border-amber-600/40 text-amber-200 hover:bg-amber-800/40"
                >
                  <Plus className="w-3 h-3" /> Add “{query.trim()}” as my medicine
                </button>
              </div>
            )}
          </div>

          {/* 2 — MY EMERGENCY MEDICINES: the doctor's own formulary leads. Edit mode = ✎ / 🗑. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className={label}>My emergency medicines</p>
              <div className="flex items-center gap-1">
                {customList.length > 0 && (
                  <button onClick={() => setManageMode((p) => !p)} title="Edit or delete your medicines"
                    className={cn('p-1.5 rounded-lg', manageMode ? 'bg-emerald-900/50 text-emerald-300' : 'text-[#484f58] hover:text-white')}>
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button onClick={() => openEdit('new')} title="Add a medicine from your unit protocol"
                  className="p-1.5 rounded-lg text-[#484f58] hover:text-emerald-300">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {customList.length === 0 ? (
              <button onClick={() => openEdit('new')}
                className="w-full rounded-xl border border-dashed border-white/15 px-3 py-3 text-[12px] text-[#8b949e] hover:text-white hover:border-emerald-700/50 text-left">
                + Add your emergency medicines once (adrenaline, dopamine, hydrocortisone…) — dose/kg,
                mg per mL and route from your own protocol. Then every dose is one tap.
              </button>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {customList.map((m) => (
                  <span key={m.id} className="inline-flex items-center">
                    <button
                      onClick={() => (manageMode ? openEdit(m) : pick({ kind: 'custom', medicine: m }))}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                        selected?.kind === 'custom' && selected.medicine.id === m.id
                          ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200'
                          : 'bg-white/5 border-white/10 text-[#c9d1d9] hover:text-white hover:bg-white/10',
                        manageMode && 'rounded-r-none border-r-0',
                      )}
                    >
                      {m.name}
                    </button>
                    {manageMode && (
                      <button
                        onClick={() => { setCustomList(deleteCustomMedicine(m.id)); if (selected?.kind === 'custom' && selected.medicine.id === m.id) setSelected(null); }}
                        title={`Delete ${m.name}`}
                        className="px-1.5 py-1.5 rounded-r-lg border border-red-900/50 bg-red-950/30 text-red-400 hover:text-red-200"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ADD / EDIT FORM — the doctor's protocol, in the doctor's hands. Validated, never coerced. */}
          {editing !== null && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                {editing === 'new' ? 'Add medicine (from your unit protocol)' : `Edit ${editing.name}`}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block col-span-2"><span className={label}>Name</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Adrenaline" className={field} />
                </label>
                <label className="block"><span className={label}>Dose unit</span>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as CustomDoseUnit })} className={field}>
                    {UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
                <label className="block"><span className={label}>Route</span>
                  <input value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} placeholder="IV / IM / neb" className={field} />
                </label>
                <label className="block"><span className={label}>Dose per kg</span>
                  <input type="number" inputMode="decimal" value={form.dosePerKg} onChange={(e) => setForm({ ...form, dosePerKg: e.target.value })} placeholder="e.g. 10" className={field} />
                </label>
                <label className="block"><span className={label}>…up to (optional)</span>
                  <input type="number" inputMode="decimal" value={form.dosePerKgMax} onChange={(e) => setForm({ ...form, dosePerKgMax: e.target.value })} placeholder="range top" className={field} />
                </label>
                <label className="block"><span className={label}>mg in 1 mL (optional)</span>
                  <input type="number" inputMode="decimal" value={form.mgPerMl} onChange={(e) => setForm({ ...form, mgPerMl: e.target.value })} placeholder="for mL / mL-per-hour" className={field} />
                </label>
                <label className="block"><span className={label}>Max dose mg (optional)</span>
                  <input type="number" inputMode="decimal" value={form.maxDoseMg} onChange={(e) => setForm({ ...form, maxDoseMg: e.target.value })} placeholder="protocol ceiling" className={field} />
                </label>
                <label className="block col-span-2"><span className={label}>Notes (optional)</span>
                  <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. dilute before use, give slowly" className={field} />
                </label>
              </div>
              {formProblem && <p className="text-[11px] text-amber-300">⚠️ {formProblem}</p>}
              <div className="flex gap-2">
                <button onClick={submitForm} className="flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-900/50 border border-emerald-600/50 text-emerald-200 hover:bg-emerald-800/50">Save medicine</button>
                <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest bg-white/5 border border-white/10 text-[#8b949e] hover:text-white">Cancel</button>
              </div>
              <p className="text-[9px] text-[#484f58] leading-relaxed">
                You are the source for this entry — NavBharatAI stores and calculates it, on this device
                only, and prints “your own entry” on every answer.
              </p>
            </div>
          )}

          {/* 3 — THE FBNC CHART, one fold down: verified newborn regimens, led by the ER's own set. */}
          <div>
            <button onClick={() => setChartOpen((p) => !p)} className="flex items-center gap-1 mb-1.5 text-[#484f58] hover:text-white">
              {chartOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className={label}>Newborn chart (Govt. of UP FBNC)</span>
            </button>
            {chartOpen && (
              <div className="flex flex-wrap gap-1.5">
                {NEONATAL_DRUGS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => pick({ kind: 'chart', drug: d })}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                      selected?.kind === 'chart' && selected.drug.id === d.id
                        ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200'
                        : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white hover:bg-white/10',
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* WEIGHT + AGE */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={label}>Weight (kg)</span>
              <input type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 2.5" className={field} />
            </label>
            {selected?.kind !== 'custom' && (
              <label className="block"><span className={label}>Age (days)</span>
                <input type="number" inputMode="numeric" min={0} value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 3" className={field} />
              </label>
            )}
          </div>

          {/* Chart-only controls: indication (no default — 50 vs 100 mg/kg is nobody's to assume) + vial */}
          {selected?.kind === 'chart' && needsIndication(selected.drug) && (
            <div>
              <p className={cn(label, 'mb-1.5')}>Treating</p>
              <div className="flex gap-1.5">
                {INDICATIONS.map((i) => (
                  <button key={i.id} onClick={() => setIndication(i.id)}
                    className={cn('flex-1 px-2 py-2 rounded-lg text-[11px] font-bold border transition-all',
                      indication === i.id ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200' : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white')}>
                    {i.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {selected?.kind === 'chart' && !selected.drug.infusion && (
            <div>
              <p className={cn(label, 'mb-1.5')}>Vial / ampoule <span className="text-[#30363d] normal-case font-medium">(for mL — optional)</span></p>
              {knownVial && !vialText ? (
                <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800/40 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-emerald-300 font-bold">{knownVial.label}</span>
                  <button onClick={() => setVials(forgetVial(selected.drug.id))} title="Forget this vial (stock changed)" className="p-1 text-[#484f58] hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input value={vialText} onChange={(e) => setVialText(e.target.value)} placeholder='e.g. "500 mg in 5 ml" or "100 mg/ml"' className={cn(field, 'mt-0 flex-1')} />
                  <button
                    onClick={() => { if (typedVial) { setVials(saveVial(selected.drug.id, typedVial)); setVialText(''); } }}
                    disabled={!typedVial}
                    className="px-3 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 disabled:opacity-40">
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {/* THE ANSWER — chart path (verified regimens, asks its own questions) */}
          {selected?.kind === 'chart' && chartResult && (
            <div className={cn('rounded-xl border p-3', chartResult.ok ? 'bg-emerald-950/30 border-emerald-700/40' : 'bg-white/5 border-white/10')}>
              {chartResult.ok ? (
                <div className="space-y-2.5">
                  {chartResult.parts.map((part) => (
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
                <p className="text-[12px] text-amber-300 leading-relaxed">{chartResult.message}</p>
              )}
              {chartResult.warnings.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-1">
                  {chartResult.warnings.map((w) => <p key={w} className="text-[10px] text-amber-400/90 leading-snug">⚠️ {w}</p>)}
                </div>
              )}
            </div>
          )}

          {/* THE ANSWER — the doctor's own medicine */}
          {selected?.kind === 'custom' && (
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 p-3">
              {weightKg === null ? (
                <p className="text-[12px] text-[#8b949e]">Enter the weight — the dose appears instantly.</p>
              ) : customResult && customResult.ok ? (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{selected.medicine.name}</span>
                    <span className="text-[10px] text-[#484f58]">{customResult.line.route}</span>
                  </div>
                  <p className="text-xl font-black text-white leading-tight">
                    {customResult.line.amount}
                    {customResult.line.volume && <span className="text-emerald-300"> = {customResult.line.volume}</span>}
                  </p>
                  <p className="text-[10px] text-[#8b949e] font-mono">{customResult.line.workings}</p>
                  {customResult.line.capped && <p className="text-[10px] text-amber-400/90">⚠️ {customResult.line.capped}</p>}
                  {customResult.line.notes && <p className="text-[10px] text-[#c9d1d9]">📝 {customResult.line.notes}</p>}
                  <p className="text-[9px] text-emerald-700 pt-1">{customResult.line.sourceLine}</p>
                </div>
              ) : (
                <p className="text-[12px] text-amber-300">{customResult?.ok === false ? customResult.problem : ''}</p>
              )}
            </div>
          )}

          <p className="text-[9px] text-[#484f58] leading-relaxed pb-2">
            {DOSING_SOURCE}. {DOSING_CAUTION}
          </p>
          </>}
        </div>
      </div>
    </div>
  );
}

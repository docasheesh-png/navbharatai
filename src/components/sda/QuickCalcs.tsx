// QUICK CALCS — the four unit conversions an ER doctor otherwise does on paper (admin 2026-08-28).
//
// Everything here recomputes on every keystroke from the pure functions in erCalcs.ts, which contain
// unit arithmetic ONLY — every number is the doctor's own (the ordered rate, the label's mg/mL, the
// giving set's drop factor). No drug names, no defaults, no memory. The workings are always shown.
import { useState } from 'react';
import { doseRateToPump, pumpToDoseRate, dripRate, dilutionPrep, type InfusionRateUnit } from '../../lib/erCalcs';
import { cn } from '../../lib/utils';

const label = 'text-[9px] font-black uppercase tracking-widest text-[#484f58]';
const field = 'mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#30363d] focus:outline-none focus:border-emerald-500';

const RATE_UNITS: InfusionRateUnit[] = ['mcg/kg/min', 'mcg/kg/hr', 'mg/kg/hr', 'mg/hr', 'mcg/min'];

function Result({ headline, workings, problem }: { headline?: string; workings?: string; problem?: string }) {
  if (problem) return <p className="text-[11px] text-amber-300 mt-2">{problem}</p>;
  if (!headline) return null;
  return (
    <div className="mt-2">
      <p className="text-lg font-black text-emerald-300 leading-tight">{headline}</p>
      {workings && <p className="text-[10px] text-[#8b949e] font-mono mt-0.5">{workings}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2">{title}</p>
      {children}
    </div>
  );
}

export function QuickCalcs() {
  // Pump: forward
  const [fRate, setFRate] = useState(''); const [fUnit, setFUnit] = useState<InfusionRateUnit>('mcg/kg/min');
  const [fWeight, setFWeight] = useState(''); const [fConc, setFConc] = useState('');
  const fwd = fRate && fConc ? doseRateToPump({ rate: fRate, unit: fUnit, weightKg: fWeight, mgPerMl: fConc }) : null;
  // Pump: reverse
  const [rMl, setRMl] = useState(''); const [rConc, setRConc] = useState(''); const [rWeight, setRWeight] = useState('');
  const rev = rMl && rConc && rWeight ? pumpToDoseRate({ mlPerHour: rMl, mgPerMl: rConc, weightKg: rWeight }) : null;
  // Drip
  const [dVol, setDVol] = useState(''); const [dMin, setDMin] = useState(''); const [dFactor, setDFactor] = useState('');
  const drip = dVol && dMin && dFactor ? dripRate({ volumeMl: dVol, overMinutes: dMin, dropFactor: dFactor }) : null;
  // Dilution
  const [sStock, setSStock] = useState(''); const [sTarget, setSTarget] = useState(''); const [sVol, setSVol] = useState('');
  const dil = sStock && sTarget && sVol ? dilutionPrep({ stockMgPerMl: sStock, targetMgPerMl: sTarget, finalVolumeMl: sVol }) : null;

  return (
    <div className="space-y-3">
      <Card title="Infusion → pump (mL/hour)">
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className={label}>Dose rate</span>
            <input type="number" inputMode="decimal" value={fRate} onChange={(e) => setFRate(e.target.value)} placeholder="e.g. 0.1" className={field} /></label>
          <label className="block"><span className={label}>Unit</span>
            <select value={fUnit} onChange={(e) => setFUnit(e.target.value as InfusionRateUnit)} className={field}>
              {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select></label>
          <label className="block"><span className={label}>Weight (kg)</span>
            <input type="number" inputMode="decimal" value={fWeight} onChange={(e) => setFWeight(e.target.value)} placeholder={fUnit.includes('/kg') ? 'needed' : 'not needed'} className={field} /></label>
          <label className="block"><span className={label}>mg in 1 mL</span>
            <input type="number" inputMode="decimal" value={fConc} onChange={(e) => setFConc(e.target.value)} placeholder="on the label" className={field} /></label>
        </div>
        <Result
          headline={fwd && 'mlPerHour' in fwd ? `${fwd.mlPerHour} mL/hour` : undefined}
          workings={fwd && 'workings' in fwd ? fwd.workings : undefined}
          problem={fwd && 'problem' in fwd ? fwd.problem : undefined}
        />
      </Card>

      <Card title="What is this pump giving? (mL/hour → dose)">
        <div className="grid grid-cols-3 gap-2">
          <label className="block"><span className={label}>Pump mL/h</span>
            <input type="number" inputMode="decimal" value={rMl} onChange={(e) => setRMl(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>mg in 1 mL</span>
            <input type="number" inputMode="decimal" value={rConc} onChange={(e) => setRConc(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>Weight (kg)</span>
            <input type="number" inputMode="decimal" value={rWeight} onChange={(e) => setRWeight(e.target.value)} className={field} /></label>
        </div>
        <Result
          headline={rev && 'mcgPerKgPerMin' in rev ? `${rev.mcgPerKgPerMin} mcg/kg/min` : undefined}
          workings={rev && 'workings' in rev ? rev.workings : undefined}
          problem={rev && 'problem' in rev ? rev.problem : undefined}
        />
      </Card>

      <Card title="Drip rate (no pump)">
        <div className="grid grid-cols-3 gap-2">
          <label className="block"><span className={label}>Volume mL</span>
            <input type="number" inputMode="decimal" value={dVol} onChange={(e) => setDVol(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>Over (min)</span>
            <input type="number" inputMode="decimal" value={dMin} onChange={(e) => setDMin(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>Drop factor</span>
            <input type="number" inputMode="numeric" value={dFactor} onChange={(e) => setDFactor(e.target.value)} placeholder="10/15/20/60" className={field} /></label>
        </div>
        <Result
          headline={drip && 'dropsPerMin' in drip ? `${drip.dropsPerMin} drops/min · 1 drop every ${drip.secondsPerDrop} s` : undefined}
          workings={drip && 'workings' in drip ? drip.workings : undefined}
          problem={drip && 'problem' in drip ? drip.problem : undefined}
        />
      </Card>

      <Card title="Dilution — how much stock + diluent">
        <div className="grid grid-cols-3 gap-2">
          <label className="block"><span className={label}>Stock mg/mL</span>
            <input type="number" inputMode="decimal" value={sStock} onChange={(e) => setSStock(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>Want mg/mL</span>
            <input type="number" inputMode="decimal" value={sTarget} onChange={(e) => setSTarget(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>Final mL</span>
            <input type="number" inputMode="decimal" value={sVol} onChange={(e) => setSVol(e.target.value)} className={field} /></label>
        </div>
        <Result
          headline={dil && 'stockMl' in dil ? `${dil.stockMl} mL stock + ${dil.diluentMl} mL diluent` : undefined}
          workings={dil && 'workings' in dil ? dil.workings : undefined}
          problem={dil && 'problem' in dil ? dil.problem : undefined}
        />
      </Card>

      <p className="text-[9px] text-[#484f58] leading-relaxed">
        These are unit conversions on the numbers you enter — the rate you ordered, the concentration on
        the label, the drop factor on the set. Check the workings line against your order.
      </p>
    </div>
  );
}

/** The tab strip shared with the medicines view. Exported for the sheet; dumb on purpose. */
export function CalcTabs({ tab, onTab }: { tab: 'meds' | 'calcs'; onTab: (t: 'meds' | 'calcs') => void }) {
  return (
    <div className="flex gap-1.5">
      {([['meds', 'Medicines'], ['calcs', 'Quick calcs']] as const).map(([id, text]) => (
        <button key={id} onClick={() => onTab(id)}
          className={cn('flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all',
            tab === id ? 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200' : 'bg-white/5 border-white/10 text-[#8b949e] hover:text-white')}>
          {text}
        </button>
      ))}
    </div>
  );
}

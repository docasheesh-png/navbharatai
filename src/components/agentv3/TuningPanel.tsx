import { useState } from 'react';
import { SlidersHorizontal, X, Save, RotateCcw, Loader2 } from 'lucide-react';
import type { TuneItem } from '../../lib/gameTuning';

/**
 * THE TUNE PANEL (admin 2026-11-21): a slider for each number the game declared adjustable (core/tuning.ts). Dragging
 * changes the running game at once; Save writes the values into the game's tuning file so the published game starts
 * with them; Reset puts the game's own defaults back on the sliders (and in the game) without saving.
 */
export function TuningPanel({ items, onChange, onSave, onClose }: {
  items: TuneItem[];
  onChange: (key: string, value: number) => void;
  onSave: (values: Record<string, number>) => Promise<string>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(items.map((i) => [i.key, i.value])));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = (key: string, value: number) => { setValues((v) => ({ ...v, [key]: value })); onChange(key, value); setNote(null); };
  const save = async () => {
    setBusy(true);
    try { setNote(await onSave(values)); } finally { setBusy(false); }
  };
  const reset = () => { for (const i of items) set(i.key, i.fallback); };
  const digits = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));
  return (
    <div className="w-72 max-w-[90vw] rounded-xl border border-line bg-card shadow-lg" role="dialog" aria-label="Tune the game" data-testid="tuning-panel">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <SlidersHorizontal className="w-4 h-4 text-accent-text" />
        <p className="flex-1 text-xs font-medium text-body">Tune the game</p>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-faint hover:text-body hover:bg-raised" aria-label="Close the tune panel"><X className="w-4 h-4" /></button>
      </div>
      <div className="max-h-[50vh] supports-[height:100dvh]:max-h-[50dvh] overflow-y-auto px-3 pb-2 space-y-3">
        {items.map((i) => (
          <label key={i.key} className="block">
            <span className="flex justify-between text-[11px] text-muted"><span>{i.label}</span><span className="tabular-nums text-body">{(values[i.key] ?? i.value).toFixed(digits(i.step))}</span></span>
            <input type="range" min={i.min} max={i.max} step={i.step} value={values[i.key] ?? i.value}
              onChange={(e) => set(i.key, Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label={i.label} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
        <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:text-body"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
      </div>
      {note && <p className="px-3 pb-2.5 text-[11px] text-muted" role="status">{note}</p>}
    </div>
  );
}

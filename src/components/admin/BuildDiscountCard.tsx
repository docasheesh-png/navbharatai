import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Percent } from 'lucide-react';
import { adminGet, adminFailed, adminHeaders } from '../../lib/adminFetch';

/**
 * THE BUILD DISCOUNT — one number the admin sets, taken off every charged build.
 *
 * Admin 2026-09-25: *"agar admin discount = 0% (default) set kar to abhi jaise chal raha hai, baise
 * hi chale. agar admin discount = yy% fix kar de to, har build me likh kar aye … green colour me"*,
 * and, asked where the number should live: a box in the admin panel.
 *
 * 🔒 The card says the two rules that make the number safe to type, because a setting whose limits
 * are only in the code is a setting its owner can be surprised by: the bill never goes below what the
 * build really cost us, and a build already charged at cost gets no discount at all
 * (`src/server/lib/buildDiscount.ts`).
 *
 * ⚠️ Every call goes through `adminFetch`'s header helper — an admin route authenticates on that
 * header and nothing else (`tests/adminFetch.test.ts`).
 */
interface Setting {
  ok: boolean;
  pct: number;
  updatedAt: number | null;
  maxPct: number;
  cacheSeconds: number;
}

export function BuildDiscountCard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [setting, setSetting] = useState<Setting | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const r = await adminGet<Setting>('/api/admin/build-discount', { token: adminToken });
    if (adminFailed(r)) setError(r.message);
    else {
      setSetting(r.data);
      setDraft(String(r.data.pct));
    }
    setLoading(false);
  }, [adminToken]);

  useEffect(() => { void load(); }, [load]);

  const maxPct = setting?.maxPct ?? 50;
  const draftNum = Number(draft.trim().replace(/%$/, ''));
  const draftValid = draft.trim() !== '' && Number.isFinite(draftNum) && draftNum >= 0 && draftNum <= maxPct;
  const draftPct = draftValid ? Math.round(draftNum) : 0;
  const unchanged = setting !== null && draftValid && draftPct === setting.pct;

  const save = async () => {
    if (!draftValid) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/admin/build-discount', {
        method: 'POST',
        headers: { ...adminHeaders(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct: draftPct }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'The discount could not be saved.');
      setSetting(json);
      setDraft(String(json.pct));
      setSaved(true);
    } catch (e) {
      setError((e as Error)?.message || 'The discount could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const example = 100;
  const examplePay = example * (1 - draftPct / 100);

  return (
    <div className="rounded-xl border border-line bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Percent className="h-4 w-4 shrink-0 text-success" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">Build discount</h3>
          <p className="text-[11px] leading-snug text-muted">
            Taken off every charged build and shown to the user in green under their bill. 0% charges
            exactly as before. The bill never goes below what the build really cost us, so a build
            already charged at cost gets no discount.
          </p>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] leading-snug text-danger">
          <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
        </p>
      )}

      {loading && !setting && (
        <p className="flex items-center gap-2 text-[11px] text-faint">
          <Loader2 size={12} className="animate-spin" /> Reading the current discount…
        </p>
      )}

      {setting && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor="build-discount-pct" className="flex flex-col gap-1 text-[11px] text-muted">
              Discount (0–{maxPct}%)
              <div className="flex items-center gap-1">
                <input
                  id="build-discount-pct"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={maxPct}
                  step={1}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
                  className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
                <span className="text-sm text-body">%</span>
              </div>
            </label>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!draftValid || unchanged || saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <span className="text-[11px] text-faint">Now: {setting.pct}%</span>
          </div>

          {!draftValid && (
            <p className="text-[11px] text-danger">Enter a whole number from 0 to {maxPct}.</p>
          )}

          {draftValid && draftPct > 0 && (
            <p className="text-[11px] leading-snug text-success">
              Example: a ₹{example} build → Discount {draftPct}% (−₹{(example - examplePay).toFixed(0)}) → user pays ₹{examplePay.toFixed(0)}
            </p>
          )}

          {saved && (
            <p className="flex items-center gap-1.5 text-[11px] text-success">
              <CheckCircle2 size={12} /> Saved. Every server picks it up within {setting.cacheSeconds} seconds.
            </p>
          )}
        </>
      )}
    </div>
  );
}

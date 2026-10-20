import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, Plus, RefreshCw, Trash2, Pencil, Loader2, ImagePlus, X } from 'lucide-react';
import {
  HOUSE_AD_DESCRIPTION_MAX, HOUSE_AD_NAME_MAX, HOUSE_AD_PLACEMENTS, PLACEMENT_INFO, cleanHttpsLink,
  type HouseAdPlacement, type ServedHouseAd,
} from '../../lib/houseAds';
import {
  STATUS_VIEW, adBodyFromForm, emptyForm, fmtDate, lastDayShown, toDateInput, type AdRow, type FormState,
} from '../../lib/houseAdForm';
import { cropToAdBanner } from '../../lib/houseAdImage';
import { SponsoredBanner, SponsoredTile } from '../ads/SponsoredAd';

/**
 * ADS — the admin's own products, shown to people who have not paid (admin 2026-10-20: "admin panel me ads ka
 * option banao! jahan admin apne kisi saman ka ads chala sake — naam, description aur photo upload kare, aur
 * user ko woh ads dikhne lage").
 *
 * Real data only. The rows come from GET /api/admin/ads, a save is "saved" only after the server answers OK, and
 * the status chip is computed on the server by the SAME rule the public list applies — so this table cannot say
 * "Live" about an ad nobody is shown. A list that could not be read says so; an empty table over a failed read
 * would tell the admin the opposite of the truth.
 *
 * The preview is the real components (`SponsoredBanner`, `SponsoredTile`) fed the picture that will be stored.
 *
 * Own products only: the Privacy Policy says NavBharatAI shows no THIRD-PARTY advertising inside the product, and
 * that stays true only while every ad here is the operator's own. The form says so.
 */

export function AdsPanel({ headers }: { headers: Record<string, string> }) {
  const [ads, setAds] = useState<AdRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const r = await fetch('/api/admin/ads', { headers });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !Array.isArray(d.ads)) { setLoadError(d?.error || 'Could not load the ads.'); return; }
      setAds(d.ads as AdRow[]);
    } catch {
      setLoadError('Could not reach the server to load the ads.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => { setForm(emptyForm()); setFormError(''); setNotice(''); };
  const openEdit = (a: AdRow) => {
    setForm({
      editingId: a.id, name: a.name, description: a.description, linkUrl: a.linkUrl ?? '', placements: [...a.placements],
      enabled: a.enabled, startDate: toDateInput(a.startsAt),
      // The stored end is the next midnight after the last day shown; the form shows that last day.
      endDate: a.endsAt === null ? '' : toDateInput(lastDayShown(a.endsAt)),
      imageDataUrl: null, previewUrl: a.imageUrl,
    });
    setFormError(''); setNotice('');
  };

  const pickFile = async (file: File | undefined) => {
    if (!file || !form) return;
    setImageBusy(true); setFormError('');
    try {
      const out = await cropToAdBanner(file);
      if (out.ok === false) { setFormError(out.error); return; }
      setForm((f) => (f ? { ...f, imageDataUrl: out.dataUrl, previewUrl: out.dataUrl } : f));
    } finally {
      setImageBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const togglePlacement = (p: HouseAdPlacement) =>
    setForm((f) => (f ? { ...f, placements: f.placements.includes(p) ? f.placements.filter((x) => x !== p) : HOUSE_AD_PLACEMENTS.filter((x) => x === p || f.placements.includes(x)) } : f));

  const save = async () => {
    if (!form) return;
    setFormError('');
    if (form.linkUrl.trim() && !cleanHttpsLink(form.linkUrl)) {
      setFormError('The link must be a full https:// address, for example https://yourshop.in/offer.'); return;
    }
    setBusy(true);
    try {
      const url = form.editingId ? `/api/admin/ads/${encodeURIComponent(form.editingId)}` : '/api/admin/ads';
      const r = await fetch(url, { method: form.editingId ? 'PUT' : 'POST', headers, body: JSON.stringify(adBodyFromForm(form)) });
      const d = await r.json().catch(() => ({}));
      // "Saved" only after the server says so.
      if (!r.ok) { setFormError(d?.error || `Could not save the ad (error ${r.status}).`); return; }
      setForm(null);
      setNotice(form.editingId ? 'Ad updated. It can take up to a minute to reach every user.' : 'Ad created. It can take up to a minute to reach every user.');
      await load();
    } catch {
      setFormError('Could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (a: AdRow, enabled: boolean) => {
    setBusy(true); setNotice('');
    try {
      const r = await fetch(`/api/admin/ads/${encodeURIComponent(a.id)}`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          name: a.name, description: a.description, linkUrl: a.linkUrl, placements: a.placements,
          enabled, startsAt: a.startsAt, endsAt: a.endsAt,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice(d?.error || 'Could not change the ad.'); return; }
      setNotice(enabled ? 'Ad turned on.' : 'Ad turned off. It can take up to a minute to disappear for every user.');
      await load();
    } catch {
      setNotice('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: AdRow) => {
    if (!window.confirm(`Delete the ad "${a.name}"? Users stop seeing it within a minute. This cannot be undone.`)) return;
    setBusy(true); setNotice('');
    try {
      const r = await fetch(`/api/admin/ads/${encodeURIComponent(a.id)}`, { method: 'DELETE', headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice(d?.error || 'Could not delete the ad.'); return; }
      setNotice('Ad deleted.');
      await load();
    } catch {
      setNotice('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const preview: ServedHouseAd | null = useMemo(() => {
    if (!form || !form.previewUrl || !form.name.trim() || !form.description.trim()) return null;
    return { id: 'preview', name: form.name.trim(), description: form.description.trim(), linkUrl: cleanHttpsLink(form.linkUrl), imageUrl: form.previewUrl };
  }, [form]);

  const field = 'w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-accent';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-faint mb-1.5';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="flex items-start gap-3">
          <Megaphone size={18} className="text-accent-text shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-ink uppercase tracking-tight">Ads</h3>
            <p className="text-xs text-muted leading-relaxed mt-1">
              Show your own products to people who have not paid. Paid accounts, and anyone with an active hosting plan, never see an ad. An
              ad appears only where you tick below, and always carries a "Sponsored" label. There is no outside ad network here, so use this for
              your own goods only. A change can take up to a minute to reach every user.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh the ads" className="p-2 rounded-lg bg-raised hover:bg-raised-hover text-muted disabled:opacity-60">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={openNew} disabled={!!form} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent hover:opacity-90 text-on-accent text-xs font-bold disabled:opacity-60">
              <Plus size={13} /> New ad
            </button>
          </div>
        </div>
        {notice && <p role="status" className="mt-3 text-xs text-body bg-raised rounded-lg px-3 py-2">{notice}</p>}
      </div>

      {form && (
        <div className="rounded-2xl border border-line bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-ink">{form.editingId ? 'Edit ad' : 'New ad'}</h4>
            <button type="button" onClick={() => setForm(null)} aria-label="Close the form" className="p-1.5 rounded-lg text-muted hover:text-ink"><X size={15} /></button>
          </div>

          <div>
            <label className={label} htmlFor="ad-name">Name <span className="normal-case font-normal text-faint">({form.name.length}/{HOUSE_AD_NAME_MAX})</span></label>
            <input id="ad-name" className={field} value={form.name} maxLength={HOUSE_AD_NAME_MAX} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your product or offer" />
          </div>

          <div>
            <label className={label} htmlFor="ad-desc">Description <span className="normal-case font-normal text-faint">({form.description.length}/{HOUSE_AD_DESCRIPTION_MAX})</span></label>
            <textarea id="ad-desc" rows={2} className={field} value={form.description} maxLength={HOUSE_AD_DESCRIPTION_MAX} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One or two short lines about it" />
          </div>

          <div>
            <label className={label} htmlFor="ad-link">Link (optional)</label>
            <input id="ad-link" className={field} value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://yourshop.in/offer" inputMode="url" />
            <p className="text-[11px] text-faint mt-1">Where a tap goes. Leave it empty and the ad is just a picture and text.</p>
          </div>

          <div>
            <span className={label}>Picture</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={imageBusy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-raised hover:bg-raised-hover text-xs font-semibold text-body disabled:opacity-60">
              {imageBusy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {form.previewUrl ? 'Change the picture' : 'Choose a picture'}
            </button>
            <p className="text-[11px] text-faint mt-1">Best size is 1200 × 300 (a wide strip). Any other shape is cut to the middle, and the preview below is exactly what users will see.</p>
          </div>

          <div>
            <span className={label}>Where it appears</span>
            <div className="space-y-1.5">
              {HOUSE_AD_PLACEMENTS.map((p) => (
                <label key={p} className="flex items-start gap-2 text-xs text-body cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={form.placements.includes(p)} onChange={() => togglePlacement(p)} />
                  <span><span className="font-semibold text-ink">{PLACEMENT_INFO[p].label}</span> — {PLACEMENT_INFO[p].where}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="ad-start">Show from (optional)</label>
              <input id="ad-start" type="date" className={field} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="ad-end">Show until, including this day (optional)</label>
              <input id="ad-end" type="date" className={field} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-body cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span><span className="font-semibold text-ink">Turned on.</span> Untick to save it without showing it yet.</span>
          </label>

          {preview ? (
            <div className="rounded-xl bg-well p-3 space-y-3">
              <p className={label}>Preview</p>
              <SponsoredBanner placement="dashboard" ad={preview} />
              <div className="max-w-[180px]"><SponsoredTile ad={preview} /></div>
            </div>
          ) : (
            <p className="text-[11px] text-faint">The preview appears once there is a name, a description and a picture.</p>
          )}

          {formError && <p role="alert" className="text-xs text-danger bg-raised rounded-lg px-3 py-2">{formError}</p>}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setForm(null)} className="px-3 py-2 rounded-lg text-xs text-muted hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:opacity-90 text-on-accent text-xs font-bold disabled:opacity-60">
              {busy && <Loader2 size={13} className="animate-spin" />} {form.editingId ? 'Save changes' : 'Create ad'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-card p-4">
        {loadError ? (
          <p role="alert" className="text-xs text-danger">{loadError}</p>
        ) : ads === null ? (
          <p className="flex items-center gap-2 text-xs text-faint"><Loader2 size={13} className="animate-spin" /> Loading ads…</p>
        ) : ads.length === 0 ? (
          <p className="text-xs text-muted">No ads yet. Choose "New ad" to add your first one. Until then, nobody sees an ad anywhere.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ads.map((a) => {
              const st = STATUS_VIEW[a.status];
              return (
                <li key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <img src={a.imageUrl} alt="" width={160} height={40} className="w-full sm:w-40 aspect-[4/1] object-cover rounded-lg bg-raised shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink truncate">
                      {a.name} <span className={`ml-1 text-[10px] font-black uppercase tracking-wide ${st.tone}`}>{st.label}</span>
                    </p>
                    <p className="text-xs text-muted line-clamp-2">{a.description}</p>
                    <p className="text-[11px] text-faint mt-0.5">
                      {a.placements.map((p) => PLACEMENT_INFO[p].label).join(' · ')}
                      {(a.startsAt !== null || a.endsAt !== null) && ` · ${a.startsAt !== null ? `from ${fmtDate(a.startsAt)}` : ''}${a.startsAt !== null && a.endsAt !== null ? ' ' : ''}${a.endsAt !== null ? `until ${fmtDate(lastDayShown(a.endsAt))}` : ''}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" onClick={() => void setEnabled(a, !a.enabled)} disabled={busy} className="px-2.5 py-1.5 rounded-lg bg-raised hover:bg-raised-hover text-[11px] font-semibold text-body disabled:opacity-60">
                      {a.enabled ? 'Turn off' : 'Turn on'}
                    </button>
                    <button type="button" onClick={() => openEdit(a)} disabled={busy || !!form} aria-label={`Edit ${a.name}`} className="p-2 rounded-lg bg-raised hover:bg-raised-hover text-muted disabled:opacity-60"><Pencil size={13} /></button>
                    <button type="button" onClick={() => void remove(a)} disabled={busy} aria-label={`Delete ${a.name}`} className="p-2 rounded-lg bg-raised hover:bg-raised-hover text-danger disabled:opacity-60"><Trash2 size={13} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AdsPanel;

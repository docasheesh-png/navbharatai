/**
 * THE LOAD BOARD — every ceiling in the platform, as one number, on the admin's home page.
 *
 * The admin asked for this directly: *"admin panel ke home page par to load dikhna chahiye — server
 * load, user load, storage load, hosting load… sabhi load likhne hai."* `/api/admin/load` has
 * answered that question since ROADMAP §12 shipped, and NOTHING rendered it — a ceiling nobody can
 * see is a hope, not a trigger, and an API with no screen is the "built but not really working"
 * state the second absolute rule forbids.
 *
 * 🔒 THE ONE RULE THIS SCREEN LIVES OR DIES BY: an UNKNOWN tile must never look like a healthy one.
 * A dashboard whose reading failed and a platform with plenty of headroom are both "not red", and
 * collapsing them is how a capacity board becomes reassurance. `loadBoard()` already refuses to turn
 * absence into zero; this renders that refusal — an unread ceiling is grey, says "not measured", and
 * is named again underneath so it cannot be mistaken for a quiet one.
 *
 * The hosting checks below are DELIBERATELY on a button. They make real Google API calls against the
 * apps project, they matter only while hosting is being switched on, and firing them on every visit
 * to the home page would spend quota to render a line that says "not switched on".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle, CheckCircle2, HelpCircle, Server } from 'lucide-react';

type LoadLevel = 'ok' | 'warn' | 'critical' | 'full' | 'unknown';

interface LoadTile {
  id: string;
  label: string;
  level: LoadLevel;
  value: number | null;
  cap: number | null;
  display: string;
  note: string;
}

interface LoadResponse {
  level: LoadLevel;
  tiles: LoadTile[];
  unknown: string[];
}

interface PreflightCheck {
  id: string;
  label: string;
  state: 'ok' | 'missing' | 'unknown' | string;
  detail?: string;
  remedy?: string;
}

interface PreflightResponse {
  verdict: string;
  projectId: string | null;
  region: string;
  checks: PreflightCheck[];
  nextAction?: string;
}

interface ServicesResponse {
  available: boolean;
  reason?: string;
  message?: string;
  project?: string;
  region?: string;
  capacity?: { used: number; cap: number; remaining: number; level: 'ok' | 'warn' | 'critical'; message: string };
  warning?: string;
}

/** Tone per level. `unknown` is grey on purpose — see the header; it must never read as healthy. */
const TONE: Record<LoadLevel, { dot: string; ring: string; text: string; chip: string }> = {
  ok: { dot: 'bg-emerald-500', ring: 'border-white/10', text: 'text-emerald-400', chip: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
  warn: { dot: 'bg-amber-500', ring: 'border-amber-500/30', text: 'text-amber-400', chip: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  critical: { dot: 'bg-red-500', ring: 'border-red-500/30', text: 'text-red-400', chip: 'bg-red-500/10 border-red-500/30 text-red-400' },
  full: { dot: 'bg-red-600', ring: 'border-red-500/50', text: 'text-red-400', chip: 'bg-red-500/15 border-red-500/50 text-red-300' },
  unknown: { dot: 'bg-white/25', ring: 'border-white/10', text: 'text-[#8b949e]', chip: 'bg-white/5 border-white/10 text-[#8b949e]' },
};

const LEVEL_WORD: Record<LoadLevel, string> = {
  ok: 'Room to spare',
  warn: 'Getting full',
  critical: 'Nearly full',
  full: 'At the ceiling',
  unknown: 'Not measured',
};

/**
 * The headline sentence. PURE, and exported so its honesty is testable without a browser.
 *
 * 🔒 "All clear" is only ever said when every ceiling was actually READ. A board with three green
 * tiles and four unreadable ones is not a healthy platform — it is a platform we cannot see.
 */
export function loadHeadline(data: LoadResponse | null, error: string): string {
  if (error) return 'The load board could not be read — the ceilings are UNKNOWN, not clear.';
  if (!data || !Array.isArray(data.tiles) || data.tiles.length === 0) return 'No ceilings reported yet.';
  const unknown = data.tiles.filter((t) => t.level === 'unknown').length;
  const bad = data.tiles.filter((t) => t.level === 'warn' || t.level === 'critical' || t.level === 'full');
  if (bad.length > 0) {
    const names = bad.map((t) => t.label).join(', ');
    return `${bad.length} ceiling${bad.length > 1 ? 's' : ''} need${bad.length > 1 ? '' : 's'} attention: ${names}.`;
  }
  if (unknown > 0) {
    return `${data.tiles.length - unknown} of ${data.tiles.length} ceilings have room; ${unknown} could not be measured, so this is not an all-clear.`;
  }
  return `All ${data.tiles.length} ceilings measured and have room.`;
}

export function LoadBoard({ adminToken }: { adminToken: string }): React.ReactElement {
  const [data, setData] = useState<LoadResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [hostingOpen, setHostingOpen] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [services, setServices] = useState<ServicesResponse | null>(null);
  const [hostingError, setHostingError] = useState('');
  const [hostingLoading, setHostingLoading] = useState(false);

  const fetchLoad = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/load', { headers: { 'x-admin-token': adminToken } });
      const d = await r.json();
      if (Array.isArray(d?.tiles)) { setData(d); setError(''); }
      // A failed read is NOT an empty board. Keep whatever was last known and say the read failed.
      else { setError(d?.error || 'The load board could not be read — the ceilings are UNKNOWN, not clear.'); }
    } catch {
      setError('The load board could not be read — the ceilings are UNKNOWN, not clear.');
    } finally { setLoading(false); }
  }, [adminToken]);

  useEffect(() => { void fetchLoad(); }, [fetchLoad]);

  const fetchHosting = useCallback(async () => {
    setHostingLoading(true);
    setHostingError('');
    try {
      const headers = { 'x-admin-token': adminToken };
      const [pf, sv] = await Promise.all([
        fetch('/api/admin/hosting/preflight', { headers }).then((r) => r.json()).catch(() => null),
        fetch('/api/admin/hosting/services', { headers }).then((r) => r.json()).catch(() => null),
      ]);
      setPreflight(pf && Array.isArray(pf.checks) ? pf : null);
      setServices(sv && typeof sv.available === 'boolean' ? sv : null);
      if (!pf && !sv) setHostingError('Neither hosting check could be read.');
    } catch {
      setHostingError('Neither hosting check could be read.');
    } finally { setHostingLoading(false); }
  }, [adminToken]);

  const openHosting = useCallback(() => {
    setHostingOpen((was) => {
      if (!was) void fetchHosting();
      return !was;
    });
  }, [fetchHosting]);

  const tiles = data?.tiles ?? [];
  const worst = error ? 'unknown' : (data?.level ?? 'unknown');
  const tone = TONE[worst] ?? TONE.unknown;
  const unreadable = tiles.filter((t) => t.level === 'unknown');

  return (
    <div className={`rounded-[1.5rem] p-6 border bg-[#161b22] ${tone.ring}`}>
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-black text-white uppercase tracking-tight">Platform Load</h3>
          <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${tone.chip}`}>
            {LEVEL_WORD[worst] ?? 'Not measured'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void fetchLoad()}
          disabled={loading}
          className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <p className="text-[11px] text-[#8b949e] font-semibold mb-4">{loadHeadline(data, error)}</p>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 mb-4">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#8b949e] font-semibold">{error}</p>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map((t) => {
            const tt = TONE[t.level] ?? TONE.unknown;
            return (
              <div key={t.id} className={`rounded-xl border bg-[#0d1117] p-4 ${tt.ring}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${tt.dot}`} />
                  <span className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">{t.label}</span>
                </div>
                <div className={`text-lg font-black ${tt.text}`}>
                  {/* The route's own display string, so the screen can never disagree with the API
                      about what was measured — an unread ceiling reads "unknown", never "0". */}
                  {t.display}
                </div>
                <p className="text-[10px] text-[#8b949e] font-semibold mt-1.5 leading-snug">{t.note}</p>
              </div>
            );
          })}
        </div>
      )}

      {unreadable.length > 0 && (
        // Named a SECOND time, deliberately. A grey tile in a grid of green ones is easy to read past,
        // and "we could not see this ceiling" is the one thing on this screen that must not be missed.
        <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 mt-4">
          <HelpCircle className="w-3.5 h-3.5 text-[#8b949e] shrink-0 mt-0.5" />
          <p className="text-[10px] text-[#8b949e] font-semibold">
            <span className="text-white">Not measured:</span> {unreadable.map((t) => t.label).join(', ')}.
            These are unknown, not clear — a ceiling that could not be read may already be full.
          </p>
        </div>
      )}

      {/* ── HOSTING, on demand ─────────────────────────────────────────────────────────────────
          Real Google API calls against the apps project, and only meaningful while hosting is being
          switched on — so they run when asked, never on every home-page visit. */}
      <div className="mt-5 pt-4 border-t border-white/5">
        <button
          type="button"
          onClick={openHosting}
          className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-colors"
        >
          <Server className="w-3 h-3" />
          {hostingOpen ? 'Hide app-hosting checks' : 'Check app hosting setup'}
        </button>

        {hostingOpen && (
          <div className="mt-3 space-y-3">
            {hostingLoading && (
              <p className="text-[10px] text-[#8b949e] font-semibold">Running the same calls a real publish makes…</p>
            )}
            {hostingError && (
              <p className="text-[10px] text-amber-400 font-semibold">{hostingError}</p>
            )}

            {services && (
              <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4">
                <div className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest mb-1.5">Hosted services</div>
                {!services.available ? (
                  // Not an error and not "zero used" — hosting simply is not switched on.
                  <p className="text-[10px] text-[#8b949e] font-semibold">
                    {services.message || 'App hosting is not switched on, so there is nothing to count.'}
                  </p>
                ) : (
                  <>
                    <div className="text-lg font-black text-white">
                      {services.capacity ? `${services.capacity.used} / ${services.capacity.cap}` : '—'}
                    </div>
                    <p className="text-[10px] text-[#8b949e] font-semibold mt-1">
                      {services.capacity?.message || 'Capacity could not be summarised.'}
                    </p>
                    {services.warning && (
                      <p className="text-[10px] text-amber-400 font-semibold mt-1.5">{services.warning}</p>
                    )}
                  </>
                )}
              </div>
            )}

            {preflight && (
              <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">Setup check</span>
                  <span className="text-[9px] font-black uppercase text-[#8b949e]">
                    {preflight.projectId || 'no project configured'}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {preflight.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      {c.state === 'ok'
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
                      <div>
                        <p className="text-[10px] font-bold text-white">{c.label}</p>
                        {c.detail && <p className="text-[10px] text-[#8b949e] font-semibold">{c.detail}</p>}
                        {c.state !== 'ok' && c.remedy && (
                          <p className="text-[10px] text-indigo-300 font-semibold">{c.remedy}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {preflight.nextAction && (
                  <p className="text-[10px] text-white font-bold mt-2.5">Next: {preflight.nextAction}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

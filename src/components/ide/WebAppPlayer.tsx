import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Share2, Flag, Lock, Check, Sparkles } from 'lucide-react';
import { authedHeaders } from '../../App';
import { ashokChakraSvg } from '../../lib/ashokChakra';
import { auth } from '../../lib/firebase';
import { clientWorkspaceId, v3SessionStorageKey } from '../agentv3/v3SessionContinuity';

// WEB APP PLAYER — a store app running FULL SCREEN in the viewer's own browser (Kadam 1).
//
// The native feel the admin asked for ("other user ke phone me full screen par native app jaisa feel
// aye, preview jaisa nahi"): the player covers the viewport, carries only a slim top bar with the
// app's own name, and the app fills everything else. No NavBharatAI chrome around the content.
//
// ── THE SECURITY LINE THIS FILE MUST HOLD ────────────────────────────────────────────────────────
// The iframe sandbox DELIBERATELY OMITS `allow-same-origin`. A store app is a STRANGER'S code running
// in the viewer's browser; with allow-same-origin on a srcDoc iframe it would inherit THIS page's
// origin and could read the viewer's localStorage — their Firebase session included. Without it the
// frame gets an OPAQUE origin and can touch nothing of the platform's.
//
// The in-browser PREVIEW keeps allow-same-origin and that is fine THERE: the code it frames is the
// viewer's own app. The trust question is different in a store, so the sandbox is different.
//
// "But modules break without allow-same-origin" — that was true once and is the reason the preview's
// comment says so; it is NOT true here, and this was PROVEN in a real Chromium before this file was
// written (2026-08-15): a sandbox="allow-scripts" srcdoc iframe successfully dynamic-import()s a
// module served with `Access-Control-Allow-Origin: *` — which /api/esm/* sends — and fails without
// the header. The player page inlines its compiler and loads dependencies only from that mirror, so
// the opaque origin costs nothing.
const PLAYER_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals';

interface PlayerMeta {
  id: string;
  name: string;
  description: string;
  requiresPassword: boolean;
  /** Remix price in whole rupees; 0 = free. */
  priceInr?: number;
}

export interface WebAppPlayerProps {
  appId: string;
  onClose: () => void;
}

export const WebAppPlayer: React.FC<WebAppPlayerProps> = ({ appId, onClose }) => {
  const [meta, setMeta] = useState<PlayerMeta | null>(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shared, setShared] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportDone, setReportDone] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const open = useCallback(async (pw?: string) => {
    setOpening(true);
    setError('');
    try {
      const res = await fetch(`/api/nav-store/web/app/${encodeURIComponent(appId)}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pw ? { password: pw } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!liveRef.current) return;
      if (res.status === 401 && data?.requiresPassword) {
        // First open of a private app arrives here without a password — that is the normal path to
        // the prompt, not an error worth alarming anyone with. A WRONG password (pw was given) is.
        setNeedsPassword(true);
        if (pw) setError('That password is wrong.');
        return;
      }
      if (!res.ok || typeof data?.html !== 'string') {
        setError(data?.error || 'This app could not be opened.');
        return;
      }
      setHtml(data.html);
      setNeedsPassword(false);
    } catch {
      if (liveRef.current) setError('Could not reach the store. Check your connection and try again.');
    } finally {
      if (liveRef.current) setOpening(false);
    }
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/nav-store/web/app/${encodeURIComponent(appId)}`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.app) {
          setError(data?.error || 'This app is not on the store.');
          return;
        }
        setMeta(data.app as PlayerMeta);
        // Public apps open immediately; private ones wait for the password rather than burning a
        // guaranteed-401 round trip.
        if ((data.app as PlayerMeta).requiresPassword) setNeedsPassword(true);
        else void open();
      } catch {
        if (!cancelled) setError('Could not reach the store.');
      }
    })();
    return () => { cancelled = true; };
  }, [appId, open]);

  const share = useCallback(() => {
    // The share link is the store page itself — opening it lands the receiver right here.
    const url = `${window.location.origin}/store/app/${encodeURIComponent(appId)}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setShared(true);
      setTimeout(() => { if (liveRef.current) setShared(false); }, 1600);
    }).catch(() => { /* clipboard denied — the URL bar still has it via the deep link */ });
  }, [appId]);

  /**
   * REMIX — the viewer becomes a creator in one tap (Kadam 2).
   *
   * A fresh v5 session id is minted HERE, the server copies the published snapshot into the derived
   * workspace, the sticky-session key is pointed at it, and the page reloads into v5 — which then
   * opens exactly as if the user had been working on this app all along (the durable files are the
   * same store every v5 surface reads). Works signed-out too: an anon workspace is owned by its
   * unguessable sid, the same capability model v5 itself uses.
   */
  const [remixing, setRemixing] = useState(false);
  /**
   * PAID REMIX (Kadam 3): the price and NON-REFUNDABLE are shown BEFORE any money moves — on the
   * confirm sheet, not in fine print after. The fairness that makes non-refundable honest is stated
   * right there: the viewer has the whole app free to use before deciding.
   */
  const [confirmingBuy, setConfirmingBuy] = useState(false);
  const price = meta?.priceInr ?? 0;
  const remix = useCallback(async () => {
    if (remixing) return;
    setRemixing(true);
    try {
      const sid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const uid = auth.currentUser?.uid;
      const target = clientWorkspaceId(uid, sid);
      const res = await fetch(`/api/nav-store/web/app/${encodeURIComponent(appId)}/remix`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        // A private app's remix needs the same password its open did — reuse what the viewer typed.
        body: JSON.stringify({ targetWorkspaceId: target, ...(password ? { password } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'The remix failed — nothing was copied.');
        return;
      }
      // Point the sticky session at the new workspace (same fallback order the panel itself uses),
      // then reload into v5. The files are already durably there; v5 simply opens "their" app.
      const key = v3SessionStorageKey(uid);
      try { localStorage.setItem(key, sid); } catch { try { sessionStorage.setItem(key, sid); } catch { /* both blocked */ } }
      try { sessionStorage.setItem('nbi_v3_open', '1'); } catch { /* view falls back to home */ }
      window.location.href = '/';
    } catch {
      if (liveRef.current) setError('Could not reach the store. Check your connection and try again.');
    } finally {
      if (liveRef.current) setRemixing(false);
    }
  }, [appId, password, remixing]);

  const sendReport = useCallback(async () => {
    if (reportText.trim().length < 5) return;
    try {
      const res = await fetch(`/api/nav-store/web/app/${encodeURIComponent(appId)}/report`, {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason: reportText.trim() }),
      });
      if (res.ok) {
        setReportDone(true);
        setTimeout(() => { if (liveRef.current) { setReporting(false); setReportDone(false); setReportText(''); } }, 1400);
      }
    } catch { /* the dialog stays open; the user can retry */ }
  }, [appId, reportText]);

  return (
    <div className="fixed inset-0 z-[90] bg-[#0d1117] flex flex-col">
      {/* Slim bar — the only NavBharatAI chrome. The app owns the rest of the screen. */}
      <div className="flex items-center gap-2 px-3 h-11 border-b border-white/10 bg-[#0d1117] flex-shrink-0">
        <span className="text-sm font-semibold text-white truncate flex-1">{meta?.name || 'Loading…'}</span>
        {html && (
          <button
            onClick={() => (price > 0 ? setConfirmingBuy(true) : void remix())}
            disabled={remixing}
            title="Copy this app into your own NavBharatAI and change it however you like"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
          >
            <Sparkles size={12} /> {remixing ? 'Copying…' : price > 0 ? `₹${price} · Make it yours` : 'Make it yours'}
          </button>
        )}
        <button onClick={share} title="Copy the app's link" className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors">
          {shared ? <Check size={15} className="text-emerald-400" /> : <Share2 size={15} />}
        </button>
        <button onClick={() => setReporting(true)} title="Report this app" className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors">
          <Flag size={15} />
        </button>
        <button onClick={onClose} title="Close" className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* The app itself */}
      <div className="flex-1 min-h-0 relative">
        {html ? (
          <iframe
            title={meta?.name || 'App'}
            srcDoc={html}
            className="w-full h-full border-0 bg-white"
            sandbox={PLAYER_SANDBOX}
          />
        ) : needsPassword ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="w-full max-w-xs text-center">
              <Lock size={22} className="mx-auto mb-3 text-white/30" />
              <p className="text-sm text-white mb-1 font-medium">This app is private</p>
              <p className="text-xs text-white/50 mb-4">Enter the password its creator set.</p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && password) void open(password); }}
                autoFocus
                className="w-full bg-[#161b22] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 mb-2"
                placeholder="Password"
              />
              {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}
              <button
                onClick={() => void open(password)}
                disabled={!password || opening}
                className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {opening ? 'Opening…' : 'Open app'}
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm text-white/80 mb-3">{error}</p>
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-white transition-colors">Back to the store</button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 animate-spin" style={{ animationDuration: '1.6s' }} dangerouslySetInnerHTML={{ __html: ashokChakraSvg(40, '#4f6ef7') }} />
            <p className="text-xs text-white/40">Opening the app…</p>
          </div>
        )}

        {/* Paid-remix confirm — price and NON-REFUNDABLE stated BEFORE the purchase, never after. */}
        {confirmingBuy && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-6" onClick={() => setConfirmingBuy(false)}>
            <div className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold text-white mb-1">Make “{meta?.name}” yours — ₹{price}</p>
              <p className="text-xs text-white/60 leading-relaxed mb-2">
                You get the full app in your own NavBharatAI, to change and build on however you like.
                Paid from your wallet; most of it goes to the app&apos;s creator.
              </p>
              <p className="text-xs font-semibold text-amber-300 bg-amber-950/30 rounded-lg px-2.5 py-2 mb-3">
                Non-refundable. You can keep using the app right here for free — buy only if you want it as your own.
              </p>
              {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmingBuy(false)} className="px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white transition-colors">Not now</button>
                <button
                  onClick={() => void remix()}
                  disabled={remixing}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs text-white font-bold transition-colors"
                >{remixing ? 'Buying…' : `Buy for ₹${price}`}</button>
              </div>
            </div>
          </div>
        )}

        {/* Report dialog — small, honest, and decoupled from money: a report is the store's immune
            system (takedown path), never a refund path. */}
        {reporting && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-6" onClick={() => setReporting(false)}>
            <div className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
              {reportDone ? (
                <p className="text-sm text-emerald-400 text-center py-4">Report sent — a person will look at it.</p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white mb-1">Report this app</p>
                  <p className="text-xs text-white/50 mb-3">Say briefly what is wrong (scam, stolen work, broken, abusive…). A person reviews every report.</p>
                  <textarea
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                    rows={3}
                    className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 resize-none mb-3"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setReporting(false)} className="px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white transition-colors">Cancel</button>
                    <button onClick={() => void sendReport()} disabled={reportText.trim().length < 5} className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs text-white font-semibold transition-colors">Send report</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebAppPlayer;

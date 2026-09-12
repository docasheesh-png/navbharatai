// THE +18 SETTING (admin 2026-09-12: "setting me NSFW (+18) ka option dedo default off").
//
// Deliberately NOT a plain switch. Turning it on is a recorded CONSENT — the server stamps a date
// and writes an audit line — so the screen asks for the tick first and states exactly what is being
// agreed to. Turning it OFF is one tap with no ceremony: withdrawing consent must always be easier
// than giving it.
//
// 🔒 HIDDEN ENTIRELY IN THE ANDROID APP. Not greyed out — absent. Google Play's policy on sexual
// content is strict and this account has already taken one policy hit (see playCompliance.ts), so a
// visible-but-disabled control would still be a control the Play build advertises. The gate
// (src/lib/adultContent.ts) refuses adult content on native regardless, so this is the second layer,
// not the only one.

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { isNativeApp } from '../../lib/mobileNative';
import { adultPreferenceFrom, adultSettingAvailable, ADULT_CONFIRMATIONS, type AdultPreference } from '../../lib/adultContent';

export function AdultContentToggle(): React.ReactElement | null {
  const [pref, setPref] = useState<AdultPreference | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch('/api/profile', { headers: await authedHeaders() });
        const d = r.ok ? await r.json() : null;
        if (alive) setPref(adultPreferenceFrom(d?.adult));
      } catch {
        // 🔒 An unreadable setting shows as OFF, never as ON. This is the one flag where guessing
        // wrong in the other direction would show adult content to somebody who never asked for it.
        if (alive) setPref(adultPreferenceFrom(null));
      }
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (optedIn: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/profile/adult', {
        method: 'PUT',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ optedIn, confirmed: optedIn ? true : undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) {
        // A refusal that says nothing is how a user concludes the switch is broken.
        setError(d?.error || 'That could not be saved. Please try again.');
        return;
      }
      setPref(adultPreferenceFrom(d.adult));
      setConfirming(false);
      setTicked(false);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!adultSettingAvailable(isNativeApp())) return null;
  if (!pref) return null;   // still loading — an empty slot beats a switch that flips under the user

  const on = pref.optedIn;

  return (
    <div className="p-4 sm:p-6 bg-[#0d1117] border border-white/5 rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center gap-4 mb-3">
        <div className="w-10 h-10 shrink-0 bg-rose-500/10 rounded-xl flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">Adult content (18+)</div>
          <div className="text-[11px] text-[#8b949e] mt-0.5">
            Off by default. Turn it on to allow mature content in apps you build, and to see 18+ apps on App Mart.
          </div>
        </div>
      </div>

      {!confirming ? (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Adult content (18+)"
          disabled={busy}
          onClick={() => (on ? void save(false) : setConfirming(true))}
          className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl border bg-[#161b22] border-white/5 hover:border-white/20 transition-colors text-left disabled:opacity-60"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-black text-white uppercase tracking-widest">
              {on ? 'On' : 'Off'}
            </span>
            <span className="block text-[10px] text-[#586069] leading-relaxed mt-0.5">
              {on
                ? `Turned on${pref.optedInAt ? ` on ${pref.optedInAt.slice(0, 10)}` : ''}. Tap to turn it off.`
                : 'Tap to turn it on — you will be asked to confirm your age first.'}
            </span>
          </span>
          <span aria-hidden="true" className={`w-10 h-6 rounded-full shrink-0 p-0.5 transition-colors ${on ? 'bg-rose-600' : 'bg-[#30363d]'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
          </span>
        </button>
      ) : (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-2.5">
          {/* The sentences come from the shared rules module, so this screen cannot promise something
              the gate does not actually do — the same discipline the hosting agreement follows. */}
          <ul className="space-y-1.5">
            {ADULT_CONFIRMATIONS.map((line) => (
              <li key={line} className="text-[11px] text-[#c9d1d9] leading-relaxed flex gap-2">
                <span className="text-rose-400 shrink-0">•</span><span>{line}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2.5 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={ticked}
              onChange={(e) => setTicked(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 accent-rose-600"
            />
            <span className="text-[11px] font-semibold text-white leading-relaxed">
              I have read all of the above and I agree.
            </span>
          </label>
          {error && <p className="text-[11px] text-rose-300" role="alert">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => { setConfirming(false); setTicked(false); setError(''); }}
              className="px-3 py-1.5 rounded-lg text-[11px] text-white/60 hover:text-white transition-colors"
            >Cancel</button>
            <button
              type="button"
              disabled={!ticked || busy}
              onClick={() => void save(true)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-[11px] text-white font-bold transition-colors inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Turn it on
            </button>
          </div>
        </div>
      )}

      {error && !confirming && <p className="mt-2 text-[11px] text-rose-300" role="alert">{error}</p>}
    </div>
  );
}

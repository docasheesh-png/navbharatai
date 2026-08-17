/**
 * "Update available" — the banner an installed Android build shows when a newer one is on Play.
 *
 * The app runs in BUNDLED mode, so an installed copy keeps its own frozen frontend forever: without
 * this, a user can sit on a months-old build indefinitely while every server-side improvement lands
 * around them, and nothing ever tells them.
 *
 * ALL OF THE DECISION LOGIC IS IN src/lib/appUpdate.ts AND IS PURE — this component only renders what
 * that decided. That split is deliberate: the rules that protect the banner's credibility (never guess,
 * never nag, forcing is a separate decision) are the part worth testing exhaustively, and they should
 * not be entangled with React.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { decideUpdate, updateMessage, parseStoreVersion, type UpdateVerdict } from '../lib/appUpdate';
import { openAppStoreForUpdate } from '../lib/mobileNative';

const DISMISS_KEY = 'nb_update_dismissed';

type Dismissal = { code: number; at: number };

function readDismissal(): Dismissal | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.code === 'number' && typeof v?.at === 'number' ? v : null;
  } catch { return null; }
}

/**
 * Ask the native shell what build it is. Returns null on web, or whenever the plugin is unavailable —
 * and null means "no prompt", never a guess.
 */
async function installedVersionCode(): Promise<{ isNative: boolean; platform: string | null; code: number | null }> {
  try {
    const cap = (window as any).Capacitor;
    const isNative = !!cap?.isNativePlatform?.();
    if (!isNative) return { isNative: false, platform: null, code: null };
    const platform = typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : null;
    const App = cap?.Plugins?.App;
    const info = App?.getInfo ? await App.getInfo() : null;
    // `build` is the Android versionCode; it arrives as a string.
    const code = Number.parseInt(String(info?.build ?? ''), 10);
    return { isNative, platform, code: Number.isFinite(code) && code > 0 ? code : null };
  } catch {
    return { isNative: false, platform: null, code: null };
  }
}

export function UpdateBanner({ apiBase = '' }: { apiBase?: string }) {
  const [verdict, setVerdict] = useState<UpdateVerdict>({ show: false, reason: 'pending' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await installedVersionCode();
      // Skip the network call entirely on web — there is nothing to update there.
      if (!me.isNative || cancelled) return;
      let store = null;
      try {
        const res = await fetch(`${apiBase}/api/app-version`, { headers: { accept: 'application/json' } });
        store = res.ok ? parseStoreVersion(await res.json()) : null;
      } catch {
        store = null; // unreachable ⇒ no claim
      }
      if (cancelled) return;
      const d = readDismissal();
      setVerdict(decideUpdate({
        isNative: me.isNative,
        platform: me.platform,
        installedVersionCode: me.code,
        store,
        dismissedVersionCode: d?.code ?? null,
        dismissedAt: d?.at ?? null,
        now: Date.now(),
      }));
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  const dismiss = useCallback(() => {
    if (!verdict.show || verdict.forced) return; // a forced update cannot be dismissed
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ code: verdict.latest, at: Date.now() })); } catch { /* private mode */ }
    setVerdict({ show: false, reason: 'dismissed' });
  }, [verdict]);

  const open = useCallback(() => {
    if (!verdict.show) return;
    // NATIVE → open the Play Store APP directly. The old code opened `verdict.storeUrl` (the
    // https://play.google.com/… listing) through the Capacitor Browser plugin, which shows the Play
    // WEBSITE in an in-app browser tab — not the store (admin report 2026-08-16). `openAppStoreForUpdate`
    // uses the app-update plugin, then a `market://` intent, both of which land in the Play Store app.
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) { void openAppStoreForUpdate(); return; }
    // WEB → the https listing is the right thing to open in a browser.
    window.open(verdict.storeUrl, '_blank', 'noopener');
  }, [verdict]);

  if (!verdict.show) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        // Below the notch: the app owns its own insets (see nativeShellInvariants).
        top: 'calc(var(--nb-safe-top, 0px) + 8px)',
        left: 12, right: 12, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        background: 'var(--surface-card)', color: 'var(--text-body)',
        border: '1px solid #30363d', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>⬆️</span>
      <span style={{ flex: 1, fontSize: 14, lineHeight: 1.35 }}>{updateMessage(verdict)}</span>
      {!verdict.forced && (
        <button
          onClick={dismiss}
          aria-label="Dismiss update notice"
          style={{
            background: 'transparent', color: 'var(--text-muted)', border: 'none',
            fontSize: 14, cursor: 'pointer', minWidth: 44, minHeight: 44,
          }}
        >
          Later
        </button>
      )}
      <button
        onClick={open}
        style={{
          background: '#238636', color: '#fff', border: 'none',
          borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 14,
          cursor: 'pointer', minHeight: 44, // thumb-sized, per the mobile touch-target rule
        }}
      >
        Update
      </button>
    </div>
  );
}

export default UpdateBanner;

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, X } from 'lucide-react';
import { checkForAppUpdate, openAppStoreForUpdate, maybeRequestReview } from '../lib/mobileNative';

// Mobile engagement gate (admin request 2026-07-11). Rendered once inside the native app shell; a pure
// no-op on web (both native calls guard on Capacitor.isNativePlatform).
//
//   • On mount it asks the Play Store whether a newer .aab is live. If so, it shows a dismissible
//     "Update available" banner whose button deep-links to the Play listing (openAppStore).
//   • If NO update is pending, it instead considers the native rating card at a good moment
//     (maybeRequestReview handles the engagement thresholds), so the two prompts never collide.
//
// It renders nothing until/unless an update is actually available, so it adds zero visible surface on
// web or on an up-to-date install.
export const MobileEngagementGate: React.FC = () => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const updateAvailable = await checkForAppUpdate();
      if (!alive) return;
      if (updateAvailable) {
        setShowUpdate(true);
      } else {
        // No update to offer this session → it's a safe moment to ask for a rating (if earned).
        void maybeRequestReview();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!showUpdate) return null;

  const onUpdate = async (): Promise<void> => {
    setBusy(true);
    try {
      await openAppStoreForUpdate();
    } finally {
      setBusy(false);
      setShowUpdate(false);
    }
  };

  return (
    <AnimatePresence>
      {showUpdate && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed inset-x-3 bottom-3 z-[600] mx-auto max-w-md pointer-events-auto lg:inset-x-auto lg:right-4"
        >
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-indigo-500/30 backdrop-blur-xl shadow-2xl"
            style={{ background: '#161b22ee' }}
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-600/15 border border-indigo-600/25 flex items-center justify-center flex-shrink-0">
              <Download className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-white leading-tight">A new version is available</p>
              <p className="text-[10px] text-[#8b949e] leading-tight mt-0.5">Update NavBharatAI for the latest features and fixes.</p>
            </div>
            <button
              onClick={onUpdate}
              disabled={busy}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[11px] font-black uppercase tracking-widest transition-colors flex-shrink-0"
            >
              {busy ? '…' : 'Update'}
            </button>
            <button
              onClick={() => setShowUpdate(false)}
              aria-label="Dismiss update notice"
              className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

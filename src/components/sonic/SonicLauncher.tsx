// Sonic Chat launcher — the ONLY entry point into the voice experiment from inside
// NavBharatAI (Free). It renders a floating mic button and opens SonicChat in a modal.
//
// Gated on BOTH: (1) the server reporting Sonic enabled (flag + AWS creds), and (2) a
// signed-in user (admin 2026-07-13: logged-in users only, since Nova Sonic is paid). The
// server independently enforces the same auth gate on the WS, so this is UX gating, not the
// security boundary. Mounted globally in main.tsx; delete that mount + this file to unwire.

import { useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { SonicChat } from './SonicChat';

export function SonicLauncher() {
  const [enabled, setEnabled] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/sonic/status')
      .then((r) => r.json())
      .then((d) => { if (alive) setEnabled(!!d?.enabled); })
      .catch(() => { if (alive) setEnabled(false); });
    const unsub = auth.onAuthStateChanged((u) => setSignedIn(!!u));
    return () => { alive = false; unsub(); };
  }, []);

  if (!enabled || !signedIn) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Voice chat"
          title="Voice chat (experimental)"
          style={fab}
        >
          🎙️
        </button>
      )}
      {open && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={sheet}>
            <SonicChat onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

const fab: React.CSSProperties = {
  position: 'fixed', right: 20, bottom: 84, zIndex: 2147483000,
  width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg,#5b3df5,#7c3aed)', color: '#fff', fontSize: 24,
  boxShadow: '0 6px 20px rgba(91,61,245,0.45)',
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2147483001, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const sheet: React.CSSProperties = {
  background: '#fff', color: '#111', borderRadius: 16, width: '100%', maxWidth: 680,
  maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
};

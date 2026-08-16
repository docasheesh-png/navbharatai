// P-COLLAB.1 — Team invite accept gate.
//
// A team invite link is `<origin>/?join=<token>`. This self-contained component (mounted alongside
// ConsentBanner in main.tsx, NOT inside App.tsx's router) detects that query param, resolves the
// invite, and lets a signed-in user accept it — which adds them to the team and grants their role.
//
// It renders nothing on a normal load (no `?join=` param → returns null), so it has zero impact on
// the app unless an invite link was opened. Inline styles (matching ConsentBanner/RootFallback) so it
// works in any theme without depending on global CSS.

import { useEffect, useState } from 'react';

type Phase = 'hidden' | 'loading' | 'invalid' | 'ready' | 'accepting' | 'done' | 'signin' | 'error';

interface ResolvedInvite {
  valid: boolean;
  email: string;
  role: string;
  teamId: string;
  status: string;
}

function readTokenFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('join');
  } catch {
    return null;
  }
}

/** Strip the `?join=` param from the URL without a reload, so a refresh doesn't re-trigger the gate. */
function clearJoinParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

export function InviteAcceptGate() {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [invite, setInvite] = useState<ResolvedInvite | null>(null);
  const [message, setMessage] = useState<string>('');
  const [token, setToken] = useState<string>('');

  // Resolve the invite once, after mount.
  useEffect(() => {
    const t = readTokenFromUrl();
    if (!t) return;
    setToken(t);
    setPhase('loading');
    (async () => {
      try {
        const res = await fetch(`/api/team/invite/${encodeURIComponent(t)}`);
        const data = (await res.json().catch(() => null)) as ResolvedInvite | null;
        if (!res.ok || !data) {
          setPhase('invalid');
          setMessage('This invite is not available. It may have been revoked or already used.');
          return;
        }
        setInvite(data);
        if (!data.valid) {
          setPhase('invalid');
          setMessage(
            data.status === 'accepted' ? 'This invite has already been accepted.'
            : data.status === 'revoked' ? 'This invite was revoked by the team owner.'
            : 'This invite has expired.',
          );
          return;
        }
        setPhase('ready');
      } catch {
        setPhase('error');
        setMessage('Could not load this invite. Check your connection and try again.');
      }
    })();
  }, []);

  const accept = async () => {
    setPhase('accepting');
    try {
      const { getAuth } = await import('firebase/auth');
      const { getApp } = await import('firebase/app');
      const auth = getAuth(getApp());
      // Wait for auth state to restore (currentUser can be null immediately after load).
      const user = await new Promise<import('firebase/auth').User | null>((resolve) => {
        const unsub = auth.onAuthStateChanged((u) => { unsub(); resolve(u); });
      });
      if (!user) {
        setPhase('signin');
        setMessage('Please sign in to this account, then open the invite link again to accept.');
        return;
      }
      const idToken = await user.getIdToken();
      const res = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token, email: user.email || invite?.email || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPhase('done');
        setMessage(`You've joined the team as ${data.role || invite?.role || 'a member'}.`);
        clearJoinParam();
      } else {
        setPhase('error');
        setMessage(data.error || 'Could not accept the invite. It may have expired.');
      }
    } catch {
      setPhase('error');
      setMessage('Could not accept the invite right now. Please try again.');
    }
  };

  const dismiss = () => {
    clearJoinParam();
    setPhase('hidden');
  };

  if (phase === 'hidden') return null;

  const roleLabel = invite?.role ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1) : 'member';
  const busy = phase === 'loading' || phase === 'accepting';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Team invitation"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483601, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(1,4,9,0.72)', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, width: '100%', background: 'var(--surface-card)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 30, textAlign: 'center' }}>🤝</div>
        <h2 style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 800, textAlign: 'center', marginTop: 10 }}>
          {phase === 'done' ? 'Welcome to the team' : 'Team invitation'}
        </h2>

        {phase === 'ready' && invite && (
          <p style={{ color: 'var(--text-body)', fontSize: 13, lineHeight: 1.5, textAlign: 'center', marginTop: 10 }}>
            You've been invited to join a NavBharatAI team as <strong style={{ color: 'var(--text-primary)' }}>{roleLabel}</strong>
            {invite.email ? <> (for <span style={{ color: 'var(--text-muted)' }}>{invite.email}</span>)</> : null}. Accept to
            get access.
          </p>
        )}

        {(phase === 'loading' || phase === 'accepting') && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
            {phase === 'loading' ? 'Loading invitation…' : 'Joining the team…'}
          </p>
        )}

        {(phase === 'invalid' || phase === 'error' || phase === 'signin' || phase === 'done') && (
          <p style={{ color: phase === 'done' ? '#3fb950' : phase === 'signin' ? 'var(--text-body)' : '#f0883e', fontSize: 13, lineHeight: 1.5, textAlign: 'center', marginTop: 12 }}>
            {message}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          {phase === 'ready' && (
            <button
              type="button"
              onClick={accept}
              disabled={busy}
              style={{ padding: '10px 22px', background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 800, border: 'none', borderRadius: 12, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              Accept invite
            </button>
          )}
          {phase !== 'done' && (
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              style={{ padding: '10px 18px', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 12, cursor: 'pointer' }}
            >
              {phase === 'ready' ? 'Not now' : 'Close'}
            </button>
          )}
          {phase === 'done' && (
            <button
              type="button"
              onClick={() => { setPhase('hidden'); }}
              style={{ padding: '10px 22px', background: '#238636', color: '#fff', fontSize: 13, fontWeight: 800, border: 'none', borderRadius: 12, cursor: 'pointer' }}
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default InviteAcceptGate;

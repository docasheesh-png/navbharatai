// P-COLLAB.3 — Client / Stakeholder read-only Share Portal.
//
// A review link is `<origin>/?review=<token>`. This self-contained component (mounted alongside
// ConsentBanner/InviteAcceptGate in main.tsx, NOT inside App.tsx's router) detects that param, resolves
// the share, renders the shared app **read-only in a sandboxed iframe** (sandbox="allow-scripts" with NO
// same-origin, so the shared app can never touch the platform), and collects the reviewer's feedback /
// approval. It renders nothing on a normal load (no `?review=` → returns null), so it has zero impact
// unless a review link was opened.

import { useEffect, useState } from 'react';

type Phase = 'hidden' | 'loading' | 'invalid' | 'viewing' | 'sending' | 'done' | 'error';
type Rating = 'approve' | 'changes' | 'reject';

function readTokenFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('review');
  } catch {
    return null;
  }
}

const RATINGS: { id: Rating; label: string; bg: string }[] = [
  { id: 'approve', label: '✓ Approve', bg: '#238636' },
  { id: 'changes', label: '✎ Request changes', bg: '#9e6a03' },
  { id: 'reject', label: '✕ Reject', bg: '#b62324' },
];

export function SharePortal() {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [token, setToken] = useState('');
  const [title, setTitle] = useState('Shared app');
  const [html, setHtml] = useState('');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<Rating>('approve');
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    const t = readTokenFromUrl();
    if (!t) return;
    setToken(t);
    setPhase('loading');
    (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(t)}`);
        const data = await res.json().catch(() => null);
        if (res.ok && data?.valid && typeof data.html === 'string') {
          setTitle(data.title || 'Shared app');
          setHtml(data.html);
          setPhase('viewing');
        } else {
          setPhase('invalid');
          setMessage(data?.error || 'This shared app is not available.');
        }
      } catch {
        setPhase('error');
        setMessage('Could not load this shared app. Check your connection.');
      }
    })();
  }, []);

  const submit = async () => {
    setPhase('sending');
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPhase('done');
        setMessage('Thanks — your feedback was sent to the team.');
      } else {
        setPhase('viewing');
        setMessage(data.error || 'Could not send feedback. Please try again.');
      }
    } catch {
      setPhase('viewing');
      setMessage('Could not send feedback right now. Please try again.');
    }
  };

  if (phase === 'hidden') return null;

  const shell: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2147483602, background: 'var(--surface-base)',
    display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
  };

  if (phase === 'loading' || phase === 'invalid' || phase === 'error') {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 380, textAlign: 'center', color: 'var(--text-body)' }}>
          <div style={{ fontSize: 30 }}>{phase === 'loading' ? '⏳' : '🔗'}</div>
          <p style={{ marginTop: 12, fontSize: 14 }}>{phase === 'loading' ? 'Loading shared app…' : message}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={shell} role="dialog" aria-label="Shared app review">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-card)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <span style={{ fontSize: 16 }}>👀</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Read-only preview · shared for your review</div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, border: '1px solid rgba(255,255,255,0.16)', borderRadius: 8, padding: '3px 8px' }}>Read-only</span>
      </div>

      {/* Sandboxed app preview (no same-origin → cannot access the platform) */}
      <iframe
        title="Shared app preview"
        srcDoc={html}
        sandbox="allow-scripts allow-forms"
        style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
      />

      {/* Feedback bar */}
      <div style={{ background: 'var(--surface-card)', borderTop: '1px solid rgba(255,255,255,0.1)', padding: 12 }}>
        {phase === 'done' ? (
          <p style={{ color: '#3fb950', fontSize: 13, textAlign: 'center', margin: 0 }}>{message}</p>
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RATINGS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRating(r.id)}
                  style={{
                    padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: 9, cursor: 'pointer',
                    color: '#fff', background: rating === r.id ? r.bg : 'transparent',
                    border: `1px solid ${rating === r.id ? r.bg : 'rgba(255,255,255,0.18)'}`,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
                style={{ width: 180, background: 'var(--surface-base)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '8px 10px', color: 'var(--text-body)', fontSize: 12 }}
              />
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                style={{ flex: 1, minWidth: 160, background: 'var(--surface-base)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '8px 10px', color: 'var(--text-body)', fontSize: 12 }}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={phase === 'sending'}
                style={{ padding: '8px 18px', background: '#4f46e5', color: '#fff', fontSize: 12, fontWeight: 800, border: 'none', borderRadius: 9, cursor: phase === 'sending' ? 'default' : 'pointer', opacity: phase === 'sending' ? 0.6 : 1 }}
              >
                {phase === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
            {message && <p style={{ color: '#f0883e', fontSize: 11, margin: '2px 0 0' }}>{message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default SharePortal;

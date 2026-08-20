// P-COLLAB.3 — creator side of the Share Portal. Reached from Home -> Other AI -> Share for Review
// (its own tile since 2026-08-19; the old MultiCloudDeploy Deploy-tab home was removed 2026-08-20).
//
// Lets the owner create a read-only "review link" for the current app and collect client feedback.
// Self-contained (own styles + auth) so it needs only `generatedCode`.

import React, { useState } from 'react';
import { authHeader } from '../../lib/authHeaders';

interface Feedback { rating: 'approve' | 'changes' | 'reject'; comment: string; name: string; timestamp: number }

interface ShareForReviewProps {
  generatedCode?: string;
}

/** Firebase ID token for the RBAC-gated share endpoints. Best-effort → {} when signed out. */

const RATING_META: Record<Feedback['rating'], { label: string; color: string }> = {
  approve: { label: 'Approved', color: '#4ade80' },
  changes: { label: 'Changes', color: '#fbbf24' },
  reject: { label: 'Rejected', color: '#f87171' },
};

const card: React.CSSProperties = { background: 'var(--surface-base)', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };

export function ShareForReview({ generatedCode }: ShareForReviewProps) {
  const [creating, setCreating] = useState(false);
  const [reviewUrl, setReviewUrl] = useState('');
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loadingFb, setLoadingFb] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setError('');
    if (!generatedCode || !generatedCode.trim()) { setError('Build an app first, then share it for review.'); return; }
    setCreating(true);
    try {
      const titleMatch = generatedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = (titleMatch?.[1] || 'Shared app').trim().slice(0, 200);
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ title, html: generatedCode }),
      });
      if (res.status === 401) { setError('Sign in to create a review link.'); return; }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setToken(data.token);
        setReviewUrl(`${window.location.origin}/?review=${data.token}`);
      } else {
        setError(data.error || 'Could not create the review link.');
      }
    } catch {
      setError('Could not create the review link. Check your connection.');
    } finally {
      setCreating(false);
    }
  };

  const copy = () => { navigator.clipboard.writeText(reviewUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const loadFeedback = async () => {
    if (!token) return;
    setLoadingFb(true);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/feedback`, { headers: await authHeader() });
      const data = await res.json().catch(() => ({}));
      setFeedback(Array.isArray(data.feedback) ? data.feedback : []);
    } catch { /* ignore */ } finally { setLoadingFb(false); }
  };

  const revoke = async () => {
    if (!token) return;
    try { await fetch(`/api/share/${encodeURIComponent(token)}/revoke`, { method: 'POST', headers: await authHeader() }); } catch { /* ignore */ }
    setReviewUrl(''); setToken(''); setFeedback([]);
  };

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>🤝</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-body)', fontWeight: 700 }}>Share for review</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Send a read-only link to a client and collect feedback — no account needed.</div>
        </div>
        {!reviewUrl && (
          <button onClick={create} disabled={creating} style={{ padding: '7px 12px', borderRadius: 7, border: 'none', cursor: creating ? 'default' : 'pointer', background: '#4f46e5', color: '#fff', fontSize: 11, fontWeight: 700, opacity: creating ? 0.6 : 1 }}>
            {creating ? 'Creating…' : 'Create review link'}
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 11, color: '#f0883e' }}>{error}</div>}

      {reviewUrl && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input readOnly value={reviewUrl} style={{ flex: 1, background: '#020617', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 9px', color: '#86efac', fontFamily: 'monospace', fontSize: 11 }} />
            <button onClick={copy} style={{ padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#065f46', color: '#4ade80', fontSize: 11, fontWeight: 700 }}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={loadFeedback} disabled={loadingFb} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', fontSize: 11 }}>
              {loadingFb ? 'Loading…' : `View feedback${feedback.length ? ` (${feedback.length})` : ''}`}
            </button>
            <button onClick={revoke} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', cursor: 'pointer', background: 'transparent', color: '#f87171', fontSize: 11 }}>Revoke link</button>
          </div>
          {feedback.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflow: 'auto' }}>
              {feedback.map((f, i) => (
                <div key={i} style={{ ...card, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: RATING_META[f.rating].color }}>{RATING_META[f.rating].label}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{f.name}</span>
                  </div>
                  {f.comment && <div style={{ fontSize: 11, color: 'var(--text-body)', marginTop: 3 }}>{f.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ShareForReview;

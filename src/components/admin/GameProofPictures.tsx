// THE GAME PROOF PICTURES — what a played game looked like, in the admin's report (Q-3363, admin 2026-11-26).
//
// The playtest keeps up to three small pictures of a game (start, after moving, far view) in NavBharatAI's private store
// for 30 days, and the build report's GAME_PROOF line records each one's key. This draws them inside Admin → Apps → "v"
// for the latest build. Each picture is fetched through the ADMIN route with the admin token and shown from a local
// object URL — there is no public link to any of them, and the URLs are revoked when the panel closes.
//
// Honest states per picture: loading · shown · its own error (deleted after 30 days, missing, storage unreachable).

import { useEffect, useState } from 'react';

export interface ProofPictureRef { view: string; key: string }

const VIEW_LABEL: Record<string, string> = { start: 'Start', moved: 'After moving', far: 'Far view' };

/** The kept pictures named by a report's GAME_PROOF line. [] when none. PURE — never trusts the shape blindly. */
export function proofPicturesFromIssues(issues: unknown): ProofPictureRef[] {
  if (!Array.isArray(issues)) return [];
  const proof = [...issues].reverse().find((i) => i && typeof i === 'object' && (i as { code?: unknown }).code === 'GAME_PROOF') as { detail?: unknown } | undefined;
  if (!proof || typeof proof.detail !== 'string') return [];
  try {
    const taken = (JSON.parse(proof.detail) as { looks?: { taken?: unknown } })?.looks?.taken;
    if (!Array.isArray(taken)) return [];
    return taken
      .filter((t): t is { view: string; stored: string } => !!t && typeof t === 'object' && typeof (t as { view?: unknown }).view === 'string'
        && typeof (t as { stored?: unknown }).stored === 'string' && /^game-proof-v[12]\//.test((t as { stored: string }).stored)) // v2 = filed by owner (Q-3410), v1 = the first layout
      .slice(0, 3)
      .map((t) => ({ view: t.view, key: t.stored }));
  } catch { return []; }
}

/** The message for a refused picture, by status. PURE. */
export function proofPictureError(status: number, body: unknown): string {
  const e = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : '';
  return e || (status === 410 ? 'Deleted after 30 days.' : `The server answered ${status}.`);
}

type PictureState = { s: 'loading' } | { s: 'shown'; url: string } | { s: 'error'; message: string };

function ProofPicture({ picture, headers }: { picture: ProofPictureRef; headers: Record<string, string> }) {
  const [state, setState] = useState<PictureState>({ s: 'loading' });
  useEffect(() => {
    let url = '';
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/game-proof-picture?key=${encodeURIComponent(picture.key)}`, { headers });
        if (!r.ok) { const body = await r.json().catch(() => null); if (live) setState({ s: 'error', message: proofPictureError(r.status, body) }); return; }
        const blob = await r.blob();
        if (!blob.type.startsWith('image/')) { if (live) setState({ s: 'error', message: 'The server did not send a picture.' }); return; }
        url = URL.createObjectURL(blob);
        if (live) setState({ s: 'shown', url }); else URL.revokeObjectURL(url);
      } catch (e) {
        if (live) setState({ s: 'error', message: e instanceof Error ? e.message : 'Could not reach the server.' });
      }
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [picture.key, headers]);
  const label = VIEW_LABEL[picture.view] || picture.view;
  return (
    <figure className="w-[160px] shrink-0 space-y-1">
      <div className="w-[160px] h-[90px] rounded-lg border border-line bg-well overflow-hidden flex items-center justify-center">
        {state.s === 'shown'
          ? <img src={state.url} alt={`Game proof picture: ${label}`} className="w-full h-full object-contain" />
          : <span className={`text-[10px] px-2 text-center ${state.s === 'error' ? 'text-danger' : 'text-muted'}`} role={state.s === 'error' ? 'alert' : 'status'}>
            {state.s === 'error' ? state.message : 'Loading…'}
          </span>}
      </div>
      <figcaption className="text-[10px] font-bold text-muted">{label}</figcaption>
    </figure>
  );
}

/** The latest build's game proof pictures, or nothing when the report kept none. */
export function GameProofPictures({ pictures, headers }: { pictures: ProofPictureRef[]; headers: Record<string, string> }) {
  if (pictures.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-muted">Game proof pictures — admin only, kept 30 days</p>
      <div className="flex gap-2 overflow-x-auto">
        {pictures.map((p) => <ProofPicture key={p.key} picture={p} headers={headers} />)}
      </div>
    </div>
  );
}

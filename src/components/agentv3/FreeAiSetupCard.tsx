// "FREE AI CHALU KAREIN" — the box inside the ❗ tray (admin 2026-11-25).
//
// Three numbered steps with a ✅ each, and the key is pasted HERE — so nobody has to go and find
// Settings → Secrets & API Keys, which is where the old flow lost people. The words and the step order
// live in `src/lib/freeAiSetup.ts` (pure, tested); this file is the screen and the one fetch.
//
// 🔒 THE ✅ ON STEP 3 IS EARNED. The server asks the free model one real question on the pasted key
// BEFORE it saves it (`/api/app-ai/free-key`), so a tick means the app's AI actually answers. A key
// that is refused is not saved and not ticked, and the owner is told what to do instead. Steps 1 and 2
// tick on "you opened this page", which is the only thing a browser can honestly know about another
// tab — the card says as much rather than implying the sign-in was checked.
//
// 🔒 IT LIVES IN THE EXISTING ❗ BUTTON, NOT IN A CARD OF ITS OWN (admin 2026-11-21, about the game-undo
// row: *"alag se card dikhaoge, to user paresan ho jayega! koi new button nahi, existing ❗️ button ko
// hi update kar do"*). The tray takes it as a slot, exactly as it takes the credential form.

import { useCallback, useState } from 'react';
import { Check, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { authJsonHeaders } from '../../lib/authHeaders';
import {
  FREE_AI_DONE, FREE_AI_FOOTNOTE, FREE_AI_STEPS, FREE_AI_TITLE, FREE_AI_WHY, freeAiStepDone,
  type FreeAiProgress,
} from '../../lib/freeAiSetup';

const BTN = 'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export interface FreeKeyResult { ok: boolean; message?: string }

/** Save the pasted key. Resolves what the server said — never a guess, never a thrown error. */
export async function saveFreeAiKey(workspaceId: string, key: string): Promise<FreeKeyResult> {
  try {
    const res = await fetch('/api/app-ai/free-key', {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify({ workspaceId, key }),
    });
    const j = (await res.json().catch(() => null)) as FreeKeyResult | null;
    if (j && typeof j.ok === 'boolean') return j;
    return { ok: false, message: 'Could not check that key just now. Please try again.' };
  } catch {
    return { ok: false, message: 'Could not check that key just now. Please try again.' };
  }
}

export function FreeAiSetupCard({ workspaceId, onDone }: { workspaceId: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<FreeAiProgress>({ loginOpened: false, keyOpened: false, keySaved: false });
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openStep = useCallback((id: string, url: string) => {
    // A new tab, so the half-finished box is still here when they come back with the key.
    window.open(url, '_blank', 'noopener,noreferrer');
    setProgress((p) => (id === 'login' ? { ...p, loginOpened: true } : { ...p, keyOpened: true }));
  }, []);

  const save = useCallback(async () => {
    const value = key.trim();
    if (!value) return;
    setSaving(true);
    setError('');
    const r = await saveFreeAiKey(workspaceId, value);
    setSaving(false);
    if (!r.ok) { setError(r.message || 'That key could not be turned on. Please try again.'); return; }
    // Nothing is kept in this screen's memory once it is in the vault.
    setKey('');
    setProgress((p) => ({ ...p, keySaved: true }));
    onDone?.();
  }, [key, workspaceId, onDone]);

  if (progress.keySaved) {
    return (
      <div className="px-3 py-2.5 rounded-xl border border-line bg-card" role="status">
        <div className="text-[13px] font-semibold text-success">{FREE_AI_DONE.en}</div>
        <div className="text-[11px] text-muted mt-0.5">{FREE_AI_DONE.hi}</div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="px-3 py-2.5 rounded-xl border border-line bg-card">
        <div className="text-[13px] font-semibold text-ink">{FREE_AI_TITLE.en}</div>
        <div className="text-[11px] text-muted mt-0.5">{FREE_AI_TITLE.hi}</div>
        <div className="text-[11px] text-muted mt-1.5">{FREE_AI_WHY.en}</div>
        <div className="text-[11px] text-muted mt-0.5">{FREE_AI_WHY.hi}</div>
        <button type="button" onClick={() => setOpen(true)} className={`${BTN} mt-2 bg-indigo-600 hover:bg-indigo-500 text-on-accent`}>
          <Sparkles className="w-3.5 h-3.5" /> {FREE_AI_TITLE.en}
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 rounded-xl border border-line bg-card" aria-label={FREE_AI_TITLE.en}>
      <div className="text-[13px] font-semibold text-ink">{FREE_AI_TITLE.en}</div>
      <div className="text-[11px] text-muted mt-0.5">{FREE_AI_TITLE.hi}</div>

      <ol className="mt-2 flex flex-col gap-2.5">
        {FREE_AI_STEPS.map((step) => {
          const done = freeAiStepDone(step.id, progress);
          return (
            <li key={step.id} className="flex items-start gap-2">
              <span
                aria-hidden
                className={`shrink-0 w-5 h-5 mt-0.5 rounded-full border flex items-center justify-center text-[10px] font-bold ${done ? 'border-line bg-raised text-success' : 'border-line bg-well text-muted'}`}
              >
                {done ? <Check className="w-3 h-3" /> : step.number}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-body break-words">
                  {step.en} {done && <span className="text-success">✅</span>}
                </div>
                <div className="text-[11px] text-muted break-words">{step.hi}</div>
                {step.action && (
                  <button
                    type="button"
                    onClick={() => openStep(step.id, step.action!.url)}
                    className={`${BTN} mt-1.5 bg-raised hover:bg-raised-hover text-body`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> {step.action.en}
                  </button>
                )}
                {step.id === 'paste' && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="Paste your key here"
                      aria-label="Paste your key here"
                      autoComplete="off"
                      spellCheck={false}
                      className="px-2 py-1.5 text-xs rounded bg-well border border-line text-body placeholder:text-faint focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || !key.trim()}
                      className={`${BTN} self-start bg-indigo-600 hover:bg-indigo-500 text-on-accent`}
                    >
                      {saving
                        ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the key…</>)
                        : (<><Check className="w-3.5 h-3.5" /> Save and turn on</>)}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {error && <div className="mt-2 text-[11px] text-danger" role="alert">{error}</div>}
      <p className="mt-2 text-[10px] text-faint leading-snug">{FREE_AI_FOOTNOTE.en}</p>
      <p className="mt-0.5 text-[10px] text-faint leading-snug">{FREE_AI_FOOTNOTE.hi}</p>
    </div>
  );
}

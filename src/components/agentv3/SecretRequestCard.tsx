import React, { useState } from 'react';
import { Key, Eye, EyeOff, ChevronDown, Loader2, AlertCircle, Sparkles, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { findRecipeSource } from '../../lib/credentialRecipes';

/**
 * The build is asking for credentials — the popup where the user types them.
 *
 * THE VALUE NEVER GOES BACK THROUGH THE BUILD. `onSave` writes each key straight to the encrypted
 * vault through the authenticated secrets API, and only then does the caller answer the build with a
 * bare "saved". Sending the value up the build's event stream would put a live credential in the
 * session transcript and the admin build report, both of which are stored.
 *
 * MINIMISE, NOT DISMISS (admin's own request). A user who does not have the key to hand must be able
 * to get it — open another tab, find their dashboard — without losing the form or killing the build.
 * Minimised, it becomes a one-line bar that restores with everything still typed, because the state
 * lives here and the component is never unmounted.
 */

export interface SecretRequestCardProps {
  prompt: string;
  secrets: Array<{ name: string; why: string }>;
  /** Persist the values. Resolves true when every key really saved. */
  onSave: (values: Record<string, string>) => Promise<boolean>;
  /** Answer the build: true = saved and wired, false = the user skipped. */
  onDone: (saved: boolean) => void;
  /**
   * THE BUILD'S CLOSING ACT (admin 2026-08-22: "last message 'app complete' nahi — 'app ban gaya,
   * yeh keys chahiye, yahan fill karo' hona chahiye, kisi alag vibrant colour me").
   *
   * True for the deterministic POST-build ask. Visually louder on purpose — the mid-build card sits
   * inside a stream the user is already watching; this one has to survive being the LAST thing on a
   * screen someone glances at and closes.
   */
  finale?: boolean;
  /**
   * "Nahi hai to batao, main guide karunga." Drops a ready question into the chat composer so the AI
   * walks the user to the key step by step — in the user's own language, like any chat turn. The
   * question is only PREPARED, never auto-sent: what goes to the AI stays the user's decision.
   */
  onGuide?: (name: string) => void;
}

export function SecretRequestCard({ prompt, secrets, onSave, onDone, finale, onGuide }: SecretRequestCardProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [minimised, setMinimised] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filled = secrets.filter((s) => (values[s.name] || '').trim().length > 0).length;

  const save = async () => {
    const toSave: Record<string, string> = {};
    for (const s of secrets) {
      const v = (values[s.name] || '').trim();
      if (v) toSave[s.name] = v;
    }
    // Nothing typed is a skip, not an error — the user is allowed to not have the key.
    if (Object.keys(toSave).length === 0) { onDone(false); return; }
    setSaving(true);
    setError('');
    try {
      const ok = await onSave(toSave);
      if (!ok) {
        // Never answer "saved" on a failed write: the build would wire keys that are not there.
        setError('Those keys could not be saved just now. Please try again.');
        return;
      }
      onDone(true);
    } catch {
      setError('Those keys could not be saved just now. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (minimised) {
    return (
      <button
        onClick={() => setMinimised(false)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-amber-950/50 border border-amber-900 rounded text-left hover:bg-amber-950/70 transition-colors cursor-pointer"
      >
        <Key className="w-4 h-4 text-amber-300 shrink-0" />
        <span className="text-xs text-amber-200 flex-1">
          {secrets.length === 1 ? '1 key needed' : `${secrets.length} keys needed`}
          {filled > 0 && <span className="text-amber-400/70"> · {filled} filled</span>}
        </span>
        <span className="text-[10px] text-amber-400/80 uppercase tracking-wider">Tap to open</span>
      </button>
    );
  }

  return (
    <div className={cn(
      'px-3 py-2.5 rounded space-y-2.5',
      finale
        // The finale card must not look like one more log line. Vivid, but still the product's dark
        // palette — a gradient ring and glow, not a neon block that fights the whole screen.
        ? 'bg-gradient-to-br from-violet-950/80 via-fuchsia-950/60 to-amber-950/60 border-2 border-fuchsia-500/70 shadow-lg shadow-fuchsia-900/40 rounded-xl'
        : 'bg-amber-950/50 border border-amber-900',
    )}>
      {finale && (
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-fuchsia-200">
          <Sparkles className="w-4 h-4 text-fuchsia-300" /> Your app is ready — one last step
        </div>
      )}
      <div className="flex items-start gap-2">
        <Key className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
        <p className={cn('text-xs leading-relaxed flex-1', finale ? 'text-fuchsia-100' : 'text-amber-100')}>{prompt}</p>
        <button
          onClick={() => setMinimised(true)}
          title="Minimise — your typing is kept"
          aria-label="Minimise"
          className="p-1 rounded hover:bg-amber-900/60 text-amber-300 shrink-0 cursor-pointer"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {secrets.map((s) => {
        // WHERE THE VALUE ACTUALLY COMES FROM. `why` is written by the builder at run time, so it can be
        // vague and cannot be trusted to carry a URL. This is the curated, human-checked recipe for the
        // exact variable being asked for — and a form field is the one place with room for the sentence
        // that matters most ("shown ONCE"), right beside the box the user is about to paste into.
        // A variable we have no recipe for simply shows `why` alone, exactly as before.
        const source = findRecipeSource(s.name);
        return (
        <div key={s.name} className="space-y-1">
          <label htmlFor={`secret-${s.name}`} className="block text-[11px] font-mono text-amber-200">{s.name}</label>
          <p className="text-[10px] text-zinc-400 leading-snug">{s.why}</p>
          {source && (
            <div className="text-[10px] text-zinc-400 leading-snug space-y-0.5 border-l-2 border-amber-900/60 pl-2">
              <p>
                <span className="text-zinc-500">Get it from </span>
                <a
                  href={source.option.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-300 underline underline-offset-2"
                >
                  {source.option.linkLabel}
                </a>
                <span className="text-zinc-500"> → {source.option.path}</span>
              </p>
              <p className="text-zinc-500">{source.variable.where}</p>
              <p className="text-zinc-500">{source.option.cost}</p>
              {source.recipe.keyless && (
                // The most valuable line on the card: it can remove the task entirely. Shown last so it
                // never looks like a reason to abandon a key the user already has in hand.
                <p className="text-emerald-400/80">💡 {source.recipe.keyless}</p>
              )}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              id={`secret-${s.name}`}
              // Hidden by default — someone is usually screen-sharing or being watched when they paste
              // a production key.
              type={shown[s.name] ? 'text' : 'password'}
              value={values[s.name] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))}
              placeholder="Paste the value"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 px-2 py-1.5 text-xs rounded bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-600"
            />
            <button
              onClick={() => setShown((sh) => ({ ...sh, [s.name]: !sh[s.name] }))}
              title={shown[s.name] ? 'Hide' : 'Show'}
              aria-label={shown[s.name] ? `Hide ${s.name}` : `Show ${s.name}`}
              className="px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
            >
              {shown[s.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            {onGuide && (
              <button
                onClick={() => onGuide(s.name)}
                title={`Ask NavBharatAI to walk you to ${s.name}, step by step`}
                className="flex items-center gap-1 px-2 rounded bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-[10px] font-semibold whitespace-nowrap cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" /> Guide me
              </button>
            )}
          </div>
        </div>
        );
      })}

      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-300">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={save}
          disabled={saving}
          className={cn(
            'px-3 py-1 text-xs rounded font-medium cursor-pointer',
            saving ? 'bg-emerald-900/40 text-emerald-500/60 cursor-not-allowed' : 'bg-emerald-700 hover:bg-emerald-600 text-white',
          )}
        >
          {saving ? (<span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>) : (finale ? 'Save keys' : 'Save & continue')}
        </button>
        <button
          onClick={() => onDone(false)}
          disabled={saving}
          className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 cursor-pointer"
        >
          {finale ? 'I\u2019ll do this later' : 'Skip for now'}
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 leading-snug">
        Saved to your own encrypted keys (Settings → Secrets &amp; API Keys). Never shown to the AI, never
        written into your code, never committed to git.
      </p>
    </div>
  );
}

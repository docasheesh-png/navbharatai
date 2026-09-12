import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Eye, EyeOff, Save, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)
// Authenticated vault client — always attaches the signed-in user's Firebase token. Raw axios calls
// here used to omit it, so requireUserMatch rejected every save (401) → keys never saved (admin fix).
import { saveSecret, verifySecrets, type SecretVerdict } from '../lib/secretsApi';
import { findRecipeSource } from '../lib/credentialRecipes';
import { listApps, type AppChoice } from '../lib/appList';
import { scopeControl, saveScope, scopeSentence, secretOwnerLabel, shortAppName } from '../lib/secretScope';
import { VaultLockGate } from './VaultLockGate';
import { revealSecrets, deleteSecretLocked, type RevealedSecret, type UnlockState } from '../lib/vaultLock';

interface Secret {
  id: string;
  secret_name: string;
  created_at: any;
  deleted?: boolean;
  /** The app this key is tied to, or null/absent for a key shared with every app. */
  workspace_id?: string | null;
}

/**
 * ONE VAULT, MORE THAN ONE DOOR (admin 2026-08-17: "ek room ke kayi gate").
 *
 * This component is the vault's UI, and it is deliberately the ONLY one. It is rendered from Settings →
 * App Settings → Secrets & API Keys and, since 2026-08-17, from Pro v5's own More menu — the same
 * component, reading and writing the same per-user `user_secrets` collection through the same
 * authenticated `/api/secrets` client. There is no second store to keep in step, because there is no
 * second implementation: a key saved at either door is the same key the build injects into the app's
 * `.env`, and `tests/secretsOneVault.test.ts` fails CI if a future change forks that.
 *
 * `embedded` only changes the CHROME. The Settings page owns a full screen; the v5 sheet is a panel
 * inside a build the user must not lose their place in, so it drops the full-height frame and the
 * heading the sheet already provides. Nothing about the data path changes with it.
 */
export const SecretManager: React.FC<{
  userId: string;
  embedded?: boolean;
  /**
   * The app this screen opens on, and the default scope for a key saved here.
   *
   * v5 passes the build the user is actually looking at, because a key typed while building THAT app
   * almost always belongs to it — and that default is the whole point of scoping: it keeps the key out
   * of every other app's `.env`. Settings passes nothing and opens on "All apps".
   */
  defaultAppId?: string | null;
  /**
   * What to CALL that app on this screen.
   *
   * Passed in rather than looked up, so the sheet can name the app even when the app-list request fails
   * — the caller already knows the name it is displaying in its own header, and a screen that says
   * "this app" when it could say the name is a screen that makes the user check.
   */
  defaultAppName?: string | null;
}> = ({ userId, embedded, defaultAppId, defaultAppName }) => {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verdicts, setVerdicts] = useState<SecretVerdict[]>([]);
  const [checkedAt, setCheckedAt] = useState('');
  /**
   * Which app this screen is showing, and what a new key is saved against.
   *
   * `''` is "All apps" — the shared scope, and the value every key saved before scoping existed has.
   * It is a real choice rather than an absence: a Stripe key most of somebody's apps use belongs here.
   */
  const [scope, setScope] = useState<string>(defaultAppId ?? '');
  /**
   * Fixed mode only: "also use this key in my other apps".
   *
   * Off by default, because a key typed while building one app belongs to that app far more often than
   * to all of them — and the safe default is the narrow one: a key that reaches too few apps is a
   * missing key the user notices and fixes, while a key that reaches too many is a payment secret in
   * a to-do app's `.env`.
   */
  const [shareWithAll, setShareWithAll] = useState(false);
  // Loaded here rather than passed in, so BOTH doors onto the vault get the picker without either call
  // site having to remember to wire it — and so the two can never disagree about the user's app list.
  const [apps, setApps] = useState<AppChoice[]>([]);
  const appTitle = (id?: string | null) => apps.find((a) => a.id === id)?.title;
  /**
   * Which control this screen shows, and the ONE place the answer is decided. See lib/secretScope.ts —
   * opened from inside an app ⇒ that app is fixed and the only extra choice is "share with all"; opened
   * from Settings ⇒ the full picker, unchanged.
   */
  const control = scopeControl(defaultAppId, apps.length);
  /** The app this screen is about, named as well as we can name it. */
  const currentAppName = defaultAppName?.trim() || appTitle(defaultAppId) || '';
  /**
   * The scope a save will actually use. In fixed mode this is derived from the checkbox and CANNOT be
   * another app; in picker mode it is the dropdown. Deriving it in one place is what stops the sentence
   * on screen from ever disagreeing with what is stored.
   */
  const effectiveScope = saveScope({ control, defaultAppId, pickerValue: scope, shareWithAll });
  // Shared keys are shown under EVERY app, because they genuinely apply to every app — hiding them
  // while an app is selected would make somebody paste a second copy of a key they already have.
  // In fixed mode the list is always THIS app's keys plus the shared ones, even when the checkbox is
  // ticked: ticking it changes where the NEXT key goes, not which keys this app receives.
  const viewingAppId = control === 'fixed' ? String(defaultAppId ?? '') : scope;
  const visibleSecrets = viewingAppId
    ? secrets.filter((s) => !s.workspace_id || s.workspace_id === viewingAppId)
    : secrets;
  // Derived, not stored: a pure catalogue lookup on every keystroke is cheaper than keeping a second
  // copy of it in state that could fall out of step with the field.
  const recipe = findRecipeSource(name.trim());

  useEffect(() => {
    const q = query(
      collection(db, 'user_secrets'),
      where('user_id', '==', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const secretsData = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Secret))
        .filter((s) => !s.deleted);
      setSecrets(secretsData);
    });

    return () => unsubscribe();
  }, [userId]);

  /**
   * 🔒 IF THE APP ON SCREEN CHANGES, THE SCOPE FOLLOWS IT.
   *
   * `useState(defaultAppId)` only reads its argument on the FIRST render, so a sheet left mounted while
   * the user moves to another build would keep saving into the previous app — the same silent
   * wrong-app write this change exists to make impossible, arriving by a different route. Guarded on a
   * real change so a re-render never discards a deliberate "share with all".
   */
  useEffect(() => {
    setScope(defaultAppId ?? '');
    setShareWithAll(false);
  }, [defaultAppId]);

  // The app list is best-effort decoration on a picker: it never blocks saving a key, and an account
  // without v5 access (or a failed request) simply gets no picker.
  useEffect(() => {
    let alive = true;
    void listApps().then((rows) => { if (alive) setApps(rows); });
    return () => { alive = false; };
  }, []);

  const addSecret = async () => {
    if (!name || !value) return;
    const savedName = name.trim();
    setIsLoading(true);
    setAddError('');
    setVerdicts([]);
    try {
      // The DERIVED scope, never the raw picker state — in fixed mode it cannot name another app.
      await saveSecret(userId, savedName, value.trim(), effectiveScope);
      setName('');
      setValue('');
      // SAY WHETHER IT ACTUALLY WORKS, not just that it stored (2026-08-17). "Saved" is a statement about
      // this database and says nothing about the credential; a mistyped key used to be as successful as a
      // working one, and the user found out from a payment button failing for a real customer.
      //
      // This runs AFTER the save and never blocks it: the key is stored either way (the user chose it),
      // and a check we could not run is reported as unknown rather than as a bad key. It is deliberately
      // not awaited into the save's own error path — a failed check must never make a successful save
      // look like a failure.
      setIsVerifying(true);
      try {
        const all = await verifySecrets(userId);
        // Only the credential they just saved — a whole-vault report on every add would be noise.
        setVerdicts(all.filter((v) => v.names.includes(savedName)));
      } finally {
        setIsVerifying(false);
      }
    } catch (err: any) {
      // Honest, visible failure — a silent console.error left the user thinking the key saved when it didn't.
      console.error('Failed to add secret:', err);
      setAddError(err?.message || 'Could not save the key. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Ask the providers about EVERY saved key, not just the one last typed.
   *
   * The plaintext never leaves the browser here — the server reads the values back out of the user's own
   * encrypted vault. A check that fails returns [] rather than throwing, because a verification we could
   * not run is not a verdict on anybody's keys and must not turn this screen into an error state.
   */
  const checkAllKeys = async () => {
    setIsVerifying(true);
    try {
      setVerdicts(await verifySecrets(userId));
      setCheckedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      id="secret-manager-container"
      className={embedded
        ? 'p-4 space-y-4 text-white'
        : 'p-6 bg-[#161b22] border border-white/5 rounded-[2.5rem] space-y-6 text-white min-h-screen'}
    >
      {!embedded && (
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
          <Lock className="w-6 h-6 text-indigo-400" /> Secret Management
        </h2>
      )}

      {/* One vault for every key an app needs — the Cashfree-specific panel was removed (admin 2026-07-18):
          a Cashfree key is just a name/value secret (CASHFREE_WEBHOOK_SECRET, CASHFREE_CLIENT_ID, …), so it
          is added here like any other. Saved keys are injected into the app you build at build time. */}
      <p className="text-xs text-gray-400 leading-relaxed bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
        Store any API key or secret your built app needs (e.g. <span className="font-mono text-indigo-300">OPENAI_API_KEY</span>,
        <span className="font-mono text-indigo-300"> DATABASE_URL</span>, a payment or provider key). Keys are encrypted, scoped to your
        account, and <strong className="text-indigo-200">injected into your app automatically at build time</strong> — never shown to the AI,
        never pasted in chat, never committed to git. Use the exact variable name your app reads.
      </p>

      {/* WHICH APP ARE THESE KEYS FOR?
          Originally (admin 2026-08-17) one dropdown listing every app, rendered identically at both
          doors onto the vault. Corrected 2026-09-08 after the admin sent a v5 screenshot: inside a
          build that control asks a question the user already answered by opening it, and its list of
          OTHER apps is a one-tap way to save a key into the wrong app's `.env` with nothing to say so.
          The full reasoning — including why the control is narrowed rather than deleted — is in
          lib/secretScope.ts. */}
      {control === 'fixed' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-gray-500 font-bold">Keys for</span>
            {/* A statement, not a choice. `title` carries the full name for an app whose derived name is
                its entire opening prompt — the clamp is what stopped it running off the edge. */}
            <p className="text-sm font-semibold text-gray-100 truncate" title={currentAppName || undefined}>
              {shortAppName(currentAppName) || 'This app'}
            </p>
          </div>
          {/* The one choice worth keeping. There is no UI anywhere to re-scope a saved key, so without
              this a v5 user who wanted a shared key would have to delete it and re-add it in Settings. */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shareWithAll}
              onChange={(e) => setShareWithAll(e.target.checked)}
              className="mt-0.5 accent-indigo-500"
            />
            <span className="text-xs text-gray-300 leading-snug">
              Also use this key in my other apps
              <span className="block text-[11px] text-gray-500">For a key you reuse everywhere, like an AI or payment key.</span>
            </span>
          </label>
        </div>
      )}

      {control === 'picker' && (
        <div className="space-y-1">
          <label htmlFor="secret-scope" className="block text-[11px] uppercase tracking-widest text-gray-500 font-bold">
            Keys for
          </label>
          <select
            id="secret-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm"
          >
            <option value="">All apps (shared)</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{shortAppName(a.title)}</option>
            ))}
          </select>
        </div>
      )}

      {/* SAY WHERE THE KEY IS ABOUT TO GO — always, in every mode, and never only when a control
          happens to be on screen. The answer matters most exactly when there is no control to imply it. */}
      <p className="text-[11px] text-gray-500 leading-snug">
        {scopeSentence({
          control,
          appName: currentAppName,
          shareWithAll,
          pickerTitle: appTitle(scope),
          hasApps: apps.length > 0,
        })}
      </p>

      <div className="bg-gray-800 p-4 rounded-lg space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Secret Name (e.g. OPENAI_API_KEY)"
          className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm font-mono placeholder:text-gray-500"
        />
        {/* WHERE THE VALUE COMES FROM, the moment we recognise the name. Somebody typing
            RAZORPAY_KEY_SECRET here is on this screen precisely because they are trying to find that
            value, and until now the screen offered them nothing but an empty box. Appears only for a
            name in the curated catalogue — never a guessed link. */}
        {recipe && (
          <div className="text-[11px] text-gray-400 leading-relaxed bg-gray-900/60 border border-gray-700 rounded p-3 space-y-1">
            <p>
              <span className="text-gray-500">Get it from </span>
              <a
                href={recipe.option.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-300 underline underline-offset-2"
              >
                {recipe.option.linkLabel}
              </a>
              <span className="text-gray-500"> → {recipe.option.path}</span>
            </p>
            <p className="text-gray-500">{recipe.variable.where}</p>
            <p className="text-gray-500">{recipe.option.cost}</p>
            {recipe.variable.serverOnly && (
              // Said BEFORE they paste, because after the fact the only honest advice is "rotate it".
              <p className="text-amber-300/90">
                Server-side only — do not add a VITE_ or NEXT_PUBLIC_ prefix to this one, or its value is
                published inside your app for every visitor to read.
              </p>
            )}
            {recipe.recipe.keyless && <p className="text-emerald-400/90">💡 {recipe.recipe.keyless}</p>}
          </div>
        )}
        <div className="relative">
          <input
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Secret Value"
            className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm font-mono placeholder:text-gray-500 pr-10"
          />
          <button onClick={() => setShowValue(!showValue)} className="absolute right-3 top-3 text-gray-500 hover:text-white">
            {showValue ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button
          onClick={addSecret}
          disabled={isLoading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 p-3 rounded font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2"
        >
          {isLoading ? 'Saving...' : <><Save size={16} /> Save Secret</>}
        </button>
        {addError && (
          <p className="text-[11px] text-red-400 font-semibold text-center">{addError}</p>
        )}
        {/* WHAT THE PROVIDER ITSELF SAID. Shown only after a successful save, and only for a key we could
            actually check — silence means "we have no free, read-only way to test this one", which is an
            honest absence rather than an implied pass. A rejected key is still saved: the user chose it,
            and quietly discarding it would be a second, quieter version of the bug this fixes. */}
        {isVerifying && (
          <p className="text-[11px] text-gray-400 font-semibold text-center">Checking the key with the provider…</p>
        )}
        {!isVerifying && verdicts.map((v) => (
          <p
            key={v.names.join('+')}
            className={`text-[11px] font-semibold text-center leading-relaxed ${
              v.status === 'working' ? 'text-emerald-400'
                : v.status === 'rejected' ? 'text-red-400'
                  : 'text-gray-400'
            }`}
          >
            {v.message}
          </p>
        ))}
      </div>

      {/* THE CHECKLIST. A saved key told the user nothing about whether it still works, so a revoked,
          rotated or expired credential looked exactly like a healthy one until a build failed on it.
          One tap asks the providers themselves and puts the answer next to each name.
          This is deliberately NOT automatic on mount: it makes real outbound requests, and doing that
          every time somebody opens Settings would be work nobody asked for. */}
      {visibleSecrets.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={checkAllKeys}
            disabled={isVerifying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-[11px] font-bold uppercase tracking-widest text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50"
          >
            <ShieldCheck size={14} /> {isVerifying ? 'Checking…' : 'Check my keys'}
          </button>
          {checkedAt && !isVerifying && (
            <span className="text-[10px] text-gray-500">Checked {checkedAt}</span>
          )}
        </div>
      )}

      {/* ── THE SAVED KEYS, BEHIND THE LOCK ────────────────────────────────────────────────────────
          The list is the part that can show a real credential, so it is the part the lock wraps. The
          form ABOVE stays open on purpose: adding a key needs no unlock, because writing a secret you
          already hold in your hand reveals nothing — and making people authenticate to paste a key
          they just copied from a provider's dashboard would be friction with no security behind it. */}
      <VaultLockGate
        userId={userId}
        embedded={embedded}
        render={(unlock, relock) => (
          <SavedKeyRows
            userId={userId}
            unlock={unlock}
            relock={relock}
            metas={visibleSecrets}
            verdicts={verdicts}
            showOwner={apps.length > 0 || !!defaultAppId}
            ownerLabel={(s) => secretOwnerLabel({ workspaceId: s.workspace_id, currentAppId: defaultAppId, titleOf: appTitle })}
          />
        )}
      />
    </div>
  );
};

/**
 * THE CLOUD RUN LAYOUT (admin 2026-09-12: "input box jaisa dikhna chahiye, jaisa cloud run me dikhta
 * hai!").
 *
 * One row per key: the NAME in a box, the VALUE in a box, and a 🗑️ that removes the whole row. The boxes
 * are real inputs rather than styled text for a reason the admin gave himself — "copy/edit user khud
 * apne phone/desktop se kar lega". A real input is where long-press-to-copy, ⌘C and select-all already
 * work, on every device, with no button of ours to get wrong. So the screen provides the thing the
 * platform's own copy gesture needs, instead of re-implementing copy badly.
 *
 * The value starts MASKED even though the vault is unlocked. Unlocking proves who you are; it is not a
 * reason to put four payment secrets in plain text on a screen somebody might be standing behind. One
 * tap per row reveals, and a row whose stored value could not be decrypted says so instead of showing
 * an empty box that would invite overwriting a key that is actually fine.
 */
const SavedKeyRows: React.FC<{
  userId: string;
  unlock: UnlockState;
  relock: () => void;
  metas: Secret[];
  verdicts: SecretVerdict[];
  showOwner: boolean;
  ownerLabel: (s: Secret) => string;
}> = ({ userId, unlock, relock, metas, verdicts, showOwner, ownerLabel }) => {
  const [rows, setRows] = useState<RevealedSecret[] | null>(null);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState('');
  const [deleting, setDeleting] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await revealSecrets(userId, unlock.ticket));
    } catch (err: unknown) {
      const e = err as { message?: string; needsUnlock?: boolean };
      // An expired ticket is not an error to display — it is the vault having re-locked, so say that by
      // actually re-locking rather than leaving a dead screen with a stale message on it.
      if (e?.needsUnlock) { relock(); return; }
      setError(e?.message || 'Could not read your keys.');
    }
  }, [userId, unlock.ticket, relock]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    setDeleting(id);
    setError('');
    try {
      await deleteSecretLocked(userId, id, unlock.ticket);
      // Drop it locally too. The Firestore listener in the parent will agree a moment later; waiting for
      // it would leave the deleted row on screen long enough to look like the delete failed.
      setRows((list) => (list ?? []).filter((r) => r.id !== id));
      setConfirming('');
    } catch (err: unknown) {
      const e = err as { message?: string; needsUnlock?: boolean };
      if (e?.needsUnlock) { relock(); return; }
      setError(e?.message || 'Could not delete the key.');
    } finally {
      setDeleting('');
    }
  };

  /** Only the keys this screen's app filter is showing — the scope rules stay exactly as they were. */
  const visibleIds = new Set(metas.map((m) => m.id));
  const visible = (rows ?? []).filter((r) => visibleIds.has(r.id));

  if (rows === null) {
    return <p className="py-6 text-center text-xs text-gray-500">Opening your keys…</p>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-red-300">
          <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
        </p>
      )}

      {visible.length === 0 && (
        <p className="py-6 text-center text-xs text-gray-500">No keys saved yet. Add one above.</p>
      )}

      {visible.map((row) => {
        const verdict = verdicts.find((v) => v.names.includes(row.secret_name));
        const isShown = !!shown[row.id];
        const meta = metas.find((m) => m.id === row.id);
        return (
          <div key={row.id} className="rounded-xl border border-white/5 bg-[#0d1117] p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* NAME — readOnly, not disabled: a disabled input cannot be selected, which would break
                    the very copy gesture these boxes exist for. Renaming a key is not an edit, it is a
                    different key, so the name is not editable here. */}
                <input
                  readOnly
                  value={row.secret_name}
                  aria-label={`Name of ${row.secret_name}`}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs text-indigo-200 outline-none focus:border-indigo-500/40"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    type={isShown ? 'text' : 'password'}
                    value={row.readable ? row.secret_value : ''}
                    placeholder={row.readable ? '' : 'Saved, but this value cannot be read back'}
                    aria-label={`Value of ${row.secret_name}`}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs text-gray-200 outline-none focus:border-indigo-500/40 placeholder-amber-400/60"
                  />
                  {row.readable && (
                    <button
                      onClick={() => setShown((m) => ({ ...m, [row.id]: !m[row.id] }))}
                      aria-label={isShown ? `Hide ${row.secret_name}` : `Show ${row.secret_name}`}
                      className="shrink-0 rounded-lg border border-white/10 p-2 text-gray-400 hover:text-white"
                    >
                      {isShown ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {/* 🗑️ DELETES THE WHOLE ROW — name and value together, for good. Two taps, because one
                  stray tap on a phone must not destroy a key a live app depends on, and there is no
                  undo to fall back on now that the delete is real. */}
              <div className="shrink-0">
                {confirming === row.id ? (
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => void remove(row.id)}
                      disabled={deleting === row.id}
                      className="rounded-lg bg-red-600 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {deleting === row.id ? '…' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setConfirming('')}
                      className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(row.id)}
                    aria-label={`Delete ${row.secret_name}`}
                    className="rounded-lg border border-white/10 p-2 text-red-400 hover:border-red-500/40 hover:text-red-300"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
              {showOwner && meta ? (
                <span className="text-[10px] text-gray-500">{ownerLabel(meta)}</span>
              ) : <span />}
              {/* A key with no verdict shows NOTHING — absence of a badge means "not checked", which is
                  the truth. A grey "unknown" pill on every unverifiable key would be noise that teaches
                  people to stop reading the badges that matter. */}
              {verdict && (
                <span
                  className={`text-[10px] leading-snug ${
                    verdict.status === 'working' ? 'text-emerald-400'
                      : verdict.status === 'rejected' ? 'text-red-400'
                        : 'text-gray-500'
                  }`}
                >
                  {verdict.message}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, Save, Trash2, ShieldCheck } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)
// Authenticated vault client — always attaches the signed-in user's Firebase token. Raw axios calls
// here used to omit it, so requireUserMatch rejected every save (401) → keys never saved (admin fix).
import { saveSecret, deleteSecret, verifySecrets, type SecretVerdict } from '../lib/secretsApi';
import { findRecipeSource } from '../lib/credentialRecipes';
import { listApps, type AppChoice } from '../lib/appList';

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
}> = ({ userId, embedded, defaultAppId }) => {
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
  // Loaded here rather than passed in, so BOTH doors onto the vault get the picker without either call
  // site having to remember to wire it — and so the two can never disagree about the user's app list.
  const [apps, setApps] = useState<AppChoice[]>([]);
  const appTitle = (id?: string | null) => apps.find((a) => a.id === id)?.title;
  // Shared keys are shown under EVERY app, because they genuinely apply to every app — hiding them
  // while an app is selected would make somebody paste a second copy of a key they already have.
  const visibleSecrets = scope
    ? secrets.filter((s) => !s.workspace_id || s.workspace_id === scope)
    : secrets;
  const scopeTitle = appTitle(scope);
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
      await saveSecret(userId, savedName, value.trim(), scope || null);
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

  const handleDeleteSecret = async (id: string) => {
    try {
      await deleteSecret(userId, id);
    } catch (err) {
      console.error('Failed to delete secret:', err);
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

      {/* WHICH APP ARE THESE KEYS FOR? (admin 2026-08-17)
          Until now the vault had no app dimension at all, so EVERY key a user had ever saved was written
          into the `.env` of EVERY app they built — a to-do list carried their payment secret, and went on
          carrying it if the app was published. This picker is the user-facing half of fixing that: a key
          saved while an app is selected goes only to that app.
          "All apps" is a real, deliberate choice, not an absence: a Stripe key most of somebody's apps
          share belongs there — and it is what every key saved before today already is, which is why
          nothing that exists today changes behaviour.
          Hidden entirely when the user has no apps yet: nobody should be asked to choose between one
          thing, or between nothing. */}
      {apps.length > 0 && (
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
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* SAY WHERE THE KEY IS ABOUT TO GO — always, not only when the picker happens to be on screen.
          v5 opens this with the current build pre-selected, and the picker is hidden whenever the app
          list could not be loaded. Without this line, that combination saves an app-scoped key while
          telling the user nothing, and they would later wonder why their other app cannot see it. */}
      <p className="text-[11px] text-gray-500 leading-snug">
        {scope
          ? `A key you add now goes only to ${scopeTitle ? `“${scopeTitle}”` : 'this app'} — your other apps will not receive it. Keys shared with all apps are listed here too, and every app still gets those.`
          : 'A key you add now goes to every app you build.'
            + (apps.length > 0 ? ' Pick an app above to keep a key out of your other apps.' : '')}
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

      <div className="space-y-2">
        {visibleSecrets.map((s) => {
          const verdict = verdicts.find((v) => v.names.includes(s.secret_name));
          return (
            <div key={s.id} className="bg-gray-800 p-3 rounded font-mono text-xs space-y-1">
              <div className="flex justify-between items-center gap-2">
                <span className="truncate">{s.secret_name}</span>
                {/* Which app owns this key. Shown only when the user actually has apps to tell apart —
                    and a shared key says so explicitly, because "goes to everything" is the fact most
                    worth knowing about a payment secret. */}
                {apps.length > 0 && (
                  <span className="shrink-0 font-sans text-[10px] text-gray-500 truncate max-w-[45%]">
                    {s.workspace_id ? (appTitle(s.workspace_id) ?? 'Another app') : 'All apps'}
                  </span>
                )}
                <button onClick={() => handleDeleteSecret(s.id)} aria-label={`Delete ${s.secret_name}`} className="shrink-0 text-red-400 hover:text-red-300">
                  <Trash2 size={16} />
                </button>
              </div>
              {/* A key with no verdict shows NOTHING — absence of a badge means "not checked", which is
                  the truth. A grey "unknown" pill on every unverifiable key would be noise that teaches
                  people to stop reading the badges that matter. */}
              {verdict && (
                <p
                  className={`font-sans leading-snug ${
                    verdict.status === 'working' ? 'text-emerald-400'
                      : verdict.status === 'rejected' ? 'text-red-400'
                        : 'text-gray-500'
                  }`}
                >
                  {verdict.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

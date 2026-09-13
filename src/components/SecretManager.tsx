import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Eye, EyeOff, Trash2, ShieldCheck, AlertTriangle, Plus, RefreshCw, Loader2 } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)
// Authenticated vault client — always attaches the signed-in user's Firebase token. Raw axios calls
// here used to omit it, so requireUserMatch rejected every save (401) → keys never saved (admin fix).
import { saveSecret, verifySecrets, type SecretVerdict } from '../lib/secretsApi';
import { findRecipeSource } from '../lib/credentialRecipes';
import { listApps, type AppChoice } from '../lib/appList';
import { scopeControl, saveScope, scopeSentence, secretOwnerLabel, shortAppName } from '../lib/secretScope';
import { AppLockGate } from './AppLockGate';
import { revealSecrets, deleteSecretLocked, type RevealedSecret } from '../lib/vaultLock';
import type { UnlockState, VaultError } from '../lib/appLock';

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
 * App Settings → Secrets & API Keys and, since 2026-08-17, from NavBharatAI Pro's own More menu — the
 * same component, reading and writing the same per-user `user_secrets` collection through the same
 * authenticated `/api/secrets` client. There is no second store to keep in step, because there is no
 * second implementation: a key saved at either door is the same key the build injects into the app's
 * `.env`, and `tests/secretsOneVault.test.ts` fails CI if a future change forks that.
 *
 * `embedded` only changes the CHROME. The Settings page owns a full screen; the Pro sheet is a panel
 * inside a build the user must not lose their place in, so it drops the full-height frame and the
 * heading the sheet already provides. Nothing about the data path changes with it.
 */
export const SecretManager: React.FC<{
  userId: string;
  embedded?: boolean;
  /**
   * The app this screen opens on, and the default scope for a key saved here.
   *
   * Pro passes the build the user is actually looking at, because a key typed while building THAT app
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
  // without Pro access (or a failed request) simply gets no picker.
  useEffect(() => {
    let alive = true;
    void listApps().then((rows) => { if (alive) setApps(rows); });
    return () => { alive = false; };
  }, []);

  /**
   * Ask the providers about saved keys.
   *
   * The plaintext never leaves the browser here — the server reads the values back out of the user's own
   * encrypted vault. A check that fails returns [] rather than throwing, because a verification we could
   * not run is not a verdict on anybody's keys and must not turn this screen into an error state.
   */
  const checkAllKeys = useCallback(async (onlyNames?: string[]) => {
    setIsVerifying(true);
    try {
      const all = await verifySecrets(userId);
      setVerdicts(onlyNames?.length ? all.filter((v) => v.names.some((n) => onlyNames.includes(n))) : all);
      if (!onlyNames?.length) setCheckedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setIsVerifying(false);
    }
  }, [userId]);

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

      {/* ── THE DOOR IS THE WHOLE SCREEN ──────────────────────────────────────────────────────────
          Admin 2026-09-13, verbatim: *"jab bhi 'secret and api key' par click kiye jaye, phone lock …
          se hi open hona chahiye! aur 'secret and api key' ke andar koi lock nahi ho, andar user ki old
          credentials dikhe"* — and, the same day, the simpler door that actually works on a phone:
          *"bas PIN banao … PIN (4 digit pin se hi open ho)"*.

          The lock is the DOOR: nothing of this panel renders until the vault is genuinely open, and once
          it is, everything inside is ordinary — add, reveal, copy, edit, delete, with no second prompt.
          Security is unchanged either way, because the lock was never the React flag: the server refuses
          to decrypt without the ticket this gate collects.

          ⚠️ `area="api_keys"` is the ONE area the user cannot switch off (admin 2026-09-13: *"api keys and
          secret (non removal ✅)"*), enforced server-side in `normaliseLockedAreas` rather than by a
          disabled checkbox. And the render prop returns null without a live unlock: every call this panel
          makes needs the ticket, so rendering it half-open would only produce 401s. */}
      <AppLockGate
        userId={userId}
        area="api_keys"
        embedded={embedded}
        render={(unlock, relock) => (unlock === null ? null : (
          <div className="space-y-4">
            {/* One vault for every key an app needs — a Cashfree key is just a name/value secret, so it
                is added here like any other. Saved keys are injected into the app you build at build time. */}
            <p className="text-xs text-gray-400 leading-relaxed bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
              Store any API key or secret your built app needs (e.g. <span className="font-mono text-indigo-300">OPENAI_API_KEY</span>,
              <span className="font-mono text-indigo-300"> DATABASE_URL</span>, a payment or provider key). Keys are encrypted, scoped to your
              account, and <strong className="text-indigo-200">injected into your app automatically at build time</strong> — never shown to the AI,
              never pasted in chat, never committed to git. Use the exact variable name your app reads.
            </p>

            {/* 🔝 WHICH APP'S CREDENTIALS AM I LOOKING AT? (admin 2026-09-13: *"sabse upar kis app ke
                credentials hai, woh select karne ka option bhi ho!"*) — so this sits at the TOP of the
                panel, above the rows it filters, rather than beside the form it used to belong to.

                Originally (admin 2026-08-17) one dropdown listing every app, rendered identically at both
                doors onto the vault. Corrected 2026-09-08 after the admin sent a Pro screenshot: inside a
                build that control asks a question the user already answered by opening it, and its list of
                OTHER apps is a one-tap way to save a key into the wrong app's `.env` with nothing to say
                so. The full reasoning — including why the control is narrowed rather than deleted — is in
                lib/secretScope.ts. */}
            {control === 'fixed' && (
              <div className="space-y-2 rounded-xl border border-white/5 bg-black/20 p-3">
                <div className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-widest text-gray-500 font-bold">Credentials for</span>
                  {/* A statement, not a choice. `title` carries the full name for an app whose derived name is
                      its entire opening prompt — the clamp is what stopped it running off the edge. */}
                  <p className="text-sm font-semibold text-gray-100 truncate" title={currentAppName || undefined}>
                    {shortAppName(currentAppName) || 'This app'}
                  </p>
                </div>
                {/* The one choice worth keeping. There is no UI anywhere to re-scope a saved key, so without
                    this a Pro user who wanted a shared key would have to delete it and re-add it in Settings. */}
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={shareWithAll}
                    onChange={(e) => setShareWithAll(e.target.checked)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span className="text-xs text-gray-300 leading-snug">
                    Also use new keys in my other apps
                    <span className="block text-[11px] text-gray-500">For a key you reuse everywhere, like an AI or payment key.</span>
                  </span>
                </label>
              </div>
            )}

            {control === 'picker' && (
              <div className="space-y-1 rounded-xl border border-white/5 bg-black/20 p-3">
                <label htmlFor="secret-scope" className="block text-[11px] uppercase tracking-widest text-gray-500 font-bold">
                  Credentials for
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

            {/* SAY WHERE A NEW KEY IS ABOUT TO GO — always, in every mode, and never only when a control
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

            <CredentialTable
              userId={userId}
              unlock={unlock}
              relock={relock}
              metas={visibleSecrets}
              verdicts={verdicts}
              saveScopeId={effectiveScope}
              showOwner={apps.length > 0 || !!defaultAppId}
              ownerLabel={(s) => secretOwnerLabel({ workspaceId: s.workspace_id, currentAppId: defaultAppId, titleOf: appTitle })}
              onSaved={(names) => void checkAllKeys(names)}
            />

            {/* THE CHECKLIST. A saved key told the user nothing about whether it still works, so a revoked,
                rotated or expired credential looked exactly like a healthy one until a build failed on it.
                One tap asks the providers themselves and puts the answer next to each name.
                This is deliberately NOT automatic on mount: it makes real outbound requests, and doing that
                every time somebody opens Settings would be work nobody asked for. */}
            {visibleSecrets.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => void checkAllKeys()}
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
          </div>
        ))}
      />
    </div>
  );
};

/** One unsaved row the user is still typing. `key` is local only — it never reaches the server. */
interface NewRow {
  key: string;
  name: string;
  value: string;
}

/**
 * THE CLOUD RUN LAYOUT (admin 2026-09-13: *"secret and api key ke andar cloud run ke jaise ui dikhe!
 * mean 2-2 colom dikhen • 1. secret and api key, • 2. value (click karne se edit kiya ja sake) aur sath
 * me ek 🗑️ (delete) button jisse dono colom delete karne ke liye. sabse last me ek button ho, "+ add new
 * credentials" aur sabse last me — "save and sync" button."*)
 *
 * Two columns, a bin per row, then the two buttons at the bottom — that is the whole screen, and it is
 * the shape anybody who has edited environment variables in a cloud console already knows.
 *
 * WHY THE BOXES ARE REAL INPUTS rather than styled text, in the admin's own words from the first
 * iteration — *"copy/edit user khud apne phone/desktop se kar lega"*. A real input is where
 * long-press-to-copy, ⌘C and select-all already work, on every device, with no button of ours to get
 * wrong. So the screen provides the thing the platform's own copy gesture needs instead of
 * re-implementing copy badly.
 *
 * 🔒 WHAT "SAVE AND SYNC" ACTUALLY DOES, because a button that only looks like it works is the exact
 * thing the second absolute rule forbids. It writes every changed and every newly-added row to the vault
 * through the same authenticated `/api/secrets` save the screen has always used, then RE-READS the vault
 * and redraws from what the server really holds — so "synced" means the boxes on screen and the keys a
 * build will inject are the same thing, confirmed, not assumed. It reports the count it saved, names
 * anything it skipped and why, and leaves a failed row on screen with its text intact.
 *
 * The value starts MASKED even though the vault is unlocked. Unlocking proves who you are; it is not a
 * reason to put four payment secrets in plain text on a screen somebody might be standing behind. One
 * tap per row reveals, and a row whose stored value could not be decrypted says so instead of showing
 * an empty box that would invite overwriting a key that is actually fine.
 */
const CredentialTable: React.FC<{
  userId: string;
  unlock: UnlockState;
  relock: () => void;
  metas: Secret[];
  verdicts: SecretVerdict[];
  /** The scope a NEW credential is saved against — derived by the parent, never by this table. */
  saveScopeId: string;
  showOwner: boolean;
  ownerLabel: (s: Secret) => string;
  /** The names just written, so the parent can ask the providers whether they actually work. */
  onSaved: (names: string[]) => void;
}> = ({ userId, unlock, relock, metas, verdicts, saveScopeId, showOwner, ownerLabel, onSaved }) => {
  const [rows, setRows] = useState<RevealedSecret[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState('');
  const [deleting, setDeleting] = useState('');
  /** Per-row edits in flight. Absent = untouched, so a row the user has not typed in shows the stored value. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError('');
    try {
      setRows(await revealSecrets(userId, unlock.ticket));
    } catch (err: unknown) {
      const e = err as VaultError;
      // An expired ticket is not an error to display — it is the vault having re-locked, so say that by
      // actually re-locking rather than leaving a dead screen with a stale message on it.
      if (e?.needsUnlock) { relock(); return; }
      setError(e?.message || 'Could not read your keys.');
    }
  }, [userId, unlock.ticket, relock]);

  useEffect(() => { void load(); }, [load]);

  /** The stored value a row started from — the baseline every "has this changed?" question asks about. */
  const storedValue = (row: RevealedSecret) => (row.readable ? row.secret_value : '');
  const isDirty = (row: RevealedSecret) => draft[row.id] !== undefined && draft[row.id] !== storedValue(row);
  const pendingCount = (rows ?? []).filter(isDirty).length + newRows.filter((r) => r.name.trim() && r.value.trim()).length;

  /**
   * SAVE EVERY PENDING CHANGE, THEN CONFIRM IT FROM THE SERVER.
   *
   * There is no new endpoint behind an edit and no new concept: saving a name that already exists
   * REPLACES it server-side (`routes/secrets.ts` — "SAVING AN EXISTING NAME REPLACES IT"), which is
   * exactly what rotating a key is.
   *
   * 🔒 THE SCOPE MUST RIDE ALONG on an edit. A key belonging to one app carries its `workspace_id`;
   * saving without it would land the new value in the SHARED scope and leave the app-scoped row behind,
   * so the build would keep using the old value while this screen showed the new one. A NEW row uses the
   * scope the parent derived from the picker instead.
   *
   * An EMPTY value is never saved: blanking a key a live app depends on is indistinguishable from
   * deleting it, and the bin is the control that asks twice before doing that.
   */
  const saveAndSync = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    const savedNames: string[] = [];
    const skipped: string[] = [];
    try {
      for (const row of (rows ?? [])) {
        if (!isDirty(row)) continue;
        const next = (draft[row.id] ?? '').trim();
        if (!next) { skipped.push(`${row.secret_name} (empty value — use the bin to remove it)`); continue; }
        const meta = metas.find((m) => m.id === row.id);
        await saveSecret(userId, row.secret_name, next, meta?.workspace_id ?? null);
        savedNames.push(row.secret_name);
      }
      for (const fresh of newRows) {
        const name = fresh.name.trim();
        const value = fresh.value.trim();
        if (!name && !value) continue; // an untouched blank row is not an error, it is just empty
        if (!name || !value) { skipped.push(`${name || 'a new row'} (needs both a name and a value)`); continue; }
        await saveSecret(userId, name, value, saveScopeId);
        savedNames.push(name);
      }

      // Re-read before claiming anything: "synced" has to mean the boxes and the vault agree, confirmed
      // from the server, rather than this screen believing its own optimistic edits.
      setDraft({});
      // Keep exactly the rows that were NOT saved and still hold typed text — a half-filled row stays on
      // screen with its text so the user can finish it, a saved row disappears into the list above, and a
      // row that was left entirely blank is simply dropped.
      setNewRows((list) => list.filter((r) => {
        const name = r.name.trim();
        const value = r.value.trim();
        const wasSaved = !!name && !!value;
        return !wasSaved && (!!name || !!value);
      }));
      await load(true);

      if (savedNames.length === 0 && skipped.length === 0) {
        setNotice('Nothing to save — no changes yet.');
      } else {
        const parts: string[] = [];
        if (savedNames.length) parts.push(`Saved and synced ${savedNames.length} credential${savedNames.length === 1 ? '' : 's'}.`);
        if (skipped.length) parts.push(`Not saved: ${skipped.join('; ')}.`);
        setNotice(parts.join(' '));
      }
      if (savedNames.length) onSaved(savedNames);
    } catch (err: unknown) {
      const e = err as VaultError;
      if (e?.needsUnlock) { relock(); return; }
      // The rows keep their typed text, so nothing the user wrote is lost by a failed save.
      setError(e?.message || 'Could not save your credentials. Your text is still here — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    setError('');
    try {
      await deleteSecretLocked(userId, id, unlock.ticket);
      // Drop it locally too. The Firestore listener in the parent will agree a moment later; waiting for
      // it would leave the deleted row on screen long enough to look like the delete failed.
      setRows((list) => (list ?? []).filter((r) => r.id !== id));
      setDraft((d) => { const { [id]: _drop, ...rest } = d; return rest; });
      setConfirming('');
    } catch (err: unknown) {
      const e = err as VaultError;
      if (e?.needsUnlock) { relock(); return; }
      setError(e?.message || 'Could not delete the key.');
    } finally {
      setDeleting('');
    }
  };

  /** Only the keys this screen's app filter is showing — the scope rules stay exactly as they were. */
  const visibleIds = new Set(metas.map((m) => m.id));
  const visible = (rows ?? []).filter((r) => visibleIds.has(r.id));

  const boxClass = 'w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-xs outline-none focus:border-indigo-500/40';

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
      {notice && !error && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11px] leading-snug text-emerald-300">
          <ShieldCheck size={14} className="mt-px shrink-0" /> {notice}
        </p>
      )}

      {/* The column headings, so the two boxes are labelled once instead of guessed at per row. Hidden on
          the narrowest screens, where the rows stack and a two-column header would lie about the layout. */}
      {(visible.length > 0 || newRows.length > 0) && (
        <div className="hidden sm:flex items-center gap-2 px-0.5 pt-1">
          <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Secret / API key</span>
          <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Value</span>
          <span className="w-9 shrink-0" />
        </div>
      )}

      {visible.length === 0 && newRows.length === 0 && (
        <p className="py-6 text-center text-xs text-gray-500">No credentials saved yet. Add your first one below.</p>
      )}

      {visible.map((row) => {
        const verdict = verdicts.find((v) => v.names.includes(row.secret_name));
        const isShown = !!shown[row.id];
        const meta = metas.find((m) => m.id === row.id);
        const dirty = isDirty(row);
        return (
          <div key={row.id} className="rounded-xl border border-white/5 bg-[#0d1117] p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              {/* COLUMN 1 — the name. readOnly, not disabled: a disabled input cannot be selected, which
                  would break the very copy gesture these boxes exist for. Renaming a key is not an edit,
                  it is a different key, so the name is not editable on a saved row. */}
              <input
                readOnly
                value={row.secret_name}
                aria-label={`Name of ${row.secret_name}`}
                className={`${boxClass} flex-1 text-indigo-200`}
              />
              {/* COLUMN 2 — the value, editable in place: click it and type. It was readOnly until
                  2026-09-13, so rotating a key meant deleting the row and retyping its name, and a typo
                  there silently creates a second key no build reads. */}
              <div className="flex flex-1 items-center gap-1.5">
                <input
                  type={isShown ? 'text' : 'password'}
                  value={draft[row.id] ?? storedValue(row)}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                  placeholder={row.readable ? '' : 'Saved, but this value cannot be read back — type a new one to replace it'}
                  aria-label={`Value of ${row.secret_name}`}
                  className={`${boxClass} text-gray-200 placeholder-amber-400/60 ${dirty ? 'border-amber-400/50' : ''}`}
                />
                <button
                  onClick={() => setShown((m) => ({ ...m, [row.id]: !m[row.id] }))}
                  aria-label={isShown ? `Hide ${row.secret_name}` : `Show ${row.secret_name}`}
                  className="shrink-0 rounded-lg border border-white/10 p-2 text-gray-400 hover:text-white"
                >
                  {isShown ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              {/* 🗑️ DELETES THE WHOLE ROW — name and value together, for good. Two taps, because one
                  stray tap on a phone must not destroy a key a live app depends on, and there is no
                  undo to fall back on now that the delete is real. */}
              <div className="shrink-0 self-end sm:self-start">
                {confirming === row.id ? (
                  <div className="flex items-center gap-1 sm:flex-col">
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
              <span className="text-[10px] text-gray-500">
                {dirty ? <span className="text-amber-300">Changed — press “Save and sync”.</span> : (showOwner && meta ? ownerLabel(meta) : '')}
              </span>
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

      {/* NEW ROWS — the same two columns, with the NAME editable because that is the one moment naming a
          key is meaningful. They are not saved until "Save and sync", so a half-typed row cannot reach
          the vault. */}
      {newRows.map((fresh) => {
        // Where the value comes from, the moment we recognise the name. Somebody typing
        // RAZORPAY_KEY_SECRET is on this screen precisely because they are trying to find that value,
        // and an empty box offers them nothing. Only for a name in the curated catalogue — never a guess.
        const recipe = findRecipeSource(fresh.name.trim());
        return (
          <div key={fresh.key} className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <input
                value={fresh.name}
                onChange={(e) => setNewRows((list) => list.map((r) => (r.key === fresh.key ? { ...r, name: e.target.value } : r)))}
                placeholder="OPENAI_API_KEY"
                aria-label="New credential name"
                className={`${boxClass} flex-1 text-indigo-200 placeholder-gray-600`}
              />
              <input
                value={fresh.value}
                onChange={(e) => setNewRows((list) => list.map((r) => (r.key === fresh.key ? { ...r, value: e.target.value } : r)))}
                placeholder="Paste the value"
                aria-label="New credential value"
                className={`${boxClass} flex-1 text-gray-200 placeholder-gray-600`}
              />
              <div className="shrink-0 self-end sm:self-start">
                {/* An unsaved row has nothing in the vault to destroy, so its bin removes it at once —
                    a confirmation step here would be a question about nothing. */}
                <button
                  onClick={() => setNewRows((list) => list.filter((r) => r.key !== fresh.key))}
                  aria-label="Remove this new row"
                  className="rounded-lg border border-white/10 p-2 text-red-400 hover:border-red-500/40 hover:text-red-300"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {recipe && (
              <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-black/30 p-2.5 text-[11px] leading-relaxed text-gray-400">
                <p>
                  <span className="text-gray-500">Get it from </span>
                  <a href={recipe.option.link} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline underline-offset-2">
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
          </div>
        );
      })}

      {/* ── THE TWO BUTTONS AT THE BOTTOM, in the order the admin asked for them ───────────────────── */}
      <button
        onClick={() => setNewRows((list) => [...list, { key: `new-${Date.now()}-${list.length}`, name: '', value: '' }])}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-300 hover:border-indigo-500/40 hover:text-white"
      >
        <Plus size={16} /> Add new credentials
      </button>

      <button
        onClick={() => void saveAndSync()}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        {saving ? 'Saving and syncing…' : pendingCount > 0 ? `Save and sync (${pendingCount})` : 'Save and sync'}
      </button>
      <p className="text-center text-[10px] leading-snug text-gray-500">
        Saves every change above, then re-reads your vault so what you see is exactly what your builds will use.
      </p>
    </div>
  );
};

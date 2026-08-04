import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IndianRupee, Loader2, Check, AlertTriangle, ArrowLeft, ExternalLink, Copy, ShieldCheck,
  Github, Sparkles, ChevronRight,
} from 'lucide-react';
import {
  PAY_METHODS, methodSpec, generatePayment, paymentEnvKeys, isValidUpiId,
  missingRequiredFields, candidatePages,
  type PayMethod, type GeneratedPayment,
} from '../../lib/paymentSetup';
import { insertSnippet } from '../../lib/htmlInsert';
import {
  AppTargetPicker, useUserApps, useAppFiles, readAppFile, saveFilesToApp,
} from './AppTargetPicker';
import { listSecrets, saveSecret, deleteSecret } from '../../lib/secretsApi';

// "Start taking money" — one straight line from choosing an app to a working payment button.
//
// WHY THIS WAS REWRITTEN (admin 2026-07-27):
//
//  1. IT NEVER TOUCHED A REAL APP. "Inject into App" merged the snippet into the in-memory preview
//     only. Closing the tab lost it. Now the user picks which of their apps — a NavBharatAI Pro app
//     or one of their GitHub repositories — and the file is genuinely written.
//
//  2. IT ASKED FOR SECRETS AND THEN DROPPED THEM ON THE FLOOR. A Razorpay Key Secret typed here went
//     into a React state variable and nowhere else. Credentials now go to the same encrypted vault
//     the Database screen writes to, so they appear in Settings → Secrets & Keys and the build engine
//     can use them — and they are cleared from the browser as soon as they are stored.
//
//  3. THE RAZORPAY CODE IT GENERATED WAS EXPLOITABLE. It priced the order from `window.payAmount` and
//     treated the browser's callback as proof of payment. The corrected flow lives in
//     `src/lib/paymentSetup.ts` (server creates the order, server verifies the signature) and is
//     locked by tests.
//
//  4. IT WAS SIX CHOICES DEEP BEFORE ANYTHING HAPPENED. UPI is now first and needs ONE field, because
//     for most Indian sellers that is the whole job: money to their bank, no signup, no server.
//
// REMOVED DELIBERATELY: the "Subscription" tab generated a pricing page plus a Firebase snippet that
// read a `subscriptions` collection nothing ever wrote — it could not make anyone subscribe. And the
// revenue calculator invented an AdSense RPM. Both were decoration; the Design & Build tools make
// pricing pages properly.

type Source = 'navbharat' | 'github';
type Step = 'app' | 'method' | 'details' | 'done';

interface Repo {
  fullName: string;
  defaultBranch: string;
}

export interface MonetizationWizardProps {
  /** The Pro v5 session currently open, used to pre-select the user's app. */
  sessionId?: string;
  /** Firebase uid — without it, credentials cannot be stored and the wizard says so. */
  userId?: string;
  githubToken?: string;
  onConnectGitHub?: () => void;
}

interface Outcome {
  ok: boolean;
  where: string;
  written: string[];
  vault: 'saved' | 'failed' | 'skipped' | 'none';
  vaultNames: string[];
  undoHint?: string;
  error?: string;
  generated?: GeneratedPayment;
}

const isHtml = (p: string) => /\.html?$/i.test(p);

function readStoredGhToken(): string {
  try { return localStorage.getItem('gh_token') || ''; } catch { return ''; }
}

export const MonetizationWizard: React.FC<MonetizationWizardProps> = ({
  sessionId, userId, githubToken, onConnectGitHub,
}) => {
  const [step, setStep] = useState<Step>('app');
  const [source, setSource] = useState<Source>('navbharat');
  const [method, setMethod] = useState<PayMethod>('upi');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState('');

  // ── NavBharatAI apps ──
  const { apps, loading: appsLoading, selected: appSessionId, setSelected: setAppSessionId } = useUserApps(sessionId);
  const { files: appFiles, loading: appFilesLoading } = useAppFiles(source === 'navbharat' ? appSessionId : '');
  const [navPath, setNavPath] = useState('');

  useEffect(() => {
    // Default to the page a payment button belongs on, rather than making the user hunt for it.
    if (navPath && appFiles.some((f) => f.path === navPath)) return;
    setNavPath(candidatePages(appFiles.filter((f) => f.writable).map((f) => f.path))[0] || '');
  }, [appFiles, navPath]);

  // ── GitHub repositories ──
  const ghToken = githubToken || readStoredGhToken();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFullName, setRepoFullName] = useState('');
  const [ghFiles, setGhFiles] = useState<Record<string, string> | null>(null);
  const [ghFilesLoading, setGhFilesLoading] = useState(false);
  const [ghPath, setGhPath] = useState('');

  useEffect(() => {
    if (source !== 'github' || !ghToken || repos.length > 0) return;
    let live = true;
    setReposLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/github/repos', { headers: { Authorization: `Bearer ${ghToken}` } });
        const list = res.ok ? await res.json().catch(() => null) : null;
        if (!live) return;
        const mapped: Repo[] = Array.isArray(list)
          ? list.map((r: { full_name?: string; default_branch?: string }) => ({
              fullName: String(r.full_name || ''),
              defaultBranch: String(r.default_branch || 'main'),
            })).filter((r: Repo) => r.fullName)
          : [];
        setRepos(mapped);
        setRepoFullName((prev) => prev || mapped[0]?.fullName || '');
      } catch {
        if (live) setProblem('Could not load your GitHub repositories. Check your connection and try again.');
      } finally {
        if (live) setReposLoading(false);
      }
    })();
    return () => { live = false; };
  }, [source, ghToken, repos.length]);

  // Reading a repository is a real network round-trip, so it happens only once a repo is chosen.
  useEffect(() => {
    if (source !== 'github' || !repoFullName || !ghToken) { setGhFiles(null); return; }
    let live = true;
    setGhFiles(null);
    setGhPath('');
    setGhFilesLoading(true);
    (async () => {
      const [owner, repo] = repoFullName.split('/');
      try {
        const res = await fetch('/api/github/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ghToken}` },
          body: JSON.stringify({ owner, repo }),
        });
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok || !data?.files) {
          setProblem('Could not read that repository. It may be empty, or your GitHub connection may have expired.');
          return;
        }
        const map = data.files as Record<string, string>;
        setGhFiles(map);
        setGhPath(candidatePages(Object.keys(map))[0] || '');
      } catch {
        if (live) setProblem('Could not reach GitHub. Nothing was changed.');
      } finally {
        if (live) setGhFilesLoading(false);
      }
    })();
    return () => { live = false; };
  }, [source, repoFullName, ghToken]);

  const spec = methodSpec(method);
  const targetPath = source === 'navbharat' ? navPath : ghPath;
  const targetLabel = source === 'navbharat'
    ? (apps.find((a) => a.sessionId === appSessionId)?.label || 'your app')
    : repoFullName;

  const canPickTarget = !!targetPath && (source === 'navbharat' ? !!appSessionId : !!repoFullName);

  const missingFields = useMemo(() => missingRequiredFields(method, creds), [method, creds]);

  const upiTypo = method === 'upi' && !!(creds.upiId || '').trim() && !isValidUpiId(creds.upiId);

  /** Store what the user typed in the encrypted vault, exactly the way the Database screen does. */
  const saveToVault = useCallback(async (): Promise<{ status: Outcome['vault']; names: string[] }> => {
    if (!userId) return { status: 'none', names: [] };
    const entered: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = (creds[f.key] || '').trim();
      if (v) entered[f.key] = v;
    }
    const envKeys = Object.entries(paymentEnvKeys(method, entered)).filter(([, v]) => v);
    if (envKeys.length === 0) return { status: 'skipped', names: [] };
    try {
      const existing = await listSecrets(userId);
      for (const [name, value] of envKeys) {
        await Promise.all(
          existing.filter((s) => s.secret_name === name).map((s) => deleteSecret(userId, s.id)),
        );
        await saveSecret(userId, name, value);
      }
      return { status: 'saved', names: envKeys.map(([n]) => n) };
    } catch {
      return { status: 'failed', names: envKeys.map(([n]) => n) };
    }
  }, [userId, spec, creds, method]);

  const addToApp = useCallback(async () => {
    setProblem('');
    if (!canPickTarget) { setProblem('Choose the app and the page first.'); return; }
    if (missingFields.length > 0) { setProblem(`Still needed: ${missingFields.join(', ')}.`); return; }
    if (upiTypo) { setProblem('That UPI ID does not look right. It should look like yourname@okaxis.'); return; }

    setBusy(true);
    try {
      const generated = generatePayment(method, creds, amount.trim());

      // The current source of the page we are about to change.
      const current = source === 'navbharat'
        ? await readAppFile(appSessionId, targetPath)
        : (ghFiles || {})[targetPath] ?? null;
      if (current === null) {
        setOutcome({ ok: false, where: targetLabel, written: [], vault: 'none', vaultNames: [], error: 'Could not read that page, so nothing was changed.' });
        setStep('done');
        return;
      }

      const inserted = insertSnippet(targetPath, current, generated.html);
      if (!inserted.ok) {
        setOutcome({ ok: false, where: targetLabel, written: [], vault: 'none', vaultNames: [], error: inserted.error || 'That page could not be changed.' });
        setStep('done');
        return;
      }

      const patch: Record<string, string> = { [targetPath]: inserted.code };
      if (generated.server && generated.serverFileName) patch[generated.serverFileName] = generated.server;

      // Credentials go to the vault, never into the files. The page only ever carries public values.
      const vault = await saveToVault();

      if (source === 'navbharat') {
        const res = await saveFilesToApp(appSessionId, patch, `Monetization — ${spec.label}`);
        setOutcome({
          ok: res.ok,
          where: targetLabel,
          written: res.written,
          vault: vault.status,
          vaultNames: vault.names,
          undoHint: res.undoHint,
          error: res.error,
          generated,
        });
      } else {
        const [owner, repo] = repoFullName.split('/');
        const branch = repos.find((r) => r.fullName === repoFullName)?.defaultBranch || 'main';
        const res = await fetch('/api/github/push-enhanced', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ghToken}` },
          body: JSON.stringify({
            owner, repo, branch, files: patch,
            message: `Add ${spec.label} payments (NavBharatAI)`,
          }),
        });
        const data = await res.json().catch(() => null);
        setOutcome({
          ok: res.ok && data?.success === true,
          where: `${repoFullName} (${branch})`,
          written: res.ok ? Object.keys(patch) : [],
          vault: vault.status,
          vaultNames: vault.names,
          undoHint: data?.sha ? `Commit ${String(data.sha).slice(0, 7)} — revert it on GitHub to undo.` : undefined,
          error: res.ok ? undefined : (data?.error || 'GitHub refused the change. Nothing was committed.'),
          generated,
        });
      }

      // Whatever happened to the files, the secret must not stay in the browser.
      setCreds((prev) => {
        const kept: Record<string, string> = {};
        for (const f of spec.fields) if (!f.secret && prev[f.key]) kept[f.key] = prev[f.key];
        return kept;
      });
      setStep('done');
    } catch {
      setOutcome({ ok: false, where: targetLabel, written: [], vault: 'none', vaultNames: [], error: 'Could not reach the server. Your app is unchanged.' });
      setStep('done');
    } finally {
      setBusy(false);
    }
  }, [
    canPickTarget, missingFields, upiTypo, method, creds, amount, source, appSessionId, targetPath,
    ghFiles, targetLabel, saveToVault, spec, repoFullName, repos, ghToken,
  ]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => setProblem('Your browser blocked the copy. Select the text and copy it manually.'));
  };

  // ── Screens ──

  const renderAppStep = () => (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {([
          { id: 'navbharat' as Source, label: 'App built here', icon: <Sparkles size={14} /> },
          { id: 'github' as Source, label: 'GitHub repo', icon: <Github size={14} /> },
        ]).map((s) => (
          <button
            key={s.id}
            onClick={() => { setSource(s.id); setProblem(''); }}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold transition-colors ${
              source === s.id
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {source === 'navbharat' ? (
        <div className="rounded-2xl border border-white/8 bg-[#0d1117]">
          <AppTargetPicker
            sessionId={appSessionId}
            onSessionChange={setAppSessionId}
            selectedPath={navPath}
            onPathChange={setNavPath}
            fileFilter={(f) => isHtml(f.path)}
            fileLabel="Page to add the payment button to"
            files={appFiles}
            filesLoading={appFilesLoading}
            apps={apps}
            appsLoading={appsLoading}
          />
        </div>
      ) : !ghToken ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-white/8 bg-[#0d1117] p-4">
          <p className="text-xs leading-relaxed text-gray-400">
            Connect your GitHub account to add payments to a repository you already have. NavBharatAI
            commits to that repository on your behalf — nothing else.
          </p>
          {onConnectGitHub && (
            <button
              onClick={onConnectGitHub}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/15"
            >
              <Github size={14} /> Connect GitHub
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-[#0d1117] p-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Repository</span>
            {reposLoading ? (
              <span className="flex items-center gap-2 py-2 text-xs text-gray-500">
                <Loader2 size={12} className="animate-spin" /> Loading your repositories…
              </span>
            ) : repos.length === 0 ? (
              <span className="py-2 text-xs text-gray-500">No repositories found on that account.</span>
            ) : (
              <select
                value={repoFullName}
                onChange={(e) => setRepoFullName(e.target.value)}
                className="w-full appearance-none rounded-lg border border-white/12 bg-[#0d1117] px-3 py-2.5 text-[13px] text-gray-100 outline-none"
              >
                {repos.map((r) => <option key={r.fullName} value={r.fullName}>{r.fullName}</option>)}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Page to add the payment button to
            </span>
            {ghFilesLoading ? (
              <span className="flex items-center gap-2 py-2 text-xs text-gray-500">
                <Loader2 size={12} className="animate-spin" /> Reading the repository…
              </span>
            ) : !ghFiles ? (
              <span className="py-2 text-xs text-gray-500">Choose a repository first.</span>
            ) : Object.keys(ghFiles).filter(isHtml).length === 0 ? (
              <span className="py-2 text-xs text-amber-300">
                That repository has no HTML page. A payment button has to go on a page — pick another
                repository, or add the code to your own component from the snippet shown at the end.
              </span>
            ) : (
              <select
                value={ghPath}
                onChange={(e) => setGhPath(e.target.value)}
                className="w-full appearance-none rounded-lg border border-white/12 bg-[#0d1117] px-3 py-2.5 text-[13px] text-gray-100 outline-none"
              >
                {Object.keys(ghFiles).filter(isHtml).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </label>
        </div>
      )}

      <button
        disabled={!canPickTarget}
        onClick={() => { setProblem(''); setStep('method'); }}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3.5 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue <ChevronRight size={16} />
      </button>
    </div>
  );

  const renderMethodStep = () => (
    <div className="flex flex-col gap-2.5">
      {PAY_METHODS.map((m) => (
        <button
          key={m.id}
          onClick={() => { setMethod(m.id); setCreds({}); setProblem(''); setStep('details'); }}
          className="flex flex-col items-start gap-1 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.06]"
        >
          <div className="flex w-full items-center gap-2">
            <span className="text-sm font-bold text-gray-100">{m.label}</span>
            {m.noServerNeeded && (
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-300">
                No server needed
              </span>
            )}
            <ChevronRight size={14} className="ml-auto shrink-0 text-gray-500" />
          </div>
          <p className="text-xs leading-relaxed text-gray-400">{m.summary}</p>
          <p className="text-[11px] font-medium text-amber-300/80">{m.cost}</p>
        </button>
      ))}
    </div>
  );

  const renderDetailsStep = () => (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/8 bg-[#0d1117] p-4">
        <p className="text-sm font-bold text-gray-100">{spec.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{spec.summary}</p>
        {spec.dashboardLink && (
          <a
            href={spec.dashboardLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
          >
            <ExternalLink size={12} /> Open the dashboard to get these values
          </a>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {spec.fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {f.label}{f.optional ? ' (optional)' : ''}
            </span>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={creds[f.key] || ''}
              placeholder={f.placeholder}
              onChange={(e) => setCreds((p) => ({ ...p, [f.key]: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-[#0d1117] px-3.5 py-3 font-mono text-[13px] text-gray-100 placeholder:text-gray-600 outline-none focus:border-amber-500/50"
            />
            {f.where && (
              <span className="text-[11px] leading-relaxed text-gray-500">
                Where to find this: <span className="text-gray-400">{f.where}</span>
              </span>
            )}
          </label>
        ))}

        {method === 'upi' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Amount in ₹ (optional)
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              placeholder="Leave empty to let the customer type it"
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0d1117] px-3.5 py-3 text-[13px] text-gray-100 placeholder:text-gray-600 outline-none focus:border-amber-500/50"
            />
          </label>
        )}
      </div>

      {upiTypo && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          That UPI ID does not look right — it should look like <span className="font-mono">yourname@okaxis</span>.
        </p>
      )}

      {spec.fields.some((f) => f.secret) && (
        <p className="flex items-start gap-2 rounded-xl border border-indigo-500/15 bg-indigo-500/[0.06] p-3 text-[11px] leading-relaxed text-gray-400">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-indigo-400" />
          {userId ? (
            <span>
              Your secret key is encrypted into <span className="font-semibold text-white">Settings → Secrets &amp; Keys</span>,
              never written into your app&apos;s files, and cleared from this screen once it is stored.
            </span>
          ) : (
            <span>
              You are signed out, so the secret key cannot be stored. It will not be written into your
              app either — you will need to set it on your server yourself.
            </span>
          )}
        </p>
      )}

      <button
        disabled={busy}
        onClick={addToApp}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3.5 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <IndianRupee size={16} />}
        {busy ? 'Adding it to your app…' : 'Add it to my app'}
      </button>
      <p className="text-center text-[11px] text-gray-500">
        Writes to <span className="font-mono text-gray-400">{targetPath || '—'}</span> in {targetLabel}
      </p>
    </div>
  );

  const renderDoneStep = () => {
    const o = outcome;
    if (!o) return null;
    return (
      <div className="flex flex-col gap-4">
        <div className={`flex items-start gap-3 rounded-2xl border p-4 ${
          o.ok ? 'border-green-500/25 bg-green-500/[0.07]' : 'border-red-500/25 bg-red-500/[0.07]'
        }`}>
          {o.ok ? <Check size={16} className="mt-0.5 shrink-0 text-green-400" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />}
          <div className="min-w-0">
            <p className={`text-sm font-bold ${o.ok ? 'text-green-300' : 'text-red-300'}`}>
              {o.ok ? `Added to ${o.where}` : 'Nothing was changed'}
            </p>
            {o.ok ? (
              <ul className="mt-1.5 space-y-0.5 text-xs text-gray-400">
                {o.written.map((p) => <li key={p} className="break-all font-mono">{p}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-gray-400">{o.error}</p>
            )}
            {o.ok && o.undoHint && <p className="mt-2 text-[11px] text-gray-500">{o.undoHint}</p>}
          </div>
        </div>

        {o.vault !== 'none' && o.vault !== 'skipped' && (
          <div className={`flex items-start gap-2.5 rounded-xl border p-3 text-[11px] leading-relaxed ${
            o.vault === 'saved' ? 'border-indigo-500/20 bg-indigo-500/[0.06] text-gray-400' : 'border-amber-500/25 bg-amber-500/[0.07] text-amber-200'
          }`}>
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-indigo-400" />
            {o.vault === 'saved' ? (
              <span>
                Saved to Settings → Secrets &amp; Keys as{' '}
                <span className="font-mono text-gray-300">{o.vaultNames.join(', ')}</span>. NavBharatAI
                uses these automatically when it builds your app.
              </span>
            ) : (
              <span>
                Your keys could NOT be saved to Secrets &amp; Keys. Open Settings → Secrets &amp; Keys and
                add {o.vaultNames.join(', ')} yourself, or your payments will not work.
              </span>
            )}
          </div>
        )}

        {o.ok && o.generated && (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-[#0d1117] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-300">What to do next</p>
            <ol className="space-y-2">
              {o.generated.nextSteps.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-400">
                  <span className="font-bold text-amber-400">{i + 1}.</span> {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {o.ok && o.generated?.server && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {o.generated.serverFileName} — this must run on your server
              </span>
              <button
                onClick={() => copy(o.generated!.server!, 'server')}
                className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
              >
                {copied === 'server' ? <Check size={11} /> : <Copy size={11} />}
                {copied === 'server' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-xl border border-white/8 bg-[#0d1117] p-3 text-[11px] leading-relaxed text-gray-300">
              {o.generated.server}
            </pre>
          </div>
        )}

        <button
          onClick={() => { setOutcome(null); setStep('method'); setCreds({}); setProblem(''); }}
          className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-gray-300 hover:border-white/20"
        >
          Add another payment method
        </button>
      </div>
    );
  };

  const backTo: Record<Step, Step | null> = { app: null, method: 'app', details: 'method', done: null };
  const heading: Record<Step, string> = {
    app: 'Which app do you want to take money in?',
    method: 'How should your customers pay?',
    details: 'Your details',
    done: 'Done',
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0d1117]">
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-3">
        {backTo[step] && (
          <button
            onClick={() => { setProblem(''); setStep(backTo[step]!); }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-gray-200"
            aria-label="Go back"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <IndianRupee size={16} className="shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-gray-100">{heading[step]}</p>
          {step !== 'app' && step !== 'done' && (
            <p className="truncate text-[11px] text-gray-500">{targetLabel} · {targetPath}</p>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {problem && (
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-200">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {problem}
          </p>
        )}
        {step === 'app' && renderAppStep()}
        {step === 'method' && renderMethodStep()}
        {step === 'details' && renderDetailsStep()}
        {step === 'done' && renderDoneStep()}
      </div>
    </div>
  );
};

export default MonetizationWizard;

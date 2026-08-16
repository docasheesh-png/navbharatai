// "Publish to Nav App Store" — the button that sits beside Download, on a finished build.
//
// The Nav App Store carries only apps NavBharatAI built, so this is the natural place for it: the
// user has just watched their app get built and is looking at the file. The server already has those
// bytes (it streams the GitHub artifact through /api/mobile-ship/download), so publishing needs NO
// upload — the user never handles the file at all.
//
// HONESTY RULES THIS FORM FOLLOWS (rule 2):
//  • Only offered for an .apk. The store installs apps; a .aab is a Play Store bundle that no phone
//    can install, so offering it here would promise something that cannot work.
//  • The server's own words are shown verbatim — they are written to say what to DO (store not open
//    yet, artifact expired, plan/size limits).
//  • Success says PENDING REVIEW, never "published". Nothing in the store goes public without an
//    admin approving it, and implying otherwise would be a lie about the one rule the store rests on.

import React, { useState } from 'react';
import { Store, Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface Props {
  owner: string;
  repo: string;
  artifactId: string | number;
  /** Sends the user's GitHub auth the same way the Download button does. */
  ghHeaders: () => Promise<Record<string, string>>;
  /** Prefills the app name so a non-technical user is not typing it from memory. */
  defaultAppName?: string;
}

// MUST match STORE_CATEGORIES in src/server/routes/navStore.ts exactly — validateSubmission rejects any
// category not on the server's list, and this is now the ONLY way to publish, so a mismatch is a real
// 400 the user cannot get past. A source-contract test (navStorePublishFromBuild.test.ts) locks the two
// lists together so they can never drift apart again.
const CATEGORIES = [
  'Business', 'Education', 'Entertainment', 'Finance', 'Food & Drink', 'Games',
  'Health & Fitness', 'Lifestyle', 'News', 'Productivity', 'Shopping', 'Social', 'Tools', 'Travel',
];

export function PublishToNavStore({ owner, repo, artifactId, ghHeaders, defaultAppName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [form, setForm] = useState({
    appName: defaultAppName ?? '',
    shortDescription: '',
    description: '',
    category: 'Productivity',
    versionName: '1.0.0',
    developerName: '',
    developerEmail: '',
    // The server REQUIRES this consent (validateSubmission) — it is what makes a takedown enforceable.
    acceptedTerms: false,
  });

  const set = (k: 'appName' | 'shortDescription' | 'description' | 'category' | 'versionName' | 'developerName' | 'developerEmail') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (): Promise<void> => {
    setBusy(true); setError(''); setDone('');
    try {
      const res = await fetch('/api/nav-store/publish-from-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await ghHeaders()) },
        body: JSON.stringify({ owner, repo, artifactId: String(artifactId), ...form }),
      });
      const data = await res.json().catch(() => null);
      // The server words every refusal to tell the user what to do next; a generic line here would
      // throw that away.
      if (!res.ok) { setError(data?.error || 'Could not publish your app.'); return; }
      setDone(data?.message || 'Sent for review.');
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-green-500/25 bg-green-500/5 p-3">
        <p className="flex items-start gap-2 text-sm text-green-300 leading-snug">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          <span>
            {done}
            {/* Never "published" — an admin decides, and saying otherwise would break the store's one rule. */}
            <span className="block text-[11px] text-white/50 mt-1">
              It is waiting for review. You will find it under your submissions once a reviewer has looked at it.
            </span>
          </span>
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
      >
        <Store size={16} />
        Publish to App Mart
      </button>
    );
  }

  // Mirror the server's validateSubmission so the button is only enabled when the submit will actually
  // pass — otherwise the user meets a silent 400. (Server stays the source of truth; this only prevents
  // a doomed request.)
  const ready =
    form.appName.trim().length >= 2 &&
    form.shortDescription.trim().length >= 10 &&
    form.description.trim().length >= 30 &&
    form.developerName.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(form.developerEmail.trim()) &&
    form.acceptedTerms;

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-1.5"><Store size={14} /> Publish to App Mart</h4>
          <p className="text-[11px] text-white/50 leading-snug mt-0.5">
            NavBharatAI sends this build straight to the store — you do not need to upload the file.
            A reviewer checks every app before it goes live.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white shrink-0" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-2">
        <input value={form.appName} onChange={set('appName')} placeholder="App name"
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
        <input value={form.shortDescription} onChange={set('shortDescription')} placeholder="One line about your app"
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
        <textarea value={form.description} onChange={set('description')} placeholder="What does your app do? (at least 30 characters)" rows={3}
          className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
        <div className="grid grid-cols-2 gap-2">
          <select value={form.category} onChange={set('category')}
            className="bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={form.versionName} onChange={set('versionName')} placeholder="Version (e.g. 1.0.0)"
            className="bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.developerName} onChange={set('developerName')} placeholder="Your name"
            className="bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
          <input value={form.developerEmail} onChange={set('developerEmail')} placeholder="Your email" type="email"
            className="bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30" />
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-[11px] text-white/60 leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={form.acceptedTerms}
          onChange={(e) => setForm((f) => ({ ...f, acceptedTerms: e.target.checked }))}
          className="mt-0.5 accent-emerald-500 flex-shrink-0"
        />
        <span>
          I made this app with NavBharatAI or have the right to publish it, it contains no malware, and I
          understand it will be removed if it harms users.
        </span>
      </label>

      <button
        onClick={() => void submit()}
        disabled={busy || !ready}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Store size={16} />}
        {busy ? 'Sending your app…' : 'Send for review'}
      </button>

      {busy && (
        <p className="text-[11px] text-white/45 leading-snug">
          Your app is being fetched from the build and scanned for malware. This takes a moment.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300 leading-snug">
          <AlertTriangle size={13} className="shrink-0 mt-px" /><span>{error}</span>
        </p>
      )}
    </div>
  );
}

export default PublishToNavStore;

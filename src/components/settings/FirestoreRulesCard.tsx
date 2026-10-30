import { useState } from 'react';
import { Copy, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { SECURE_FIRESTORE_RULES, firestoreRulesConsoleUrl, FIRESTORE_RULES_STEPS } from '../../lib/firestoreRules';

/**
 * The last step of connecting Firebase: safe Firestore rules, one Copy, one deep link, three steps
 * in Hindi + English. Without it a user's database is left in "test mode" (open to everyone, then
 * auto-locked after 30 days) — the app works today and breaks next month.
 */
export function FirestoreRulesCard({ projectId, rules }: { projectId?: string; rules?: string }) {
  const text = rules && rules.trim() ? rules : SECURE_FIRESTORE_RULES;
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setShow(true); // clipboard blocked → reveal the text so it can be selected by hand
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-3" data-testid="firestore-rules-card">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-ink">Last step: protect your data / आख़िरी कदम: data सुरक्षित करें</p>
          <p className="text-[11px] text-muted leading-relaxed">
            Only the signed-in user sees their own data; nothing is open to strangers. (सिर्फ़ user अपना data देखे, कोई अजनबी नहीं।)
          </p>
        </div>
      </div>
      <ol className="space-y-1.5 text-[12px] text-muted">
        {FIRESTORE_RULES_STEPS.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent-text font-bold shrink-0">{i + 1}.</span>
            <span>{s.en} <span className="text-faint">· {s.hi}</span></span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-on-accent text-xs font-bold">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied ✓' : 'Copy rules'}
        </button>
        <a href={firestoreRulesConsoleUrl(projectId)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-line text-xs font-bold text-ink hover:bg-raised">
          <ExternalLink className="w-3.5 h-3.5" /> Open Firebase Rules
        </a>
        <button type="button" onClick={() => setShow((v) => !v)} className="text-[11px] text-accent-text underline">
          {show ? 'Hide rules' : 'See rules'}
        </button>
      </div>
      {show && (
        <textarea readOnly value={text} rows={14} onFocus={(e) => e.currentTarget.select()}
          aria-label="Firestore security rules"
          className="w-full bg-surface border border-line rounded-xl p-3 text-[11px] font-mono text-ink" />
      )}
      <p className="text-[11px] text-muted leading-relaxed" data-testid="firestore-rules-perapp-note">
        Each app needs its own rules — Pro chat writes them for your app (with a Copy button) whenever the app saves data. This card is only a safe starter. (हर app के rules अलग होते हैं — Pro chat आपकी app के लिए खुद बनाकर Copy के साथ दिखाता है; यह सिर्फ़ शुरुआती सुरक्षित rules हैं।)
      </p>
      <p className="text-[10px] text-faint leading-relaxed">
        No Firestore yet? In Firebase: Build → Firestore Database → Create database → choose a location near India (asia-south1) → then do the 3 steps above.
      </p>
    </div>
  );
}

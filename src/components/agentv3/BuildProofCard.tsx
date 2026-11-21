// One finished build's proof, rendered INSIDE the chat timeline at the end of that build's own turn
// (admin 2026-11-21, phone screenshot): the "NavBharatAI checked your app" card, the build-health row
// and the feedback prompt. They used to be pinned below the whole chat, so newer replies landed above
// them; buildChatBlocks now places each build's proof under its own final message (buildProof.ts).
//
// On a phone the check card used to fill the screen with no way to close it. It now shows only its
// headline there, with the individual checks behind "Show checks", and a Dismiss X hides it for good
// for THIS build (remembered per build id).

import { useState } from 'react';
import { AlertCircle, CheckCircle2, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { simplifyHealthLines } from '../../lib/buildHealthDisplay';
import { trackEvent } from '../../lib/analytics';
import type { BuildHealth, BuildProof } from './agentV3Types';
import { feedbackKey, isProofDismissed, rememberProofDismissed } from './buildProof';

export function BuildProofCard({ proof }: { proof: BuildProof }) {
  const fbKey = proof.feedback ? feedbackKey(proof) : null;
  return (
    <div className="my-2">
      {proof.verification && <VerificationCard proofKey={proof.key} verification={proof.verification} />}
      {proof.buildHealth && <BuildHealthCard health={proof.buildHealth} />}
      {fbKey && <BuildFeedback storageKey={fbKey} workspaceId={proof.workspaceId} buildId={proof.buildId} />}
    </div>
  );
}

/**
 * THE PROOF THAT WE ACTUALLY CHECKED (gap analysis 2026-09-10). After a build, NavBharatAI drives a
 * real browser through the app's own forms — fills them in, submits, RELOADS, and confirms the entry
 * survived. A FAILURE IS AS VISIBLE AS A PASS, in the same card and the same place — the wording comes
 * from the server (journeyUserSummary) so it cannot be softened here.
 */
function VerificationCard({ proofKey, verification }: { proofKey: string; verification: NonNullable<BuildProof['verification']> }) {
  const [dismissed, setDismissed] = useState(() => isProofDismissed(proofKey));
  const [showChecks, setShowChecks] = useState(false);
  if (dismissed) return null;
  const ok = verification.ok;
  return (
    <div
      data-testid="build-proof-card"
      className={`mx-auto my-1 max-w-[92%] rounded-xl border px-3 py-2 text-sm ${
        ok ? 'border-success/40 bg-success/10 text-success' : 'border-warn/40 bg-warn/10 text-warn'}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" aria-hidden="true">{ok ? '✅' : '⚠️'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{verification.headline}</div>
          <button
            type="button"
            onClick={() => setShowChecks((s) => !s)}
            aria-expanded={showChecks}
            className="sm:hidden mt-1 text-xs underline text-muted hover:text-ink"
          >
            {showChecks ? 'Hide checks' : 'Show checks'}
          </button>
          <ul className={`${showChecks ? 'block' : 'hidden'} sm:block mt-1 space-y-0.5 text-xs opacity-90`}>
            {verification.steps.map((line, i) => (
              <li key={i} className="flex gap-1.5"><span aria-hidden="true">•</span><span className="flex-1">{line}</span></li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => { rememberProofDismissed(proofKey); setDismissed(true); }}
          className="shrink-0 p-0.5 rounded text-faint hover:text-ink transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * P-UX.6 — CSAT feedback on a finished build. Fires trackEvent('feedback', …) and remembers the answer
 * per BUILD (feedbackKey) so each build is asked once — not once per workspace, which silenced the
 * question for every later build of the same app.
 */
function BuildFeedback({ storageKey, workspaceId, buildId }: { storageKey: string; workspaceId?: string; buildId?: string }) {
  const [rated, setRated] = useState<null | 'up' | 'down'>(() => {
    try { const v = localStorage.getItem(storageKey); return v === 'up' || v === 'down' ? v : null; } catch { return null; }
  });
  const rate = (score: 'up' | 'down') => {
    if (rated) return;
    setRated(score);
    try { localStorage.setItem(storageKey, score); } catch { /* ignore */ }
    try { trackEvent('feedback', { score: score === 'up' ? 1 : -1, surface: 'agentv3_build', workspaceId, ...(buildId ? { buildId } : {}) }); } catch { /* best-effort */ }
  };
  if (rated) {
    return <div className="mt-1 text-[11px] text-faint">Thanks for the feedback{rated === 'down' ? ' — we’ll keep improving.' : '!'}</div>;
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
      <span>Was this build helpful?</span>
      <button onClick={() => rate('up')} aria-label="Helpful" className="p-1 rounded hover:bg-raised hover:text-success transition-colors">
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => rate('down')} aria-label="Not helpful" className="p-1 rounded hover:bg-raised hover:text-danger transition-colors">
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * R2 §4.6 — the user-facing build-health card: the OBJECTIVE readiness verdict from the mandatory
 * quality gate. The readiness engine's lines are deliberately FORENSIC (file:line) for the repair loop
 * and the admin Report; the CARD renders SHORT plain-language lines via simplifyHealthLines —
 * de-duplicated and capped (admin 2026-08-02). Every detail stays available in the Report.
 */
function BuildHealthCard({ health }: { health: BuildHealth }) {
  if (health.unassessed) {
    return (
      <div className="mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] border-warn/40 bg-warn/10">
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 text-warn shrink-0" />
          <span className="text-warn">Build health: Not checked — the readiness check timed out</span>
        </div>
      </div>
    );
  }
  const ready = health.ready;
  const blockers = simplifyHealthLines(health.blockers, 3);
  const warnings = simplifyHealthLines(health.warnings, 2);
  const more = blockers.more + warnings.more;
  return (
    <div className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] ${ready ? 'border-success/40 bg-success/10' : 'border-warn/40 bg-warn/10'}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        {ready
          ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
          : <AlertCircle className="w-3.5 h-3.5 text-warn shrink-0" />}
        {/* "READY" alone overstated an app nobody had seen run (admin screenshot 2026-08-22). The
            server reports whether the app was actually seen running; when it was not, the label says
            so rather than implying proof. `undefined` (older payload) keeps today's wording. */}
        <span className={ready ? 'text-success' : 'text-warn'}>
          Build health: {ready ? (health.provenRunning === false ? 'READY (not verified)' : 'READY') : 'NOT READY'}
        </span>
        <span className="text-faint">· {health.score}/100</span>
      </div>
      {blockers.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-warn">
          {blockers.lines.map((b, i) => (
            <li key={`b${i}`} className="flex gap-1"><span className="text-warn">✗</span><span>{b}</span></li>
          ))}
        </ul>
      )}
      {warnings.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-muted">
          {warnings.lines.map((w, i) => (
            <li key={`w${i}`} className="flex gap-1"><span className="text-faint">•</span><span>{w}</span></li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <div className="mt-1 text-[10px] text-faint">+{more} more · see Report for details</div>
      )}
    </div>
  );
}

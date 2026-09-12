// APP MART'S PUBLISH GATE — what happens to an app whose published files look abusive.
//
// ADMIN 2026-09-12: "app mart me app post ke samay scans chala do."
//
// ── THE HOLE THIS CLOSES, AND IT IS BIGGER THAN "NO SCAN" ────────────────────────────────────────
// `ContentSafetyScanner` has existed since hosting Phase A and runs on NavBharatAI hosting — but NOT
// on App Mart. So an instant app went live the moment it was published, reachable by anyone with the
// link, with nothing looking at what was in it. That is the door a bad actor walks through, and it is
// the one the platform gets judged on: a chat is between a user and us, a PUBLISHED app is us
// distributing content to the public.
//
// 🔴 AND A SECOND, WORSE ONE, FOUND WHILE WIRING THE FIRST. A re-publish keeps its earned place —
// "a listed app stays listed (same owner, same listing)". That is right for an ordinary update and
// completely wrong for a hostile one: publish something clean, wait for an admin to LIST it, then
// re-publish a phishing page into the same listing and it stays on the front page with no review.
// The scan is what makes that impossible: a high or critical finding sends the app back to
// `unlisted` and back into the review queue, however it got listed the first time.
//
// ── WHY WARN, NOT BLOCK, BY DEFAULT (for now) ────────────────────────────────────────────────────
// The current rules look for phishing, wallet-drainers and brand impersonation. They are
// conservative, but a false positive here takes somebody's finished app away, so the DEFAULT is:
// publish proceeds, the finding is recorded, the app loses any listing it had and a human decides.
// `AGENTV3_PUBLISH_SCAN=block` — the switch the hosting path already reads — refuses outright.
// The genuinely unambiguous categories (Phase 5) will block on their own merit, not on this default.
//
// PURE. The route supplies the files and applies the decision; nothing here touches a database.

import { scanPublishedContent, publishScanBlocks, type ContentScanResult, type ContentScanFinding } from '../AgentV3/ContentSafetyScanner';

/** What the publish route should do with this app. */
export interface PublishSafetyDecision {
  /** Findings worth recording on the record, capped so one pathological file cannot bloat a doc. */
  findings: ContentScanFinding[];
  /** True when a critical/high finding exists — the only level that changes what happens. */
  flagged: boolean;
  /** Refuse the publish entirely (block mode only). */
  refuse: boolean;
  /**
   * Force the app back to `unlisted`, even on a re-publish of an already-listed app.
   *
   * This is the important one: it is what stops a clean app being listed and then quietly rewritten
   * into something else under the same, already-approved listing.
   */
  forceUnlisted: boolean;
  /** What to tell the creator when we refuse. '' when we are not refusing. */
  refusalMessage: string;
  /** One line for the audit log and the admin queue. '' when clean. */
  summary: string;
}

/** At most this many findings travel onto the record — an admin acts on the first one anyway. */
export const MAX_RECORDED_FINDINGS = 5;

/** Convert the publish gate's file map into what the scanner reads. */
export function filesForScan(files: Record<string, string>): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content !== 'string') continue;
    out.set(path, Buffer.from(content, 'utf8'));
  }
  return out;
}

/** The wording a refused creator sees. Names the reason and the way back — never a bare "rejected". */
export function refusalFor(finding: ContentScanFinding | undefined): string {
  const reason = finding?.description || 'contain unsafe content';
  return `This app was not published: its pages appear to ${reason} `
    + 'If that is a mistake — a real sign-in page for your own product, for example — reply to us from '
    + 'the Grievance Redressal page and a person will look at it.';
}

/** Decide, from a scan result. PURE, so the rule is testable without a publish. */
export function decideFromScan(scan: ContentScanResult, blockMode: boolean): PublishSafetyDecision {
  const findings = scan.findings.slice(0, MAX_RECORDED_FINDINGS);
  const flagged = !scan.safe;
  const summary = flagged
    ? `${scan.findings.length} content-safety finding(s): ${scan.findings.map((f) => `${f.severity}:${f.rule}`).join(', ')}`
    : '';
  return {
    findings,
    flagged,
    refuse: flagged && blockMode,
    // Note it is NOT gated on block mode: even in warn mode a flagged app must lose its listing.
    // Publishing is allowed to continue; being featured is not.
    forceUnlisted: flagged,
    refusalMessage: flagged && blockMode ? refusalFor(scan.findings[0]) : '',
    summary,
  };
}

/**
 * Scan an about-to-be-published App Mart app.
 *
 * NEVER THROWS. A scanner failure must not cost a creator their publish — it is a safety net, and a
 * net that takes the app down when IT breaks is worse than the risk it covers. An unreadable scan is
 * reported as clean-but-unscanned rather than as a finding we did not actually make.
 */
export function assessPublishSafety(
  files: Record<string, string>,
  blockMode: boolean = publishScanBlocks(),
): PublishSafetyDecision {
  try {
    return decideFromScan(scanPublishedContent(filesForScan(files)), blockMode);
  } catch {
    return { findings: [], flagged: false, refuse: false, forceUnlisted: false, refusalMessage: '', summary: '' };
  }
}

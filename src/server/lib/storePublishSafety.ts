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

import {
  scanPublishedContent, publishScanBlocks, scannableText,
  type ContentScanResult, type ContentScanFinding, type ContentFindingSeverity,
} from '../AgentV3/ContentSafetyScanner';
import { classifyPublishedText, illegalRefusal, type PublishContentClass } from '../AgentV3/illegalContentRules';

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
  /**
   * What the app IS, as opposed to what is wrong with it (Phase 5).
   *
   * `illegal` refuses unconditionally. `adult` is lawful and rides the creator's own +18 setting —
   * their app is marked 18+ and hidden from viewers who have not turned that on. `general` is
   * everything else and changes nothing.
   */
  contentClass: PublishContentClass;
  /**
   * True when the app carries adult content but the creator has NOT turned on the 18+ setting.
   *
   * Deliberately not a refusal: they are allowed to build it, they simply have not said they are an
   * adult yet. The app publishes UNLISTED and a human decides, and the creator is told which switch
   * would have made it ordinary.
   */
  adultWithoutOptIn: boolean;
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

/** What the caller knows about the publisher, for the adult tier. */
export interface PublisherContext {
  /** Has this creator turned on the 18+ setting? (src/lib/adultContent.ts) */
  adultOptIn: boolean;
}

/**
 * Decide, from a scan result. PURE, so the rule is testable without a publish.
 *
 * 🔒 THE ORDER IS THE POLICY. `illegal` is answered FIRST and ignores `blockMode` entirely — the
 * admin's instruction was "sirf saaf-saaf wale cases par publish BLOCK karo", and a category that is
 * unlawful for everyone must not be reachable by flipping an operations switch. `blockMode` continues
 * to govern only the older, judgement-call rules (phishing shapes and the like), where a false
 * positive costs an honest creator their app and caution is the right default.
 */
export function decideFromScan(
  scan: ContentScanResult,
  blockMode: boolean,
  classified: ReturnType<typeof classifyPublishedText> = { findings: [], contentClass: 'general' },
  publisher: PublisherContext = { adultOptIn: false },
): PublishSafetyDecision {
  const illegal = classified.findings.filter((f) => f.contentClass === 'illegal');
  const adult = classified.contentClass === 'adult';
  const adultWithoutOptIn = adult && !publisher.adultOptIn;

  // Everything the admin queue shows, in one list. The illegal/adult findings carry NO matched text
  // — see illegalContentRules.ts for why that differs from the phishing rules deliberately.
  const findings: ContentScanFinding[] = [
    ...classified.findings.map((f) => ({
      severity: (f.contentClass === 'illegal' ? 'critical' : 'medium') as ContentFindingSeverity,
      rule: f.id,
      description: f.description,
      matchSnippet: '',
    })),
    ...scan.findings,
  ].slice(0, MAX_RECORDED_FINDINGS);

  const flagged = !scan.safe || classified.findings.length > 0;
  const parts: string[] = [];
  if (classified.findings.length) parts.push(classified.findings.map((f) => `${f.contentClass}:${f.id}`).join(', '));
  if (scan.findings.length) parts.push(scan.findings.map((f) => `${f.severity}:${f.rule}`).join(', '));

  if (illegal.length > 0) {
    return {
      findings,
      flagged: true,
      refuse: true,               // unconditional — see the note above
      forceUnlisted: true,
      refusalMessage: illegalRefusal(illegal[0]),
      summary: parts.join(' | '),
      contentClass: 'illegal',
      adultWithoutOptIn: false,
    };
  }

  return {
    findings,
    flagged,
    refuse: !scan.safe && blockMode,
    // NOT gated on block mode: a flagged app — including adult content published by somebody who has
    // not turned the 18+ switch on — must lose its listing. Publishing is allowed; being featured is
    // earned.
    forceUnlisted: flagged,
    refusalMessage: !scan.safe && blockMode ? refusalFor(scan.findings[0]) : '',
    summary: parts.join(' | '),
    contentClass: classified.contentClass,
    adultWithoutOptIn,
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
  publisher: PublisherContext = { adultOptIn: false },
): PublishSafetyDecision {
  try {
    const scanned = filesForScan(files);
    return decideFromScan(
      scanPublishedContent(scanned),
      blockMode,
      classifyPublishedText(scannableText(scanned)),
      publisher,
    );
  } catch {
    return {
      findings: [], flagged: false, refuse: false, forceUnlisted: false, refusalMessage: '',
      summary: '', contentClass: 'general', adultWithoutOptIn: false,
    };
  }
}

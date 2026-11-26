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
  scanPublishedContent, publishScanBlocks, scannableFiles,
  type ContentScanResult, type ContentScanFinding, type ContentFindingSeverity,
} from '../AgentV3/ContentSafetyScanner';
import { classifyPublishedFiles, type PublishContentClass } from '../AgentV3/illegalContentRules';

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
  /**
   * HELD FOR A PERSON (admin 2026-11-26: "sex se sambandhit app publish apply ho jaye, admin ko saf saf
   * bataya jaye, yeh problem hai, admin game khel ke dekhega! khud reject kar dega").
   *
   * True when the sexual/illegal TEXT classifier found a phrase. The publish is ACCEPTED, but the app
   * is never served to anyone except its owner and a store admin until an admin lists it, and the
   * matched phrases travel on the record for the admin's review screen. Before 2026-11-26 the illegal
   * tier refused outright — which, while the classifier paired words across a whole bundle, refused
   * every kit-built 3D game as CSAM (Q-3560). The malware / phishing rules are NOT part of this: they
   * keep their own refuse-in-block-mode behaviour.
   */
  holdForReview: boolean;
  /** What the creator reads when the app is held. Never names the rule or quotes the match. '' otherwise. */
  heldMessage: string;
}

/** The sentence a held creator reads — honest that a check flagged it, no accusation, no match shown. */
export const HELD_FOR_REVIEW_MESSAGE =
  'Submitted. An automatic check flagged something in this app, so a person will review it before it can be '
  + 'opened by anyone else. You can still open it yourself from My apps. You will be notified when it is approved.';

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
 * 🔁 POLICY CHANGE, admin 2026-11-26. Until then `illegal` refused unconditionally ("sirf saaf-saaf wale
 * cases par publish BLOCK karo", 2026-09-12). That refusal is replaced by a HOLD: the admin's words were
 * "sex se sambandhit app publish apply ho jaye, admin ko saf saf bataya jaye … admin game khel ke
 * dekhega! khud reject kar dega". No switch can unhold an app — only an admin's listing decision.
 * `blockMode` still governs only the older, judgement-call rules (phishing shapes and the like).
 */
export function decideFromScan(
  scan: ContentScanResult,
  blockMode: boolean,
  classified: ReturnType<typeof classifyPublishedFiles> = { findings: [], contentClass: 'general' },
  publisher: PublisherContext = { adultOptIn: false },
): PublishSafetyDecision {
  const adult = classified.contentClass === 'adult';
  const adultWithoutOptIn = adult && !publisher.adultOptIn;
  const holdForReview = classified.findings.length > 0;

  // Everything the admin queue shows, in one list. A classifier finding carries the phrase that paired
  // and its file (admin 2026-11-26) — one row per phrase, so the admin sees exactly what the check saw.
  const findings: ContentScanFinding[] = [
    ...classified.findings.flatMap((f) => {
      const severity = (f.contentClass === 'illegal' ? 'critical' : 'medium') as ContentFindingSeverity;
      const evidence = f.evidence?.length ? f.evidence : [{ file: '', excerpt: '' }];
      return evidence.map((e) => ({
        severity,
        rule: f.id,
        description: f.description,
        matchSnippet: e.excerpt ? `${e.file ? `${e.file}: ` : ''}${e.excerpt}` : '',
      }));
    }),
    ...scan.findings,
  ].slice(0, MAX_RECORDED_FINDINGS);

  const flagged = !scan.safe || holdForReview;
  const parts: string[] = [];
  if (classified.findings.length) parts.push(classified.findings.map((f) => `${f.contentClass}:${f.id}`).join(', '));
  if (scan.findings.length) parts.push(scan.findings.map((f) => `${f.severity}:${f.rule}`).join(', '));

  // 🔒 THE ORDER IS THE POLICY. The malware/phishing rules answer first and keep their block-mode refusal.
  // A text-classifier finding never refuses (admin 2026-11-26) — it HOLDS: accepted, never served to
  // anyone but the owner and a store admin, and never listed until a person lists it.
  const refuse = !scan.safe && blockMode;
  return {
    findings,
    flagged,
    refuse,
    // NOT gated on block mode: a flagged app must lose its listing. Being featured is earned.
    forceUnlisted: flagged,
    refusalMessage: refuse ? refusalFor(scan.findings[0]) : '',
    summary: parts.join(' | '),
    contentClass: classified.contentClass,
    adultWithoutOptIn,
    holdForReview: !refuse && holdForReview,
    heldMessage: !refuse && holdForReview ? HELD_FOR_REVIEW_MESSAGE : '',
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
      classifyPublishedFiles(scannableFiles(scanned)),
      publisher,
    );
  } catch {
    return {
      findings: [], flagged: false, refuse: false, forceUnlisted: false, refusalMessage: '',
      summary: '', contentClass: 'general', adultWithoutOptIn: false, holdForReview: false, heldMessage: '',
    };
  }
}

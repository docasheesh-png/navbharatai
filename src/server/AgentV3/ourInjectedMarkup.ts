// AgentV3 — OUR MARKUP IS NEVER GRADED AS THE USER'S DESIGN (autopsy 9c612cdb, 2026-10-12).
//
// 🔴 THE DEFECT. That build's `DESIGN_CONSISTENCY` line counted 8 spacing values off the 4px grid. Seven were
// in the app's `src/index.css`; the eighth was `gap:6px` inside the "made by NavBharatAI" badge that WE put
// into the app's `index.html` (appSignature.ts). The red honesty banner we add for a demo login carries
// three more (`padding:10px 48px 10px 14px`), so a badge plus a banner alone produced a false
// "Worst: index.html (4)" on an app whose author wrote no CSS at all. The journey check had already met the
// same class (autopsy 2b1f845e: our badge's checkbox read as the app taking input) and got its own strip;
// the design lint and the spacing snap never did.
//
// 🔒 WHY BLANK AND NEVER REMOVE. Two readers need this and one of them WRITES. The spacing snap matches
// declarations on a copy and splices new values into the ORIGINAL at the same offsets, so the copy must keep
// every offset (`stripCommentsForMarkup` is length-preserving for the same reason). And the original is what
// gets written back: a snap that rewrote a STRIPPED document would ship an index.html without our badge and
// without the red demo banner the NO-FAKE-FEATURE rule requires. Blanking our markup in a READ-ONLY copy
// makes both impossible at once — the snap never sees our values, and never holds a text that lacks them.
//
// The patterns are not restated here: each comes from the module that writes that markup
// (`appSignatureRanges`, `honestyBannerRanges`, `previewBridgeRanges`). PURE.

import { appSignatureRanges } from './appSignature';
import { honestyBannerRanges } from '../../lib/honestyBanner';
import { previewBridgeRanges, isHtmlDocumentPath } from './previewBridge';

/** Every `[start, end)` range of NavBharatAI's own markup in a document. Only HTML documents carry any. PURE. */
export function ourMarkupRanges(path: string, content: string): Array<[number, number]> {
  if (typeof content !== 'string' || !content || !isHtmlDocumentPath(path)) return [];
  return [...appSignatureRanges(content), ...honestyBannerRanges(content), ...previewBridgeRanges(content)];
}

/**
 * The document with our badge, our honesty banner and our preview bridge replaced by spaces — same length,
 * same line breaks, so every other offset still points at the same character of the original. For READING
 * only; the original is what any writer keeps. A no-op for a non-HTML path or a document with none. PURE.
 */
export function blankOurMarkup(path: string, content: string): string {
  const ranges = ourMarkupRanges(path, content);
  if (ranges.length === 0) return content;
  const chars = content.split('');
  for (const [start, end] of ranges) {
    for (let i = Math.max(0, start); i < Math.min(chars.length, end); i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}

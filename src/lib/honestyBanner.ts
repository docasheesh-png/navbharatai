// The red "DEMO — not real" block NavBharatAI puts into a built app's index.html when a feature only
// pretends to work (server: src/server/AgentV3/fakeFeatureScan.ts). This file holds the ONE definition of
// the block's markers so every reader agrees: the server writes and strips it, the server-side in-browser
// renderer (runtime/ReactPreview.ts) carries it into its own shell, and the client renderer
// (lib/previewUtils.ts) keeps it because it reuses the app's <body>. Client-safe: no lookbehind (Q-322),
// no Node imports. PURE.

export const HONESTY_BANNER_OPEN = '<!-- nbai-honesty -->';
export const HONESTY_BANNER_CLOSE = '<!-- /nbai-honesty -->';

/** The whole block, markers included, however many times it appears. */
const BLOCK_RE = /\s*<!-- nbai-honesty -->[\s\S]*?<!-- \/nbai-honesty -->/g;

/** Does this document carry the block? */
export function hasHonestyBanner(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(HONESTY_BANNER_OPEN);
}

/** The document without the block (unchanged when there is none). */
export function stripHonestyBanner(html: string): string {
  return html.replace(BLOCK_RE, '');
}

/**
 * The block itself (markers included), to carry into another document — '' when there is none. A
 * renderer that builds its own <body> instead of reusing the app's would otherwise show a demo login
 * with no red line on it, which is the one screen the user looks at most.
 */
export function extractHonestyBanner(html: string | null | undefined): string {
  if (typeof html !== 'string') return '';
  const m = html.match(/<!-- nbai-honesty -->[\s\S]*?<!-- \/nbai-honesty -->/);
  return m ? m[0] : '';
}

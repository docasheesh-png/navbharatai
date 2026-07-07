// Ashok Chakra loading spinner (admin-requested, 2026-07-07: "indian flag ke fix flag me ghumta hua
// ashok chakra"). ONE source of truth for the SVG, shared by the client preview surface (React) and
// the server-generated in-browser preview HTML (ReactPreview.ts) so the two can never drift.
//
// Authentic geometry: 24 spokes at 15° intervals, navy blue (#06038D — the flag's chakra colour),
// an outer rim and a centre hub. The caller animates rotation (CSS keyframes / Tailwind animate-spin).

export const ASHOK_CHAKRA_NAVY = '#06038D';

/** The Ashok Chakra as a standalone SVG string. Pure — safe to inline in HTML or JSX. */
export function ashokChakraSvg(size = 64, color = ASHOK_CHAKRA_NAVY): string {
  const spokes: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i * 15 * Math.PI) / 180;
    const x2 = 50 + 42 * Math.cos(a);
    const y2 = 50 + 42 * Math.sin(a);
    spokes.push(`<line x1="50" y1="50" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Loading">`
    + `<circle cx="50" cy="50" r="46" fill="none" stroke="${color}" stroke-width="4.5"/>`
    + spokes.join('')
    + `<circle cx="50" cy="50" r="7" fill="${color}"/>`
    + `</svg>`
  );
}

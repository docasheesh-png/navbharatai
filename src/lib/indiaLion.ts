// THE INDIA LION — NavBharatAI's own waiting mark (admin 2026-08-21: "animation aye kuch accha sa,
// make in india wale loin wala ayega to bhi accha rahega").
//
// ⚠️ WHY THIS IS AN ORIGINAL DRAWING AND NOT THE MAKE IN INDIA LOGO. The Make in India lion is a
// Government of India mark, and its use is restricted — reproducing it inside a commercial product we
// charge money for is a legal problem, not a design choice. So this is our OWN lion: a radiating mane
// built the same programmatic way as the Ashok Chakra beside it, in the tiranga's saffron and green,
// with the chakra's navy for the face. Same feeling, none of the borrowed trademark.
//
// It is drawn in two PARTS on purpose. The mane turns and the face does not — a mark whose eyes rotate
// stops reading as a lion and starts reading as a wheel, and the whole point of the piece is that a
// user with no app yet sees something warm rather than a spinner implying work that is not happening.
//
// PURE strings, no React and no CSS, so the same mark can be inlined in a component, in server-rendered
// preview HTML, or in an email later, without three copies drifting apart (the safeRelPath lesson).

/** The flag's saffron. */
export const INDIA_SAFFRON = '#FF9933';
/** The flag's green. */
export const INDIA_GREEN = '#138808';
/** The flag's chakra navy — the face is drawn in it so the lion sits beside the Chakra as one family. */
export const INDIA_NAVY = '#06038D';

/**
 * The MANE — 18 tapered spikes around the centre, saffron at the top fading to green at the bottom.
 *
 * Separate from the face so the caller can rotate exactly this and nothing else.
 */
export function indiaLionManeSvg(size = 96): string {
  const spikes: string[] = [];
  const COUNT = 18;
  for (let i = 0; i < COUNT; i++) {
    const a = (i * (360 / COUNT) * Math.PI) / 180;
    const half = ((360 / COUNT) * 0.34 * Math.PI) / 180;
    const tip = { x: 50 + 46 * Math.cos(a), y: 50 + 46 * Math.sin(a) };
    const l = { x: 50 + 27 * Math.cos(a - half * 2), y: 50 + 27 * Math.sin(a - half * 2) };
    const r = { x: 50 + 27 * Math.cos(a + half * 2), y: 50 + 27 * Math.sin(a + half * 2) };
    // Blend saffron→green by vertical position, so the mark carries the flag's order top to bottom.
    const t = (Math.sin(a) + 1) / 2;
    spikes.push(
      `<path d="M${l.x.toFixed(2)} ${l.y.toFixed(2)} L${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L${r.x.toFixed(2)} ${r.y.toFixed(2)} Z" `
      + `fill="${t < 0.5 ? INDIA_SAFFRON : INDIA_GREEN}" opacity="${(0.55 + 0.45 * Math.abs(0.5 - t) * 2).toFixed(2)}"/>`,
    );
  }
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + spikes.join('')
    + `</svg>`
  );
}

/**
 * The FACE — a calm, front-facing lion: muzzle, nose, closed-arc eyes, ears.
 *
 * Deliberately simple. At the 96px this is shown at, detail turns to mud, and a friendly shape reads
 * better than an accurate one.
 */
export function indiaLionFaceSvg(size = 96, color = INDIA_NAVY): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NavBharatAI">`
    // Ears, behind the head.
    + `<circle cx="33" cy="31" r="7.5" fill="${color}"/><circle cx="67" cy="31" r="7.5" fill="${color}"/>`
    + `<circle cx="33" cy="31" r="3.4" fill="${INDIA_SAFFRON}"/><circle cx="67" cy="31" r="3.4" fill="${INDIA_SAFFRON}"/>`
    // Head.
    + `<circle cx="50" cy="50" r="25" fill="${color}"/>`
    // Muzzle.
    + `<ellipse cx="50" cy="59" rx="13" ry="9.5" fill="#FFFFFF" opacity="0.94"/>`
    + `<path d="M50 52 L45.5 56.5 h9 Z" fill="${color}"/>`
    + `<path d="M50 56.5 v4.5 M50 61 q-4 3.5 -7.5 1 M50 61 q4 3.5 7.5 1" stroke="${color}" stroke-width="1.7" fill="none" stroke-linecap="round"/>`
    // Eyes — gentle arcs rather than dots, so the mark looks calm instead of startled.
    + `<path d="M38 44.5 q4.5 -4 9 0" stroke="#FFFFFF" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    + `<path d="M53 44.5 q4.5 -4 9 0" stroke="#FFFFFF" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    + `</svg>`
  );
}

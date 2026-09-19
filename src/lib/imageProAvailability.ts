// Whether the PAID image tier is switched on — read from the server, BEFORE the user writes a prompt.
//
// 🔴 THE DEFECT THIS CLOSES (admin 2026-09-19: "image generate kam nahi kar raha hai"). The paid
// tier's availability lived in ONE place only: a 503 inside `POST /api/image/pro/generate`. So the
// Pro chip looked and behaved exactly like a working tier — a user selected it, composed a prompt,
// pressed send, and only then was told the tier had never been switched on. The server knew the
// answer before they typed a character. Publishing it is the whole fix; the second absolute rule
// asks for an honest "not available" state, and a state you reach only by spending effort is not one.
//
// ⚠️ AN UNREACHABLE CONFIG MEANS "AVAILABLE", AND THAT DIRECTION IS DELIBERATE. Failing the other
// way would hide a paid tier that works whenever a config fetch blipped — a worse outcome than
// today's, because the server's own 503 is still there as the honest backstop. So this can only ever
// ADD information; it never removes a working path. (Same discipline as `fetchPlatformFeePct`, which
// falls back to the number the server itself falls back to.)

/** `null` = not yet known. The caller keeps today's behaviour while it is null. */
export type ImageProAvailability = boolean | null;

/**
 * PURE: read the flag out of whatever `/api/public-config` returned.
 *
 * Only an explicit `false` counts as unavailable. A missing field — an older server that does not
 * publish it yet — reads as AVAILABLE, so deploying the client ahead of the server cannot switch a
 * working Pro tier off.
 */
export function imageProAvailableFrom(body: unknown): boolean {
  const v = (body as { imageProAvailable?: unknown } | null)?.imageProAvailable;
  return v === false ? false : true;
}

/** Ask the server. Never throws; any failure reads as available (see the note above). */
export async function fetchImageProAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    if (!res.ok) return true;
    return imageProAvailableFrom(await res.json());
  } catch {
    return true;
  }
}

/**
 * The one line shown where the toggle is, when Pro is known to be off.
 *
 * 🔒 WHITE-LABEL LAW: names no vendor, no model and no environment variable — a user is told what
 * they can do, never what we have failed to configure. It deliberately reads the same as the
 * server's own refusal, so the two halves cannot tell the user different stories.
 */
export const IMAGE_PRO_UNAVAILABLE_NOTE =
  'NavBharatAI Pro images are not switched on yet — Free generation is working.';

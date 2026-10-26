/**
 * The sentence every AI surface answers with while the admin has paused AI service (aiMaintenance.ts).
 * Its own tiny module so a build's diagnostics can recognise it without importing the Firestore-backed store.
 */
export const MAINTENANCE_MESSAGE = 'navbharatai now in Maintenance, please try after some time';

/**
 * User-facing copy when the AI pause flag could not be read (timeout/error).
 * Deliberately framed as temporary demand/load — never technical, never a permanent outage,
 * and never the deliberate-maintenance sentence (so users do not think the app is shut down).
 */
export const STATUS_UNAVAILABLE_MESSAGE =
  "We're experiencing high demand right now. Please try again in a few minutes.";

/** Does this error/summary text say the AI service was paused? PURE; never throws. */
export function isMaintenanceMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(MAINTENANCE_MESSAGE);
}

/** Does this error/summary text use the temporary high-demand line? PURE; never throws. */
export function isStatusUnavailableMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(STATUS_UNAVAILABLE_MESSAGE);
}

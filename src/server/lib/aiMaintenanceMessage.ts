/**
 * The sentence every AI surface answers with while the admin has paused AI service (aiMaintenance.ts).
 * Its own tiny module so a build's diagnostics can recognise it without importing the Firestore-backed store.
 */
export const MAINTENANCE_MESSAGE = 'navbharatai now in Maintenance, please try after some time';

/**
 * Distinct from MAINTENANCE_MESSAGE: the AI pause flag could not be read (timeout/error),
 * so we must not pretend the admin deliberately paused the site.
 */
export const STATUS_UNAVAILABLE_MESSAGE = 'AI status check temporarily unavailable, please retry';

/** Does this error/summary text say the AI service was paused? PURE; never throws. */
export function isMaintenanceMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(MAINTENANCE_MESSAGE);
}

/** Does this error/summary text say the pause flag itself could not be read? PURE; never throws. */
export function isStatusUnavailableMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(STATUS_UNAVAILABLE_MESSAGE);
}

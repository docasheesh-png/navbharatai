import { chatAvailabilityMessage } from './chatAvailabilityMessage';

/**
 * The sentence every AI surface answers with while the admin has paused AI service (aiMaintenance.ts).
 * Its own tiny module so a build's diagnostics can recognise it without importing the Firestore-backed store.
 */
export const MAINTENANCE_MESSAGE = 'navbharatai now in Maintenance, please try after some time';

/**
 * User-facing copy when the AI pause flag could not be read (timeout/error).
 * Neutral temporary unavailability — a failed flag read does not establish traffic/load,
 * and never the deliberate-maintenance sentence (so users do not think the app is shut down).
 */
export const STATUS_UNAVAILABLE_MESSAGE = chatAvailabilityMessage('temporary');

/** Does this error/summary text say the AI service was paused? PURE; never throws. */
export function isMaintenanceMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(MAINTENANCE_MESSAGE);
}

/** Does this error/summary text use the neutral temporary-unavailability line? PURE; never throws. */
export function isStatusUnavailableMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(STATUS_UNAVAILABLE_MESSAGE);
}

/**
 * The sentence every AI surface answers with while the admin has paused AI service (aiMaintenance.ts).
 * Its own tiny module so a build's diagnostics can recognise it without importing the Firestore-backed store.
 */
export const MAINTENANCE_MESSAGE = 'navbharatai now in Maintenance, please try after some time';

/** Does this error/summary text say the AI service was paused? PURE; never throws. */
export function isMaintenanceMessage(text: unknown): boolean {
  return typeof text === 'string' && text.includes(MAINTENANCE_MESSAGE);
}

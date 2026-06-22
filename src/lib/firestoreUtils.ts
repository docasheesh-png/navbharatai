/**
 * Recursively replaces `undefined` with `null` in a plain-object tree.
 * Firestore rejects `undefined` values — call this before any `setDoc` / `updateDoc`.
 */
export function sanitizeFirestoreData(data: any): any {
  const sanitized = { ...data };
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === undefined) {
      sanitized[key] = null;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeFirestoreData(sanitized[key]);
    }
  });
  return sanitized;
}

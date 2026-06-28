import firebaseConfig from '../../../firebase-applet-config.json';

/**
 * The Firestore database id every server-side store should target.
 *
 * WHY THIS IS ENV-OVERRIDABLE: the config's bundled database
 * (`ai-studio-…`) was created by Google AI Studio in a FREE tier that stays
 * hard-capped to the free daily write quota EVEN when the project is on the Blaze
 * plan ("This database cannot exceed free quota limits even when a billing
 * instrument is enabled"). That cap is why chat/files stopped persisting once the
 * daily writes ran out ("reload pe data gayab"). Setting FIRESTORE_DATABASE_ID in
 * the environment lets ops point every store at a proper full-quota database
 * (e.g. the project's `(default)` Native database, or a freshly created one) WITHOUT
 * a code change. Falls back to the bundled config, then `(default)`.
 */
export function firestoreDatabaseId(): string {
  const fromEnv = (process.env.FIRESTORE_DATABASE_ID || '').trim();
  if (fromEnv) return fromEnv;
  const fromConfig = ((firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId || '').trim();
  return fromConfig || '(default)';
}

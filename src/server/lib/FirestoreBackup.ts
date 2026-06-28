// P2.4 — Disaster Recovery: scheduled Firestore export (backup).
//
// Triggers a real Firestore managed export via the Firestore Admin REST API
// (`projects.databases.exportDocuments`) into a GCS bucket, authenticated with the
// runtime's Application Default Credentials (the Cloud Run service account). The export
// is a point-in-time backup that can be restored with `importDocuments` (see
// docs/DR_RUNBOOK.md). Honest behaviour when not configured: returns a clear
// "not configured" result — never fakes success, never throws.
//
// Backs up NavBharatAI's OWN operational Firestore (conversations, jobs, costs,
// provider-state, metrics…). It does NOT touch end-user app databases (those live on
// the users' own credentials).

import firebaseConfig from '../../../firebase-applet-config.json';
import { firestoreDatabaseId } from './firestoreDb';

export interface BackupResult {
  ok: boolean;
  configured: boolean;
  operation?: string;
  outputUriPrefix?: string;
  error?: string;
}

/** The GCS bucket to export into (set in the Cloud Run env). */
function backupBucket(): string {
  return (process.env.FIRESTORE_BACKUP_BUCKET || '').trim();
}

function projectId(): string {
  return (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || (firebaseConfig as any).projectId || '').trim();
}

function databaseId(): string {
  return firestoreDatabaseId();
}

/**
 * Pure (unit-tested): build the Firestore Admin `exportDocuments` REST request. The
 * `outputUriPrefix` is timestamped so successive backups never overwrite each other.
 */
export function buildExportRequest(
  project: string,
  database: string,
  bucket: string,
  timestamp: string,
): { url: string; body: { outputUriPrefix: string } } {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}:exportDocuments`;
  const outputUriPrefix = `gs://${bucket}/firestore-backups/${timestamp}`;
  return { url, body: { outputUriPrefix } };
}

export class FirestoreBackup {
  /** True only when a backup bucket + project are configured. */
  isConfigured(): boolean {
    return !!backupBucket() && !!projectId();
  }

  /**
   * Trigger a Firestore export. Returns an honest result object; never throws. The actual
   * Google API call only runs when configured AND credentials are available (prod).
   */
  async trigger(now: Date = new Date()): Promise<BackupResult> {
    const bucket = backupBucket();
    const project = projectId();
    if (!bucket || !project) {
      return { ok: false, configured: false, error: 'FIRESTORE_BACKUP_BUCKET (and a project id) must be set to enable backups.' };
    }
    const ts = now.toISOString().replace(/[:.]/g, '-');
    const { url, body } = buildExportRequest(project, databaseId(), bucket, ts);
    try {
      // Lazy-load to keep the module import-light and test-safe.
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform'] });
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token || token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => ({})) as any;
      if (!res.ok) {
        return { ok: false, configured: true, outputUriPrefix: body.outputUriPrefix, error: data?.error?.message || `Firestore export failed (HTTP ${res.status})` };
      }
      return { ok: true, configured: true, operation: data?.name, outputUriPrefix: body.outputUriPrefix };
    } catch (err) {
      return { ok: false, configured: true, outputUriPrefix: body.outputUriPrefix, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const firestoreBackup = new FirestoreBackup();

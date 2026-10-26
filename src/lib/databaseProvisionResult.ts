import { isRecord } from './serverAnswer';

export interface ConnectedDatabase {
  ok: true;
  projectRef: string;
  url: string;
  schemaApplied: boolean | null;
  reused?: boolean;
  reusedNote?: string;
  asleepNote?: string;
  schemaNote?: string;
}

export const DATABASE_PROVISION_RECOVERY =
  'Do not create another database. Check the existing project in your database account, then connect it in Settings → Database. Closing this screen does not cancel creation.';

export const DATABASE_PROVISION_UNCONFIRMED =
  `The database creation result could not be confirmed. ${DATABASE_PROVISION_RECOVERY}`;

export type DatabaseProvisionResult =
  | { kind: 'connected'; database: ConnectedDatabase }
  | { kind: 'pending' | 'unconfirmed' | 'failed'; message: string };

/** An accepted create is not a connected database. Shared by Publish and Settings. */
export function databaseProvisionResult(status: number, body: unknown): DatabaseProvisionResult {
  const error = isRecord(body) && typeof body.error === 'string' ? body.error.trim().slice(0, 300) : '';
  // The route deliberately returns 202 when the project exists but readiness or its keys are pending.
  // Retrying that POST can create a second project: never clear the data gate or suggest a retry.
  if (status === 202) return {
    kind: 'pending',
    message: `${error || 'Your database project exists, but it is not connected yet.'} ${DATABASE_PROVISION_RECOVERY}`,
  };
  if (status < 200 || status >= 300) {
    // A save failure includes the project id; a 5xx may have lost the creation acknowledgement.
    // Neither is evidence that it is safe to create a second project.
    if (status >= 500 || (isRecord(body) && typeof body.projectRef === 'string' && body.projectRef.trim())) {
      return { kind: 'unconfirmed', message: error ? `${error} ${DATABASE_PROVISION_RECOVERY}` : DATABASE_PROVISION_UNCONFIRMED };
    }
    return { kind: 'failed', message: error || `The database request was refused (HTTP ${status}).` };
  }
  if (!isRecord(body) || body.ok !== true
    || typeof body.projectRef !== 'string' || !body.projectRef.trim()
    || typeof body.url !== 'string' || !body.url.trim()
    || !(typeof body.schemaApplied === 'boolean' || body.schemaApplied === null)
    || ['reusedNote', 'asleepNote', 'schemaNote'].some((key) => body[key] !== undefined && typeof body[key] !== 'string')
    || (body.reused !== undefined && typeof body.reused !== 'boolean')) {
    return { kind: 'unconfirmed', message: DATABASE_PROVISION_UNCONFIRMED };
  }
  return { kind: 'connected', database: body as unknown as ConnectedDatabase };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildExportRequest, FirestoreBackup } from './FirestoreBackup';

describe('FirestoreBackup (P2.4 DR backup)', () => {
  describe('buildExportRequest (pure)', () => {
    it('targets the Firestore Admin exportDocuments endpoint for the project + database', () => {
      const { url } = buildExportRequest('proj-1', 'db-1', 'my-bucket', '2026-06-28T00-00-00-000Z');
      expect(url).toBe('https://firestore.googleapis.com/v1/projects/proj-1/databases/db-1:exportDocuments');
    });

    it('timestamps the GCS output prefix so backups never overwrite', () => {
      const { body } = buildExportRequest('p', 'd', 'bkt', '2026-06-28T01-02-03-000Z');
      expect(body.outputUriPrefix).toBe('gs://bkt/firestore-backups/2026-06-28T01-02-03-000Z');
    });

    it('url-encodes the (default) database id', () => {
      const { url } = buildExportRequest('p', '(default)', 'bkt', 'ts');
      expect(url).toContain('databases/(default)'.replace('(default)', encodeURIComponent('(default)')));
    });
  });

  describe('isConfigured + trigger honesty', () => {
    const saved = { ...process.env };
    beforeEach(() => { delete process.env.FIRESTORE_BACKUP_BUCKET; });
    afterEach(() => { process.env = { ...saved }; });

    it('isConfigured() is false without a bucket', () => {
      expect(new FirestoreBackup().isConfigured()).toBe(false);
    });

    it('trigger() returns an honest "not configured" result (never fakes success, never throws)', async () => {
      const result = await new FirestoreBackup().trigger();
      expect(result.ok).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.error).toMatch(/FIRESTORE_BACKUP_BUCKET/);
    });

    it('isConfigured() is true once a bucket is set (project comes from firebase config)', () => {
      process.env.FIRESTORE_BACKUP_BUCKET = 'navbharat-dr';
      expect(new FirestoreBackup().isConfigured()).toBe(true);
    });
  });
});

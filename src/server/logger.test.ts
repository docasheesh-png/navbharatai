import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldLog, resolveLogLevel, buildLogRecord, log, withLogContext } from './logger';

describe('logger (P-BRE.3 structured logging)', () => {
  describe('shouldLog — level filtering', () => {
    it('emits when level >= configured min', () => {
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
      expect(shouldLog('warn', 'debug')).toBe(true);
    });
    it('suppresses when level < configured min', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('info', 'warn')).toBe(false);
      expect(shouldLog('warn', 'error')).toBe(false);
    });
  });

  describe('resolveLogLevel', () => {
    it('honours an explicit LOG_LEVEL', () => {
      expect(resolveLogLevel({ LOG_LEVEL: 'warn' } as any)).toBe('warn');
      expect(resolveLogLevel({ LOG_LEVEL: 'DEBUG' } as any)).toBe('debug');
    });
    it('defaults to info in production, debug otherwise', () => {
      expect(resolveLogLevel({ NODE_ENV: 'production' } as any)).toBe('info');
      expect(resolveLogLevel({} as any)).toBe('debug');
    });
    it('ignores a bogus LOG_LEVEL and falls back', () => {
      expect(resolveLogLevel({ LOG_LEVEL: 'loud', NODE_ENV: 'production' } as any)).toBe('info');
    });
  });

  describe('buildLogRecord — Cloud Logging shape', () => {
    it('builds severity + message + timestamp + merged context/meta', () => {
      const r = buildLogRecord('warn', 'hi', { jobId: 'j1' }, { extra: 1 }, undefined, '2026-06-28T00:00:00.000Z');
      expect(r).toEqual({ severity: 'WARNING', message: 'hi', timestamp: '2026-06-28T00:00:00.000Z', jobId: 'j1', extra: 1 });
    });
    it('includes traceId when present', () => {
      const r = buildLogRecord('error', 'boom', {}, undefined, 'abc123', '2026-06-28T00:00:00.000Z');
      expect(r.severity).toBe('ERROR');
      expect(r.traceId).toBe('abc123');
    });
    it('maps each level to the right Cloud Logging severity', () => {
      const sev = (lvl: any) => buildLogRecord(lvl, 'm', {}, undefined, undefined, 't').severity;
      expect(sev('debug')).toBe('DEBUG');
      expect(sev('info')).toBe('INFO');
      expect(sev('warn')).toBe('WARNING');
      expect(sev('error')).toBe('ERROR');
    });
  });

  describe('Logger.withContext — correlation propagation', () => {
    afterEach(() => vi.restoreAllMocks());

    it('makes context fields available to logs emitted inside the scope', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      withLogContext({ jobId: 'job-42', userId: 'u1' }, () => {
        log.error('inside');
      });
      expect(spy).toHaveBeenCalledOnce();
      const record = JSON.parse(spy.mock.calls[0][0] as string);
      expect(record.jobId).toBe('job-42');
      expect(record.userId).toBe('u1');
      expect(record.message).toBe('inside');
      expect(record.severity).toBe('ERROR');
    });

    it('nested contexts merge (inner overrides/extends outer)', () => {
      let ctx: any;
      withLogContext({ jobId: 'j1' }, () => {
        withLogContext({ phase: 'build' }, () => {
          ctx = log.context();
        });
      });
      expect(ctx).toEqual({ jobId: 'j1', phase: 'build' });
    });

    it('context does not leak outside the scope', () => {
      withLogContext({ jobId: 'j9' }, () => {});
      expect(log.context()).toEqual({});
    });

    it('never throws from a log call', () => {
      expect(() => log.info('ok', { a: 1 })).not.toThrow();
    });
  });
});

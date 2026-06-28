import { describe, it, expect, vi } from 'vitest';
import {
  CURRENT_API_VERSION,
  SUPPORTED_API_VERSIONS,
  rewriteVersionedPath,
  successorVersionPath,
  apiVersionMiddleware,
} from './apiVersion';

describe('API versioning (P1.1)', () => {
  describe('rewriteVersionedPath — versioned → internal handler', () => {
    it('rewrites /api/v1/foo → /api/foo', () => {
      expect(rewriteVersionedPath('/api/v1/foo')).toBe('/api/foo');
    });
    it('rewrites a deep path /api/v1/agentv3/chat → /api/agentv3/chat', () => {
      expect(rewriteVersionedPath('/api/v1/agentv3/chat')).toBe('/api/agentv3/chat');
    });
    it('preserves the query string', () => {
      expect(rewriteVersionedPath('/api/v1/conversations?userId=u1&x=2')).toBe('/api/conversations?userId=u1&x=2');
    });
    it('rewrites the bare /api/v1 → /api', () => {
      expect(rewriteVersionedPath('/api/v1')).toBe('/api');
    });
    it('rewrites bare /api/v1?x=1 → /api?x=1', () => {
      expect(rewriteVersionedPath('/api/v1?x=1')).toBe('/api?x=1');
    });
    it('does NOT rewrite an unversioned /api/foo', () => {
      expect(rewriteVersionedPath('/api/foo')).toBeNull();
    });
    it('does NOT rewrite a lookalike /api/v10/foo (only exact v1 segment)', () => {
      expect(rewriteVersionedPath('/api/v10/foo')).toBeNull();
    });
    it('does NOT rewrite a non-API path', () => {
      expect(rewriteVersionedPath('/preview/abc')).toBeNull();
      expect(rewriteVersionedPath('/')).toBeNull();
    });
  });

  describe('successorVersionPath — unversioned → canonical versioned', () => {
    it('maps /api/foo → /api/v1/foo', () => {
      expect(successorVersionPath('/api/foo')).toBe('/api/v1/foo');
    });
    it('maps a deep path', () => {
      expect(successorVersionPath('/api/agentv3/chat')).toBe('/api/v1/agentv3/chat');
    });
    it('round-trips with rewriteVersionedPath for a typical path', () => {
      const versioned = successorVersionPath('/api/health'); // /api/v1/health
      expect(rewriteVersionedPath(versioned)).toBe('/api/health');
    });
  });

  describe('version constants', () => {
    it('current version is v1 and is the only supported version', () => {
      expect(CURRENT_API_VERSION).toBe('v1');
      expect(SUPPORTED_API_VERSIONS).toEqual(['v1']);
    });
  });

  describe('apiVersionMiddleware', () => {
    function mk(url: string) {
      // Express derives req.path from req.url (no query). Mirror that for the test.
      const path = url.split('?')[0];
      const headers: Record<string, string> = {};
      const req: any = { url, path };
      const res: any = { setHeader: (k: string, v: string) => { headers[k] = v; } };
      const next = vi.fn();
      return { req, res, next, headers };
    }

    it('rewrites a versioned request and stamps X-API-Version: v1', () => {
      const { req, res, next, headers } = mk('/api/v1/health');
      apiVersionMiddleware(req, res, next);
      expect(req.url).toBe('/api/health');
      expect(headers['X-API-Version']).toBe('v1');
      expect(next).toHaveBeenCalledOnce();
    });

    it('leaves a versioned request with NO deprecation header', () => {
      const { req, res, next, headers } = mk('/api/v1/health');
      apiVersionMiddleware(req, res, next);
      expect(headers['Deprecation']).toBeUndefined();
    });

    it('flags an unversioned API request as deprecated with a successor Link', () => {
      const { req, res, next, headers } = mk('/api/health');
      apiVersionMiddleware(req, res, next);
      expect(req.url).toBe('/api/health'); // unchanged — still served
      expect(headers['X-API-Version']).toBe('unversioned');
      expect(headers['Deprecation']).toBe('true');
      expect(headers['Link']).toBe('</api/v1/health>; rel="successor-version"');
      expect(next).toHaveBeenCalledOnce();
    });

    it('ignores non-API paths entirely (no headers, no rewrite)', () => {
      const { req, res, next, headers } = mk('/preview/abc');
      apiVersionMiddleware(req, res, next);
      expect(req.url).toBe('/preview/abc');
      expect(Object.keys(headers)).toHaveLength(0);
      expect(next).toHaveBeenCalledOnce();
    });

    it('always calls next() (never terminates the chain)', () => {
      for (const url of ['/api/v1/x', '/api/x', '/static/y', '/']) {
        const { req, res, next } = mk(url);
        apiVersionMiddleware(req, res, next);
        expect(next).toHaveBeenCalledOnce();
      }
    });
  });
});

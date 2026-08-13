import { describe, it, expect } from 'vitest';
import {
  neonConfigured, neonRegionId, buildCreateProjectRequest, buildDeleteProjectRequest,
  parseCreateProjectResponse, provisionNeonDatabase, deleteNeonDatabase,
} from './neonProvision';

const fakeFetch = (status: number, json: any): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => json })) as unknown as typeof fetch;

describe('neonProvision', () => {
  it('reports configured only when NEON_API_KEY is present', () => {
    expect(neonConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(neonConfigured({ NEON_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBe(false);
    expect(neonConfigured({ NEON_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('defaults the region to Singapore and honours the env override', () => {
    expect(neonRegionId({} as NodeJS.ProcessEnv)).toBe('aws-ap-southeast-1');
    expect(neonRegionId({ MANAGED_BACKEND_NEON_REGION: 'aws-us-east-2' } as NodeJS.ProcessEnv)).toBe('aws-us-east-2');
  });

  it('builds the exact create-project request', () => {
    const req = buildCreateProjectRequest('key1', 'nb-abc-app', 'aws-ap-southeast-1');
    expect(req.url).toBe('https://console.neon.tech/api/v2/projects');
    expect(req.method).toBe('POST');
    expect(req.headers.Authorization).toBe('Bearer key1');
    expect(JSON.parse(req.body!)).toEqual({ project: { name: 'nb-abc-app', region_id: 'aws-ap-southeast-1' } });
  });

  it('builds the delete request with an encoded project id', () => {
    const req = buildDeleteProjectRequest('k', 'proj/1');
    expect(req.url).toBe('https://console.neon.tech/api/v2/projects/proj%2F1');
    expect(req.method).toBe('DELETE');
  });

  it('parses the create response only when both id and postgres URI are present', () => {
    expect(parseCreateProjectResponse({
      project: { id: 'p1' },
      connection_uris: [{ connection_uri: 'postgresql://u:p@h/db' }],
    })).toEqual({ projectId: 'p1', connectionUri: 'postgresql://u:p@h/db' });
    expect(parseCreateProjectResponse({ project: { id: 'p1' }, connection_uris: [] })).toBeNull();
    expect(parseCreateProjectResponse({ connection_uris: [{ connection_uri: 'postgresql://x' }] })).toBeNull();
    expect(parseCreateProjectResponse({ project: { id: 'p1' }, connection_uris: [{ connection_uri: 'http://not-pg' }] })).toBeNull();
  });

  it('is honest without a key: not-configured with the exact next action', async () => {
    const r = await provisionNeonDatabase({ projectName: 'x', env: {} as NodeJS.ProcessEnv });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-configured');
      expect(r.message).toContain('NEON_API_KEY');
    }
  });

  it('surfaces the Neon error message on API failure and succeeds on a good response', async () => {
    const env = { NEON_API_KEY: 'k' } as NodeJS.ProcessEnv;
    const bad = await provisionNeonDatabase({ projectName: 'x', env }, fakeFetch(422, { message: 'projects limit exceeded' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('projects limit exceeded');

    const good = await provisionNeonDatabase({ projectName: 'x', env }, fakeFetch(201, {
      project: { id: 'p9' }, connection_uris: [{ connection_uri: 'postgresql://ok' }],
    }));
    expect(good).toEqual({ ok: true, projectId: 'p9', connectionUri: 'postgresql://ok' });
  });

  it('treats delete 404 as already-deleted success', async () => {
    const env = { NEON_API_KEY: 'k' } as NodeJS.ProcessEnv;
    expect(await deleteNeonDatabase('p1', env, fakeFetch(404, {}))).toEqual({ ok: true });
    const fail = await deleteNeonDatabase('p1', env, fakeFetch(500, {}));
    expect(fail.ok).toBe(false);
  });
});

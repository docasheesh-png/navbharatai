import { describe, it, expect, vi } from 'vitest';
import {
  renderConfigured, renderRequirement, buildListServicesRequest, buildTriggerDeployRequest,
  parseRenderService, matchRenderService, deployBackendToRender, type RenderService,
} from './renderDeploy';

describe('renderDeploy — real Render backend deploy (slice 4, honest, no fake)', () => {
  it('renderConfigured reflects RENDER_API_KEY presence', () => {
    expect(renderConfigured({ RENDER_API_KEY: 'rnd_abc' } as any)).toBe(true);
    expect(renderConfigured({ RENDER_API_KEY: '  ' } as any)).toBe(false);
    expect(renderConfigured({} as any)).toBe(false);
  });

  it('renderRequirement is honest about the missing key', () => {
    expect(renderRequirement({} as any)).toContain('Set RENDER_API_KEY');
    expect(renderRequirement({ RENDER_API_KEY: 'rnd_x' } as any).toLowerCase()).toContain('configured');
  });

  it('buildListServicesRequest hits the real Render endpoint with bearer auth (clamped limit)', () => {
    const r = buildListServicesRequest('rnd_secret', 500);
    expect(r.url).toBe('https://api.render.com/v1/services?limit=100'); // clamped to 100
    expect(r.method).toBe('GET');
    expect(r.headers.Authorization).toBe('Bearer rnd_secret');
    expect(r.headers.Accept).toBe('application/json');
  });

  it('buildTriggerDeployRequest posts to the service deploys endpoint', () => {
    const r = buildTriggerDeployRequest('rnd_secret', 'srv-123');
    expect(r.url).toBe('https://api.render.com/v1/services/srv-123/deploys');
    expect(r.method).toBe('POST');
    expect(JSON.parse(r.body!)).toEqual({ clearCache: 'do_not_clear' });
  });

  it('parseRenderService normalises both {service:{}} and bare shapes; rejects junk', () => {
    expect(parseRenderService({ service: { id: 'srv-1', name: 'api', repo: 'https://github.com/u/r', serviceDetails: { url: 'https://api.onrender.com' } } }))
      .toEqual({ id: 'srv-1', name: 'api', type: undefined, repo: 'https://github.com/u/r', dashboardUrl: undefined, serviceUrl: 'https://api.onrender.com' });
    expect(parseRenderService({ id: 'srv-2' })?.name).toBe('srv-2');
    expect(parseRenderService(null)).toBeNull();
    expect(parseRenderService({ name: 'no-id' })).toBeNull();
  });

  it('matchRenderService matches by repo first, then name', () => {
    const svcs: RenderService[] = [
      { id: 's1', name: 'other', repo: 'https://github.com/u/other' },
      { id: 's2', name: 'my-api', repo: 'https://github.com/u/my-api.git' },
    ];
    expect(matchRenderService(svcs, { repoUrl: 'https://github.com/u/my-api' })?.id).toBe('s2'); // .git tolerated
    expect(matchRenderService(svcs, { appName: 'my-api' })?.id).toBe('s2');
    expect(matchRenderService(svcs, { repoUrl: 'https://github.com/u/nope' })).toBeNull();
  });

  it('deployBackendToRender: no key → honest not-configured, never a fake deploy', async () => {
    const r = await deployBackendToRender({ apiKey: '', repoUrl: 'https://github.com/u/r' }, vi.fn());
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('not-configured'); expect(r.message).toContain('RENDER_API_KEY'); }
  });

  it('deployBackendToRender: key present but repo not connected → honest no-service (one-time Blueprint step)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const r = await deployBackendToRender({ apiKey: 'rnd_x', repoUrl: 'https://github.com/u/r', appName: 'r' }, fetchMock as any);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('no-service'); expect(r.message).toContain('Blueprint'); }
  });

  it('deployBackendToRender: match found → triggers a REAL deploy and returns the live URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ service: { id: 'srv-9', name: 'my-api', repo: 'https://github.com/u/my-api', serviceDetails: { url: 'https://my-api.onrender.com' } } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'dep-1' }) });
    const r = await deployBackendToRender({ apiKey: 'rnd_x', repoUrl: 'https://github.com/u/my-api' }, fetchMock as any);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.url).toBe('https://my-api.onrender.com'); expect(r.serviceId).toBe('srv-9'); }
    // second call was the deploy trigger (POST)
    expect(fetchMock.mock.calls[1][0]).toContain('/services/srv-9/deploys');
  });

  it('deployBackendToRender: a Render API error surfaces honestly (no fake success)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const r = await deployBackendToRender({ apiKey: 'rnd_bad', repoUrl: 'https://github.com/u/r' }, fetchMock as any);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('api-error'); expect(r.message).toContain('401'); }
  });
});

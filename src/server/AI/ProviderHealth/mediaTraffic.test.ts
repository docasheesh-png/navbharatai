import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogueSteps, keepListed } from './mediaCatalogue';
import { imageEngineProvider, mediaTrafficEnabled, orderMediaProviders } from './mediaTraffic';
import { visionProviderOrder } from '../../lib/visionChain';
import { noteProviderCall, resetTrafficHealthForTests } from './trafficHealth';

afterEach(() => resetTrafficHealthForTests());

describe('image and vision health order', () => {
  it('is on unless the kill switch says off', () => {
    expect(mediaTrafficEnabled()).toBe(true);
    expect(mediaTrafficEnabled({ AGENTV3_MEDIA_TRAFFIC: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('moves a suspended vision provider behind a healthy one', () => {
    noteProviderCall({ provider: 'GLM', surface: 'vision', ok: false, error: new Error('account is suspended due to insufficient balance'), at: 1_000 });
    expect(orderMediaProviders(['GLM', 'VERTEX'] as const, (id) => id, 1_000)).toEqual(['VERTEX', 'GLM']);
  });

  it('does not let a faster dearer image engine pass a cheaper one', () => {
    noteProviderCall({ provider: 'GROK', surface: 'image', ok: true, totalMs: 40, at: 1 });
    noteProviderCall({ provider: 'GEMINI', surface: 'image', ok: true, totalMs: 900, at: 2 });
    noteProviderCall({ provider: 'POLLINATIONS', surface: 'image', ok: true, totalMs: 20, at: 3 });
    const steps = catalogueSteps('generator');
    expect(orderMediaProviders(steps, imageEngineProvider, 4)).toEqual([...steps]);
  });

  it('parks a suspended cheap image engine after the ones that can still answer', () => {
    noteProviderCall({ provider: 'CLOUDFLARE', surface: 'image', ok: false, error: new Error('account is suspended due to insufficient balance'), at: 1_000 });
    const steps = catalogueSteps('app');
    expect(orderMediaProviders(steps, imageEngineProvider, 1_000)).toEqual(['pollinations', 'grok', 'cloudflare']);
  });

  it('removing one catalogue row drops that rung and leaves the rest in order', () => {
    expect(catalogueSteps('generator', ['pollinations'])).toEqual(['cloudflare', 'pro-host', 'gemini', 'grok']);
    expect(catalogueSteps('app', ['cloudflare'])).toEqual(['pollinations', 'grok']);
    expect(keepListed(['GLM', 'NOT_A_PROVIDER', 'VERTEX'] as const, 'vision')).toEqual(['GLM', 'VERTEX']);
  });

  it('lists every vision provider the chain can already call, so none disappear by accident', () => {
    const ids = visionProviderOrder(true, 'paid', true);
    expect(keepListed(ids, 'vision')).toEqual(ids);
  });

  it('vision and both image ladders consult this order, and the admin drain check stays', () => {
    const vision = readFileSync('src/server/lib/visionChain.ts', 'utf8');
    const image = readFileSync('src/server/lib/navbharatImageEngine.ts', 'utf8');
    const route = readFileSync('src/server/routes/imageGen.ts', 'utf8');
    expect(vision).toContain('orderMediaProviders');
    expect(vision).toContain("legacyPathAllows('vision'");
    expect(image).toContain('orderMediaProviders');
    expect(image).toContain("legacyPathAllows('image'");
    expect(route).toContain('orderMediaProviders');
    expect(route).toContain("catalogueSteps('generator')");
    expect(route).toContain("legacyPathAllows('image'");
    expect(image).toContain("catalogueSteps('app')");
    expect(vision).toContain("keepListed(");
    expect(route).toContain("surface: 'image'");
  });
});

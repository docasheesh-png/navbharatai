// Admin 2026-10-04: "preview me AI chalao, ₹2/din … user apni api keys jab chahe use kar sakta hai … red dot,
// navigator se notice … keys and secrets se navbharatai ki api delete kar de … navbharatai api browser me na
// jaye". Each requirement has a lock here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPreviewAiAsk, previewAiShimSource, PREVIEW_AI_ASK } from '../src/lib/previewAiProtocol';
import { withPreviewAiRelay, previewBridgeSource, PREVIEW_AI_RELAY_MARKER } from '../src/server/AgentV3/previewBridge';
import { ownKeyFromSecrets, askWithOwnKey } from '../src/server/lib/appAiOwnKey';
import { previewDailyCapInr, previewRefusalMessage } from '../src/server/routes/appAiOwner';
import { pendingActions, badgeAt } from '../src/lib/actionNavigator';
import { setAppAiDisabled, getAppAiSettings, __resetAppAiSettings } from '../src/server/lib/AppAiSettingsStore';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the in-page relay holds no credential and never overrides a real stamp', () => {
  it('is valid JavaScript (parsed by node itself)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-shim-'));
    const f = join(dir, 'shim.js');
    writeFileSync(f, previewAiShimSource());
    expect(() => execFileSync(process.execPath, ['--check', f])).not.toThrow();
  });
  it('contains no token, key or our server address — it only talks to its parent', () => {
    const src = previewAiShimSource();
    expect(src).not.toMatch(/token|apiKey|Authorization|\/api\/|https?:\/\//i);
    expect(src).toMatch(/if \(window\.NavAI\) return;/);
    expect(src).toMatch(/e\.source !== window\.parent && e\.source !== window\.top/);
  });
  it('rides inside the preview bridge, and the bridge is still stripped from published code by its marker', () => {
    expect(previewBridgeSource('live')).toContain(PREVIEW_AI_ASK);
  });
  it('reads only a well-formed ask', () => {
    expect(readPreviewAiAsk({ [PREVIEW_AI_ASK]: true, id: 'a1', prompt: 'hi' })).toEqual({ id: 'a1', prompt: 'hi', system: '' });
    expect(readPreviewAiAsk({ [PREVIEW_AI_ASK]: true, prompt: 'hi' })).toBeNull();
    expect(readPreviewAiAsk({ __other: true })).toBeNull();
    expect(readPreviewAiAsk({ [PREVIEW_AI_ASK]: true, id: 'a', prompt: 'x'.repeat(9000) })!.prompt.length).toBe(4000);
  });
});

describe('the saved preview copy gets the relay only when the app uses the assistant', () => {
  const html = Buffer.from('<html><head><title>t</title></head><body></body></html>');
  it('injected for an app whose bundle uses NavAI', () => {
    const out = withPreviewAiRelay(new Map([['index.html', html], ['assets/a.js', Buffer.from('globalThis.NavAI')]]));
    expect(out.get('index.html')!.toString()).toContain(PREVIEW_AI_RELAY_MARKER);
  });
  it('untouched for an app without one', () => {
    const dist = new Map([['index.html', html], ['assets/a.js', Buffer.from('console.log(1)')]]);
    expect(withPreviewAiRelay(dist)).toBe(dist);
  });
});

describe("the owner's own key — server-side only", () => {
  it('OpenAI first, Anthropic second, nothing for a junk value', () => {
    expect(ownKeyFromSecrets({ OPENAI_API_KEY: 'sk-' + 'a'.repeat(30), ANTHROPIC_API_KEY: 'sk-ant-' + 'b'.repeat(30) })?.provider).toBe('openai');
    expect(ownKeyFromSecrets({ ANTHROPIC_API_KEY: 'sk-ant-' + 'b'.repeat(30) })).toMatchObject({ provider: 'anthropic', model: 'claude-3-5-haiku-latest' });
    expect(ownKeyFromSecrets({ OPENAI_API_KEY: 'x' })).toBeNull();
    expect(ownKeyFromSecrets(null)).toBeNull();
  });
  it('answers with OpenAI and Anthropic, and calls a refusal a refusal', async () => {
    const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    expect(await askWithOwnKey({ provider: 'openai', key: 'k', model: 'm' }, 's', 'p', ok({ choices: [{ message: { content: 'hello' } }] }) as unknown as typeof fetch)).toEqual({ ok: true, text: 'hello' });
    expect(await askWithOwnKey({ provider: 'anthropic', key: 'k', model: 'm' }, 's', 'p', ok({ content: [{ type: 'text', text: 'hi' }] }) as unknown as typeof fetch)).toEqual({ ok: true, text: 'hi' });
    const refused = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    expect(await askWithOwnKey({ provider: 'openai', key: 'k', model: 'm' }, 's', 'p', refused)).toEqual({ ok: false, reason: 'refused' });
  });
  it('the settings view returns the provider NAME, never the key', () => {
    const src = read('src/server/routes/appAiOwner.ts');
    expect(src).toMatch(/ownKey: own\?\.provider \?\? null/);
    expect(src).not.toMatch(/own\.key|own\?\.key/);
  });
});

describe('the shared answer path', () => {
  beforeEach(() => { vi.resetModules(); __resetAppAiSettings(); });

  it("the owner's key wins, costs our wallet nothing, and a refused key is never replaced by our engine", async () => {
    const model = vi.fn();
    vi.doMock('../src/server/lib/professionalRouting', () => ({ callProfessionalAIWithUsage: model }));
    vi.doMock('../src/server/lib/appAiOwnKey', () => ({
      ownKeyFor: async () => ({ provider: 'openai', key: 'k', model: 'm' }),
      askWithOwnKey: async () => ({ ok: false, reason: 'refused' }),
    }));
    const { answerForApp } = await import('../src/server/lib/appAiAnswer');
    const r = await answerForApp({ ownerId: 'u', workspaceId: 'w', system: 's', prompt: 'p', counter: { appId: 'a', visitor: '', day: 'd', appCapInr: 2, visitorCapInr: 0 } });
    expect(r).toMatchObject({ ok: false, reason: 'own-key-refused', provider: 'openai' });
    expect(model).not.toHaveBeenCalled();
    vi.doUnmock('../src/server/lib/professionalRouting');
    vi.doUnmock('../src/server/lib/appAiOwnKey');
  });

  it('switched off ⇒ refused before any model runs', async () => {
    const model = vi.fn();
    vi.doMock('../src/server/lib/professionalRouting', () => ({ callProfessionalAIWithUsage: model }));
    vi.doMock('../src/server/lib/appAiOwnKey', () => ({ ownKeyFor: async () => null, askWithOwnKey: vi.fn() }));
    const store = await import('../src/server/lib/AppAiSettingsStore');
    await store.setAppAiDisabled('w-off', true);
    const { answerForApp } = await import('../src/server/lib/appAiAnswer');
    const r = await answerForApp({ ownerId: 'u', workspaceId: 'w-off', system: 's', prompt: 'p', counter: { appId: 'a', visitor: '', day: 'd', appCapInr: 2, visitorCapInr: 0 } });
    expect(r).toEqual({ ok: false, reason: 'switched-off' });
    expect(model).not.toHaveBeenCalled();
    vi.doUnmock('../src/server/lib/professionalRouting');
    vi.doUnmock('../src/server/lib/appAiOwnKey');
  });

  it('the preview cap is ₹2 by default and never "no limit"', () => {
    expect(previewDailyCapInr({} as NodeJS.ProcessEnv)).toBe(2);
    expect(previewDailyCapInr({ APP_AI_PREVIEW_CAP_INR: '5' } as NodeJS.ProcessEnv)).toBe(5);
    expect(previewDailyCapInr({ APP_AI_PREVIEW_CAP_INR: 'lots' } as NodeJS.ProcessEnv)).toBe(2);
  });

  it('the owner is told the true reason, in plain words', () => {
    expect(previewRefusalMessage('switched-off')).toMatch(/switched off for this app/);
    expect(previewRefusalMessage('app-cap')).toMatch(/preview AI limit/);
    expect(previewRefusalMessage('own-key-refused', 'anthropic')).toMatch(/Anthropic key was refused/);
  });
});

describe('the switch and the notice', () => {
  it('the switch is real and per app', async () => {
    __resetAppAiSettings();
    expect((await getAppAiSettings('w1')).disabled).toBe(false);
    await setAppAiDisabled('w1', true);
    expect((await getAppAiSettings('w1')).disabled).toBe(true);
    expect((await getAppAiSettings('w2')).disabled).toBe(false);
  });
  it('a red dot on More → Keys & Secrets until the owner has seen it', () => {
    expect(badgeAt(pendingActions({ appAiNoticeUnseen: true }), ['more', 'secrets'])).toBe('attention');
    expect(badgeAt(pendingActions({ appAiNoticeUnseen: true }), ['more'])).toBe('attention');
    expect(badgeAt(pendingActions({ appAiNoticeUnseen: false }), ['more', 'secrets'])).toBeFalsy();
  });
});

describe('wiring', () => {
  const owner = read('src/server/routes/appAiOwner.ts');
  it('every owner route is a STRICT owner check (verified uid owns the workspace)', () => {
    // 4 since 2026-10-04: the preview's picture route is an owner route too.
    expect(owner.match(/await ownerOf\(req, workspaceId\)/g)).toHaveLength(4);
    expect(owner).toMatch(/ownedByVerifiedUid\(uid, workspaceId\)/);
  });
  it('the preview counter is separate from the published app and uses the preview cap', () => {
    expect(owner).toMatch(/appId: previewCounterId\(workspaceId\), visitor: '', day: dayKey\(Date\.now\(\)\), appCapInr: previewDailyCapInr\(\), visitorCapInr: 0/);
  });
  it('the published gateway honours the switch and the own key through the same path', () => {
    expect(read('src/server/routes/appAi.ts')).toMatch(/await answerForApp\(\{/);
  });
  it('the preview answers only our own two frames', () => {
    const ps = read('src/components/agentv3/PreviewSurface.tsx');
    expect(ps).toMatch(/const frames = \[liveIframeRef\.current\?\.contentWindow, inBrowserIframeRef\.current\?\.contentWindow\];/);
    expect(ps).toMatch(/if \(!e\.source \|\| !frames\.includes\(e\.source as Window\)\) return;/);
  });
  it('Keys & Secrets shows the card and carries the dot; the server registers the routes', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toMatch(/<AppAiSettingsCard workspaceId=\{state\.workspaceId\} onSeen=\{markAiNoticeSeen\} \/>/);
    expect(panel).toMatch(/<ActionDot tone=\{badgeAt\(navActions, \['more', 'secrets'\]\)\}/);
    expect(read('server.ts')).toContain('registerAppAiOwnerRoutes(app)');
  });
});

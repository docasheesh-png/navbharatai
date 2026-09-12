import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateAiIntegration, resolveAiProvider, isAiProvider } from './AiGenerator';
import { defaultToolCatalog } from '../AgentV3/ToolCatalog';

/**
 * THE AI GATEWAY — the wiring the pure core cannot see (ROADMAP §13, 3.1).
 *
 * `appAiGateway.test.ts` pins the decisions. This pins the ORDER and the PLACES they are made in, and
 * every assertion here is one that would have been a real defect: a model call before the caps are
 * checked, a token stamped into a page whose registry row never landed, a charge taken before the
 * visitor has their answer.
 *
 * Structural tests read source, so they are only worth anything if they bind to something ONLY the
 * target does. Comment lines are stripped first — a test that passes because the file EXPLAINS the
 * behaviour, rather than because it HAS it, is worse than no test.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** Source with comment lines removed, so an assertion cannot be satisfied by prose. */
function codeOf(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('the gateway route', () => {
  const file = codeOf(read('src/server/routes/appAi.ts'));
  /**
   * The HANDLER only. Anchoring past the import block matters: every symbol asserted on below also
   * appears at the top of the file, so an ordering test run over the whole source would be comparing
   * the order of the IMPORTS — which is alphabetical-ish, unrelated to what the route does, and would
   * pass or fail for reasons that have nothing to do with the behaviour being pinned.
   */
  const handlerStart = file.indexOf('app.post(GATEWAY_PATH');
  const route = file.slice(handlerStart);

  it('is one handler, anchored where this suite thinks it is', () => {
    expect(handlerStart).toBeGreaterThan(0);
    expect(file.split('app.post(GATEWAY_PATH').length - 1).toBe(1);
  });

  it('🔒 refuses before it reads anything, and reads before it spends', () => {
    // Cheapest refusal first: a stranger with a malformed token must never cost a Firestore read,
    // and no model is called until liveness and the caps have both passed.
    const flag = route.indexOf('appAiGatewayEnabled()');
    const token = route.indexOf('verifyAppAiToken');
    const registry = route.indexOf('appAiRegistryStore.get');
    const live = route.indexOf('isLiveDeployment');
    const caps = route.indexOf('gatewayDecision');
    const model = route.indexOf('callProfessionalAIWithUsage');
    for (const i of [flag, token, registry, live, caps, model]) expect(i).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(token);
    expect(token).toBeLessThan(registry);
    expect(registry).toBeLessThan(live);
    expect(live).toBeLessThan(caps);
    expect(caps).toBeLessThan(model);
  });

  it('🔒 the app id comes from the VERIFIED token, never from the request body', () => {
    // A route that read the app id from the body and used the token as a yes/no would let any app's
    // token spend any other app's budget — the exact hole the scoping exists to close.
    expect(route).toContain('appAiRegistryStore.get(verdict.appId)');
    expect(route).toContain('appAiUsageStore.spentToday(verdict.appId');
    expect(route).not.toMatch(/appId\s*[:=]\s*(req\.body|body)/);
  });

  it('🔒 the visitor gets their answer BEFORE any money moves', () => {
    // A money-path failure must never cost a visitor their reply, and charging first would risk
    // billing a turn that then failed.
    const answered = route.indexOf('ok: true, text:');
    expect(answered).toBeGreaterThan(-1);
    expect(route.indexOf('chargeForAiTurns')).toBeGreaterThan(answered);
    expect(route.indexOf('appAiUsageStore.record')).toBeGreaterThan(answered);
  });

  it('🔒 the CAP counter moves on what the turn COST, not on what was debited', () => {
    // They differ whenever the wallet is switched off or the owner is free-listed — and the cap has
    // to keep biting in exactly those cases, or a flag about who pays would silently remove the only
    // ceiling a public endpoint has.
    expect(route).toMatch(/appAiUsageStore\.record\([^)]*cost\.billedInr/s);
  });

  it('🔒 a Professional Pass does not make an app’s public traffic free', () => {
    // The Pass pays for the HOLDER's own assistant use. Treating it as a licence for an unlimited
    // number of strangers would quietly resize a product that was already sold.
    expect(route).not.toContain('hasActivePass:');
    expect(route).not.toContain('isFreeListed:');
  });

  it('🔒 a refusal never tells a visitor whose balance ran out', () => {
    // `app-cap` and `owner-empty` deliberately produce the same words: a stranger is not entitled to
    // know that the site owner's balance ran out — that is a real person's billing state.
    expect(route).toContain('visitorFacingMessage');
    expect(route).not.toContain('ownerFacingMessage');
  });

  it('is registered on the server', () => {
    expect(read('server.ts')).toContain('registerAppAiRoutes(app)');
  });

  it('🔒 no refusal in the WHOLE file names a vendor', () => {
    for (const vendor of ['GLM', 'Kimi', 'Anthropic', 'Gemini', 'Grok', 'OpenAI', 'Moonshot', 'Z.ai']) {
      expect(file, vendor).not.toContain(vendor);
    }
  });
});

describe('minting the token at publish', () => {
  const store = codeOf(read('src/server/AgentV3/DeploymentStore.ts'));

  it('🔒 the registry row is written FIRST, and a failed write means NO stamp', () => {
    // A token in the page whose row never landed is an assistant that fails on every question — the
    // "built but not really working" state that must not exist. So the stamp sits inside the mint's
    // success branch, not beside it.
    expect(store).toMatch(/if\s*\(await appAiRegistryStore\.mint\([^)]*\)\)\s*\{\s*injectGatewayIntoFiles/s);
  });

  it('🔒 the public app id is the one already in the app’s URL — never the workspace id', () => {
    // The token ships in published client code. Putting the workspace id in it would disclose an
    // internal identifier on every page, which is precisely what the analytics beacon avoided.
    expect(store).toMatch(/const appId = siteIdForWorkspace\(workspaceId\)/);
    expect(store).toMatch(/mintAppAiToken\(appId,/);
  });

  it('the whole mint is gated on the master switch and can never break a publish', () => {
    expect(store).toContain('if (appAiGatewayEnabled())');
    expect(store).toMatch(/appAiGatewayEnabled\(\)\)\s*\{\s*try\s*\{/s);
  });
});

describe('what a generated app is given', () => {
  it('the no-key assistant is the DEFAULT when no provider is named AND the gateway is on', () => {
    expect(resolveAiProvider(undefined, true)).toBe('navbharat');
    expect(resolveAiProvider('', true)).toBe('navbharat');
  });

  it('🔒 with the gateway OFF an unnamed provider is an ERROR, not the no-key path', () => {
    // Publishing stamps no token while the flag is unset, so window.NavAI is never defined and
    // isAiReady() is false FOREVER — while the generated helper says "becomes available once this app
    // is published". The user would publish and be told the same thing again. That is a status
    // indicator reporting a state that cannot arrive, and it broke the flag's own promise that unset
    // means today's behaviour exactly.
    expect(resolveAiProvider(undefined, false)).toBeNull();
    expect(resolveAiProvider('', false)).toBeNull();
    // A named BYO provider still works with the gateway off — that path never needed it.
    expect(resolveAiProvider('openai', false)).toBe('openai');
    expect(resolveAiProvider('anthropic', false)).toBe('anthropic');
  });

  it('🔒 a NAMED but unrecognised provider is still an error, either way', () => {
    // Substituting a default for a typo would hand somebody a different integration from the one
    // they asked for.
    expect(resolveAiProvider('openai', true)).toBe('openai');
    expect(resolveAiProvider('gemini', true)).toBeNull();
    expect(resolveAiProvider('gemini', false)).toBeNull();
    expect(isAiProvider('navbharat')).toBe(true);
  });

  it('🔒 the TOOL CATALOG follows the flag — it never advertises a path that cannot work', () => {
    // With the gateway off, steering the builder toward the no-key integration would produce an app
    // that tells its owner to publish for an assistant that never arrives.
    const before = process.env.APP_AI_GATEWAY;
    try {
      delete process.env.APP_AI_GATEWAY;
      const off = defaultToolCatalog().find((t) => t.name === 'generate_ai')!;
      expect(off.description).not.toContain('NO API KEY');
      expect((off.input_schema as { properties: { provider: { enum: string[] } } }).properties.provider.enum)
        .toEqual(['openai', 'anthropic']);
      expect((off.input_schema as { required?: string[] }).required).toEqual(['provider']);

      process.env.APP_AI_GATEWAY = 'on';
      const on = defaultToolCatalog().find((t) => t.name === 'generate_ai')!;
      expect(on.description).toContain('NO API KEY');
      expect((on.input_schema as { required?: string[] }).required).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.APP_AI_GATEWAY;
      else process.env.APP_AI_GATEWAY = before;
    }
  });

  it('there is exactly ONE generate_ai in the catalog, whichever way the flag is set', () => {
    const before = process.env.APP_AI_GATEWAY;
    try {
      for (const v of [undefined, 'on']) {
        if (v === undefined) delete process.env.APP_AI_GATEWAY; else process.env.APP_AI_GATEWAY = v;
        expect(defaultToolCatalog().filter((t) => t.name === 'generate_ai').length, String(v)).toBe(1);
      }
    } finally {
      if (before === undefined) delete process.env.APP_AI_GATEWAY;
      else process.env.APP_AI_GATEWAY = before;
    }
  });

  it('needs no key, no env and no dependency — that is the whole point', () => {
    const cfg = generateAiIntegration('navbharat');
    expect(cfg.envKeys).toEqual([]);
    expect(cfg.dependency).toBeNull();
    expect(Object.keys(cfg.files)).toEqual(['src/lib/ai.ts']);
  });

  it('🔒 is honest about being unavailable before the app is published', () => {
    // Publishing is what stamps the assistant in, so before that it is genuinely absent. Saying so
    // beats throwing something the app author would have to decode.
    const code = generateAiIntegration('navbharat').files['src/lib/ai.ts'];
    expect(code).toContain('export function isAiReady()');
    expect(code).toContain('once this app is published');
  });

  it('🔒 names no vendor anywhere in the code a user reads', () => {
    // The white-label law is about which engine ANSWERS, not about whether a BYO alternative may be
    // offered — so the instructions may say "or use your own OpenAI key" while the generated file,
    // which is what the app's own users could read, names nobody at all.
    const code = generateAiIntegration('navbharat').files['src/lib/ai.ts'];
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Grok', 'Moonshot', 'OpenAI']) {
      expect(code, vendor).not.toContain(vendor);
    }
  });

  it('🔒 the instructions never claim an engine — only the BYO alternative is named', () => {
    const instructions = generateAiIntegration('navbharat').instructions;
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Moonshot']) {
      expect(instructions, vendor).not.toContain(vendor);
    }
    expect(instructions).toContain('NavBharatAI');
  });

  it('the BYO recipes are untouched — a user who wants their own key still gets one', () => {
    expect(generateAiIntegration('openai').dependency).toEqual({ name: 'openai', version: '^4' });
    expect(generateAiIntegration('anthropic').envKeys).toContain('ANTHROPIC_API_KEY');
  });
});

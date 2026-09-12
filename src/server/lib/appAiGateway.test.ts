import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mintAppAiToken, verifyAppAiToken, APP_AI_TOKEN_VERSION, appAiGatewayEnabled,
  gatewayDecision, visitorFacingMessage, ownerFacingMessage, readGatewayRequest,
  appDailyCapInr, visitorDailyCapInr, DEFAULT_APP_DAILY_CAP_INR, DEFAULT_VISITOR_DAILY_CAP_INR,
  MAX_GATEWAY_PROMPT_CHARS, type GatewayRefusal,
  nonceAccepted, rotateNonce, gatewayScriptHtml, injectGatewayScript, injectGatewayIntoFiles,
  GATEWAY_PATH, APP_AI_MARKER,
} from './appAiGateway';

/**
 * THE AI GATEWAY FOR PUBLISHED APPS (ROADMAP §13, 3.1) — slice A.
 *
 * The design rests on one uncomfortable fact: the app's token ships inside published client code, so
 * it is PUBLIC. These tests pin the consequences — scoping is the only guarantee a public string can
 * make, the cap is the real defence, and a stranger on somebody's website never learns whose money
 * ran out.
 */

const SECRET = 'test-secret-key';

describe('the app token', () => {
  it('round-trips and carries the app id', () => {
    const t = mintAppAiToken('ws_abc', SECRET);
    const v = verifyAppAiToken(t, SECRET);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.appId).toBe('ws_abc');
  });

  it('🔒 is SCOPED — one app’s token cannot claim to be another app', () => {
    // The only guarantee a public string can actually make. Swapping the id in a valid token must
    // break the signature, or any app's token could spend any other app's budget.
    const t = mintAppAiToken('ws_abc', SECRET);
    const [ver, , nonce, sig] = t.split('.');
    const forged = [ver, 'ws_victim', nonce, sig].join('.');
    expect(verifyAppAiToken(forged, SECRET)).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses a token signed with a different secret', () => {
    expect(verifyAppAiToken(mintAppAiToken('ws_abc', 'other'), SECRET).ok).toBe(false);
  });

  it('🔒 REPUBLISHING ROTATES IT — a token scraped from an old page dies', () => {
    const first = mintAppAiToken('ws_abc', SECRET);
    const second = mintAppAiToken('ws_abc', SECRET);
    expect(second).not.toBe(first);
    // Both still verify against the secret alone; the route is what binds the CURRENT nonce to the
    // live deployment record, which is the I/O half of the rotation.
    const v = verifyAppAiToken(second, SECRET);
    expect(v.ok && v.nonce).toBeTruthy();
    if (v.ok) expect(v.nonce).not.toBe(verifyAppAiToken(first, SECRET).ok && (verifyAppAiToken(first, SECRET) as { nonce: string }).nonce);
  });

  it('a malformed token is a verdict, never an exception', () => {
    for (const bad of ['', '   ', 'garbage', 'a.b.c', 'a.b.c.d.e', null, undefined, '....']) {
      expect(() => verifyAppAiToken(bad as never, SECRET)).not.toThrow();
      expect(verifyAppAiToken(bad as never, SECRET).ok).toBe(false);
    }
  });

  it('an old token VERSION is refused by name, so a scheme change is legible', () => {
    const t = mintAppAiToken('ws_abc', SECRET).replace(APP_AI_TOKEN_VERSION, 'a0');
    expect(verifyAppAiToken(t, SECRET)).toEqual({ ok: false, reason: 'version' });
  });

  it('an empty app id mints nothing rather than a token for ""', () => {
    expect(mintAppAiToken('', SECRET)).toBe('');
    expect(mintAppAiToken('   ', SECRET)).toBe('');
  });
});

describe('the caps — the real defence', () => {
  const caps = { appCapInr: 20, visitorCapInr: 2 };

  it('allows a call inside both ceilings', () => {
    expect(gatewayDecision({ appSpentInr: 1, visitorSpentInr: 0.1, ownerBalanceInr: 500 }, caps)).toEqual({ allow: true });
  });

  it('stops the app at its daily ceiling', () => {
    expect(gatewayDecision({ appSpentInr: 20, visitorSpentInr: 0, ownerBalanceInr: 500 }, caps))
      .toEqual({ allow: false, reason: 'app-cap' });
  });

  it('🔒 stops ONE visitor consuming the whole app’s day', () => {
    expect(gatewayDecision({ appSpentInr: 3, visitorSpentInr: 2, ownerBalanceInr: 500 }, caps))
      .toEqual({ allow: false, reason: 'visitor-cap' });
  });

  it('refuses when the owner’s wallet is genuinely empty', () => {
    expect(gatewayDecision({ appSpentInr: 0, visitorSpentInr: 0, ownerBalanceInr: 0 }, caps))
      .toEqual({ allow: false, reason: 'owner-empty' });
  });

  it('🔒 an UNREADABLE balance fails OPEN — null is not zero', () => {
    // Refusing on a Firestore hiccup would break every published app at once; allowing risks one
    // call against a cap that is already small. Same direction as the build and chat-turn gates.
    expect(gatewayDecision({ appSpentInr: 0, visitorSpentInr: 0, ownerBalanceInr: null }, caps))
      .toEqual({ allow: true });
  });

  it('a zero app cap means the gateway answers nothing — a real, supported setting', () => {
    expect(gatewayDecision({ appSpentInr: 0, visitorSpentInr: 0, ownerBalanceInr: 500 }, { appCapInr: 0, visitorCapInr: 2 }))
      .toEqual({ allow: false, reason: 'app-cap' });
  });
});

describe('cap configuration', () => {
  it('defaults are deliberately small — an empty wallet is the failure nobody forgives', () => {
    expect(appDailyCapInr({} as never)).toBe(DEFAULT_APP_DAILY_CAP_INR);
    expect(visitorDailyCapInr({} as never)).toBe(DEFAULT_VISITOR_DAILY_CAP_INR);
    expect(DEFAULT_VISITOR_DAILY_CAP_INR).toBeLessThan(DEFAULT_APP_DAILY_CAP_INR);
  });

  it('reads a real value, tolerating what an operator types', () => {
    expect(appDailyCapInr({ APP_AI_DAILY_CAP_INR: ' ₹1,000 ' } as never)).toBe(1000);
  });

  it('🔒 an UNREADABLE cap falls back to the default, never to unlimited', () => {
    expect(appDailyCapInr({ APP_AI_DAILY_CAP_INR: 'lots' } as never)).toBe(DEFAULT_APP_DAILY_CAP_INR);
    expect(appDailyCapInr({ APP_AI_DAILY_CAP_INR: '-5' } as never)).toBe(DEFAULT_APP_DAILY_CAP_INR);
  });

  it('an explicit 0 is honoured — "this app answers nothing"', () => {
    expect(appDailyCapInr({ APP_AI_DAILY_CAP_INR: '0' } as never)).toBe(0);
  });
});

describe('🔒 what the app’s VISITOR is told — the white-label law on somebody else’s website', () => {
  const REASONS: GatewayRefusal[] = ['app-cap', 'visitor-cap', 'owner-empty', 'disabled', 'not-live', 'bad-token'];
  const FORBIDDEN = /openai|anthropic|claude|gemini|google|gpt|grok|kimi|moonshot|glm|z\.ai|vertex|bedrock|deepseek|llm|model/i;

  it('never names a provider or a model, for any refusal', () => {
    for (const r of REASONS) expect(visitorFacingMessage(r)).not.toMatch(FORBIDDEN);
  });

  it('🔒 never tells a stranger that the owner’s money ran out', () => {
    // A visitor on someone's website is not entitled to that person's billing state. So an empty
    // wallet and a spent cap say the SAME thing to them, and differ only on the owner's own screen.
    expect(visitorFacingMessage('owner-empty')).toBe(visitorFacingMessage('app-cap'));
    expect(visitorFacingMessage('owner-empty')).not.toMatch(/balance|wallet|money|paid|top ?up|credit/i);
  });

  it('the OWNER does get the true reason, and it is actionable', () => {
    expect(ownerFacingMessage('owner-empty')).toMatch(/balance/i);
    expect(ownerFacingMessage('owner-empty')).toMatch(/top up/i);
    expect(ownerFacingMessage('app-cap')).toMatch(/limit/i);
    for (const r of REASONS) expect(ownerFacingMessage(r)).not.toMatch(FORBIDDEN);
  });

  it('a visitor who hit their OWN limit is told so — that one is theirs to know', () => {
    expect(visitorFacingMessage('visitor-cap')).toMatch(/today/i);
  });
});

describe('the request a stranger sends', () => {
  it('accepts a normal prompt', () => {
    expect(readGatewayRequest({ prompt: ' hello ' })).toEqual({ ok: true, prompt: 'hello', system: '' });
  });

  it('refuses an empty prompt', () => {
    for (const b of [{}, { prompt: '' }, { prompt: '   ' }, null, undefined, 'nonsense', 42]) {
      expect(readGatewayRequest(b as never).ok).toBe(false);
    }
  });

  it('🔒 bounds the prompt — a stranger’s input is never trusted for size', () => {
    const r = readGatewayRequest({ prompt: 'x'.repeat(MAX_GATEWAY_PROMPT_CHARS + 1) });
    expect(r).toEqual({ ok: false, reason: 'too-long' });
  });

  it('🔒 bounds the SYSTEM prompt too, even though it is the app author’s', () => {
    // It arrives over the same public wire, so it is bounded rather than trusted for its origin.
    const r = readGatewayRequest({ prompt: 'hi', system: 'y'.repeat(MAX_GATEWAY_PROMPT_CHARS + 500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.system.length).toBe(MAX_GATEWAY_PROMPT_CHARS);
  });
});

describe('the master switch', () => {
  it('🔒 is OFF by default — a new path that spends a real wallet is never on by accident', () => {
    // The first draft of this defaulted to ON, reasoning the gateway is inert until a published app
    // carries a token. True today; false the moment the publish path starts minting them — at which
    // point it would go live for every published app on a deploy, with nobody having decided so.
    expect(appAiGatewayEnabled({} as never)).toBe(false);
    expect(appAiGatewayEnabled({ APP_AI_GATEWAY: '' } as never)).toBe(false);
  });

  it('turns on only for the literal word, in any case', () => {
    expect(appAiGatewayEnabled({ APP_AI_GATEWAY: 'on' } as never)).toBe(true);
    expect(appAiGatewayEnabled({ APP_AI_GATEWAY: ' ON ' } as never)).toBe(true);
  });

  it('anything ambiguous stays OFF rather than guessing', () => {
    for (const v of ['true', '1', 'yes', 'enabled', 'off']) {
      expect(appAiGatewayEnabled({ APP_AI_GATEWAY: v } as never), v).toBe(false);
    }
  });

  it('🔒 it matches the OTHER spend switches in this codebase, not the advisory ones', () => {
    // AI_WALLET_SPEND / STORE_BILLING / NAVBHARAT_WEB_RISK are all opt-in; the default-ON switches
    // here (AGENTV3_ARCH_INVARIANTS, AGENTV3_JOURNEY_CHECK, …) are the ones that cost nothing.
    const src = readFileSync(join(process.cwd(), 'src/server/lib/appAiGateway.ts'), 'utf8');
    expect(src).toContain("=== 'on'");
    expect(src).not.toContain("!== 'off'");
  });
});


// ── SLICE B: rotation, and what actually lands in the published page ─────────────────────────────

describe('nonce rotation', () => {
  it('a fresh publish demotes the outgoing nonce rather than dropping it', () => {
    expect(rotateNonce({ nonce: 'n1' }, 'n2')).toEqual({ nonce: 'n2', prevNonce: 'n1' });
  });

  it('🔒 keeps EXACTLY one generation of slack — two publishes ago is dead', () => {
    // The registry row is written before the new files reach the host, so a page a visitor already
    // has open still carries the old token for the length of a deploy. One generation covers that;
    // two would make rotation decorative.
    const after1 = rotateNonce(null, 'n1');
    const after2 = rotateNonce(after1, 'n2');
    const after3 = rotateNonce(after2, 'n3');
    expect(nonceAccepted('n3', after3)).toBe(true);
    expect(nonceAccepted('n2', after3)).toBe(true);
    expect(nonceAccepted('n1', after3)).toBe(false);
  });

  it('republishing without a change does not evict the only valid nonce', () => {
    expect(rotateNonce({ nonce: 'n1', prevNonce: 'n0' }, 'n1')).toEqual({ nonce: 'n1' });
  });

  it('an empty or missing nonce is never accepted', () => {
    expect(nonceAccepted('', { nonce: '' })).toBe(false);
    expect(nonceAccepted('n1', null)).toBe(false);
    expect(nonceAccepted('  ', { nonce: 'n1' })).toBe(false);
  });
});

describe('the snippet stamped into a published page', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>';

  it('defines window.NavAI and points at the one gateway path', () => {
    const out = gatewayScriptHtml('nbai-abc', 'a1.nbai-abc.n.sig', 'https://navbharatai.com');
    expect(out).toContain('window.NavAI');
    expect(out).toContain(`https://navbharatai.com${GATEWAY_PATH}`);
    expect(out).toContain('a1.nbai-abc.n.sig');
  });

  it('🔒 goes into <head>, not before </body>', () => {
    // The app's own bundle may call window.NavAI as soon as it executes. A helper defined after the
    // script that uses it is a race the app author can neither see nor fix.
    const out = injectGatewayScript(html, 'nbai-abc', 'tok', 'https://navbharatai.com');
    expect(out.indexOf(APP_AI_MARKER)).toBeLessThan(out.indexOf('<body>'));
  });

  it('🔒 every failure path in the snippet ends in branded text, never a status code', () => {
    // White-Label Law applied to somebody ELSE's visitors: a stranger on a user's website must not
    // learn which vendor answered, or that the owner's balance ran out.
    const out = gatewayScriptHtml('nbai-abc', 'tok', 'https://navbharatai.com');
    expect(out).toContain(visitorFacingMessage('disabled'));
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Grok', 'OpenAI', 'Moonshot']) {
      expect(out, vendor).not.toContain(vendor);
    }
  });

  it('is idempotent — a re-publish replaces rather than stacks', () => {
    const once = injectGatewayScript(html, 'nbai-abc', 'tok', 'https://navbharatai.com');
    expect(injectGatewayScript(once, 'nbai-abc', 'tok2', 'https://navbharatai.com')).toBe(once);
  });

  it('leaves anything that is not an HTML document alone', () => {
    expect(injectGatewayScript('{"a":1}', 'nbai-abc', 'tok', 'https://x')).toBe('{"a":1}');
  });
});

describe('stamping a publish bundle', () => {
  const bundle = () => new Map<string, Buffer>([
    ['index.html', Buffer.from('<!doctype html><html><head></head><body></body></html>')],
    ['about.html', Buffer.from('<!doctype html><html><head></head><body></body></html>')],
    ['app.js', Buffer.from('console.log(1)')],
  ]);

  it('stamps every HTML file and nothing else', () => {
    const files = bundle();
    const n = injectGatewayIntoFiles(files, {
      appId: 'nbai-abc', token: 'tok', origin: 'https://navbharatai.com',
      env: { APP_AI_GATEWAY: 'on' } as never,
    });
    expect(n).toBe(2);
    expect(files.get('app.js')!.toString()).toBe('console.log(1)');
  });

  it('🔒 stamps NOTHING when the switch is off', () => {
    const files = bundle();
    expect(injectGatewayIntoFiles(files, {
      appId: 'nbai-abc', token: 'tok', origin: 'https://x', env: {} as never,
    })).toBe(0);
    expect(files.get('index.html')!.toString()).not.toContain(APP_AI_MARKER);
  });

  it('🔒 stamps NOTHING without a token — a page must never carry an empty one', () => {
    // The publish path only reaches here when the registry row landed. A token-less stamp would
    // produce an assistant that fails on every question: the built-but-not-working state.
    const files = bundle();
    expect(injectGatewayIntoFiles(files, {
      appId: 'nbai-abc', token: '', origin: 'https://x', env: { APP_AI_GATEWAY: 'on' } as never,
    })).toBe(0);
  });
});

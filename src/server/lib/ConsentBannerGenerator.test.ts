import { describe, it, expect } from 'vitest';
import {
  generateConsentBannerIntegration, buildConsentBannerScript, buildConsentBannerReadme,
  CONSENT_CORE_SOURCE, CONSENT_BANNER_PATH, CONSENT_BANNER_README_PATH, CORE_BEGIN, CORE_END,
} from './ConsentBannerGenerator';

/** Execute the REAL emitted core (plain JS, no DOM) — the rules below are legal requirements, not style. */
interface Core {
  STORAGE_KEY: string;
  parseStored(raw: string | null, v: string): { granted: string[]; at: string | null } | null;
  serialize(granted: string[], v: string, nowIso: string): string;
  initialState(raw: string | null, v: string, gpc: boolean): { show: boolean; granted: string[]; source: string };
  scriptAllowed(attr: string | null, granted: string[]): boolean;
  choose(kind: string, purposes: string[], chosen?: string[]): string[];
}
function loadCore(): Core {
  const script = buildConsentBannerScript();
  const start = script.indexOf(CORE_BEGIN);
  const end = script.indexOf(CORE_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const src = script.slice(start, end);
  return new Function(`${src}; return NavConsentCore;`)() as Core;
}

describe('generateConsentBannerIntegration (wiring)', () => {
  it('emits the script and the README, needs no dependency, and tells the model the three wiring steps', () => {
    const out = generateConsentBannerIntegration({ appName: 'Sharma Stores' });
    expect(Object.keys(out.files)).toEqual([CONSENT_BANNER_PATH, CONSENT_BANNER_README_PATH]);
    expect(out.dependencies).toEqual([]);
    expect(out.instructions).toContain('<script src="/consent-banner.js"></script>');
    expect(out.instructions).toContain('type="text/plain" data-consent=');
    expect(out.instructions).toContain('data-consent-open');
    expect(out.files[CONSENT_BANNER_PATH]).toContain(CONSENT_CORE_SOURCE);
  });
});

describe('emitted core — the consent rules, executed', () => {
  const core = loadCore();
  const V = '2026-09-10';

  it('🔒 a fresh visitor is ASKED, with nothing granted meanwhile', () => {
    expect(core.initialState(null, V, false)).toEqual({ show: true, granted: [], source: 'undecided' });
    expect(core.initialState('garbage{', V, false).show).toBe(true);
  });

  it('🔒 a stored choice is honoured without a banner — but ONLY for the policy version it was made under', () => {
    const raw = core.serialize(['analytics'], V, '2026-09-10T00:00:00Z');
    expect(core.initialState(raw, V, false)).toEqual({ show: false, granted: ['analytics'], source: 'stored' });
    // The policy changed → ask again. A silent carry-over would be consent to terms never shown.
    expect(core.initialState(raw, '2026-12-01', false).show).toBe(true);
    expect(core.parseStored(raw, '2026-12-01')).toBeNull();
  });

  it('🔒 Global Privacy Control = no consent and no nag; the visitor can still opt in later', () => {
    expect(core.initialState(null, V, true)).toEqual({ show: false, granted: [], source: 'gpc' });
    // An explicit earlier grant still wins over GPC (they chose).
    expect(core.initialState(core.serialize(['marketing'], V, 'x'), V, true).granted).toEqual(['marketing']);
  });

  it('🔒 a gated script runs only when EVERY purpose it names is granted; an unlabelled one never runs', () => {
    expect(core.scriptAllowed('analytics', ['analytics'])).toBe(true);
    expect(core.scriptAllowed('analytics marketing', ['analytics'])).toBe(false);
    expect(core.scriptAllowed('analytics, marketing', ['analytics', 'marketing'])).toBe(true);
    expect(core.scriptAllowed('', ['analytics'])).toBe(false);
    expect(core.scriptAllowed(null, ['analytics'])).toBe(false);
  });

  it('the three answers: accept-all, reject-all, and save keeps only purposes the app offers', () => {
    const P = ['analytics', 'marketing'];
    expect(core.choose('accept-all', P)).toEqual(P);
    expect(core.choose('reject-all', P, ['analytics'])).toEqual([]);
    expect(core.choose('save', P, ['marketing', 'bogus', 'marketing'])).toEqual(['marketing']);
  });

  it('serialize de-duplicates and stamps the version', () => {
    expect(JSON.parse(core.serialize(['a', 'a', ' b '], V, 'now'))).toEqual({ v: V, granted: ['a', 'b'], at: 'now' });
    expect(core.STORAGE_KEY).toBe('nav_consent_v1');
  });
});

describe('emitted DOM shell — what the visitor sees', () => {
  const s = buildConsentBannerScript({ appName: 'Sharma Stores', grievanceEmail: 'privacy@sharma.example', policyUrl: '/privacy-policy', purposes: ['analytics'], policyVersion: '2026-09-10' });

  it('🔒 nothing non-essential loads before consent: only text/plain + data-consent scripts are activated, once each', () => {
    expect(s).toContain('script[type="text/plain"][data-consent]');
    expect(s).toContain("getAttribute('data-consent-activated') === 'true'");
    expect(s).toContain('NavConsentCore.scriptAllowed(');
  });

  it('🔒 Reject all stands beside Accept all, and only Necessary is pre-checked (disabled, always on)', () => {
    expect(s).toContain('data-act="reject-all"');
    expect(s).toContain('data-act="accept-all"');
    expect(s).toContain('<input type="checkbox" checked disabled id="nbc-necessary">');
    // Purpose boxes reflect the saved choice only — never ticked on a fresh visit.
    expect(s).toContain("(on ? ' checked' : '')");
  });

  it('🔒 withdrawal as easy as consent: data-consent-open reopens, and a fallback control exists when the app has none', () => {
    expect(s).toContain("closest('[data-consent-open]')");
    expect(s).toContain("document.querySelector('[data-consent-open]')");
    expect(s).toContain('nbc-fab');
  });

  it('bilingual by default, with the Privacy Policy link and the grievance contact on the banner', () => {
    expect(s).toContain('"language":"both"');
    expect(s).toContain('Sharma Stores uses cookies');
    expect(s).toContain('Sharma Stores कुकीज़');
    expect(s).toContain('"policyUrl":"/privacy-policy"');
    expect(s).toContain('"grievance":"privacy@sharma.example"');
    expect(s).toContain('"purposes":["analytics"]');
    expect(s).toContain('"version":"2026-09-10"');
  });

  it('🔒 configuration values cannot break out of the script (no quotes, tags or template characters survive)', () => {
    const hostile = buildConsentBannerScript({ appName: 'X"</script><script>alert(1)//`${y}', policyUrl: 'javascript:alert(1)', grievanceEmail: 'not an email', purposes: ['bogus' as never] });
    // Quotes, angle brackets, backticks and `$` are stripped BEFORE JSON.stringify, so the name can neither
    // close the string literal nor form a tag when rendered (render also HTML-escapes).
    expect(hostile).toContain('"app":"X/scriptscriptalert(1)//{y}"');
    expect(hostile).not.toContain('javascript:alert(1)');
    expect(hostile).toContain('"policyUrl":"/privacy"');       // bad URL → safe default
    expect(hostile).toContain('"grievance":""');                // bad email → omitted
    expect(hostile).toContain('"purposes":["analytics","marketing"]'); // bad list → default
  });

  it('🔒 white-label: no vendor or model name anywhere in what ships to the user\'s visitors', () => {
    expect(s).not.toMatch(/claude|anthropic|gemini|openai|glm|kimi|grok/i);
    expect(buildConsentBannerReadme()).not.toMatch(/claude|anthropic|gemini|openai|glm|kimi|grok/i);
  });

  it('the emitted script is syntactically valid JavaScript', () => {
    expect(() => new Function(s)).not.toThrow();
  });
});

describe('README', () => {
  it('shows the before/after for gating a script, the version rule and the honest limit on withdrawal', () => {
    const r = buildConsentBannerReadme({ purposes: ['analytics', 'marketing'] });
    expect(r).toContain('type="text/plain" data-consent="analytics"');
    expect(r).toContain('data-version');
    expect(r).toContain('cannot be unloaded');
    expect(r).toContain('data-purposes="analytics marketing"');
  });
});

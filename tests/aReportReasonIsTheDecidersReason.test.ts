// AUTOPSY 303e8a6f (2026-10-12), item W — the report said "The request asks for no sign-in, so the builder was told
// to add no login…" about a request that never mentioned sign-in. The rule fires on ABSENCE (no sign-in word, no
// domain that adds access control, a new build); the sentence was a hand-written literal at the call site that
// restated the verdict in words the decider never computed. Worse, an explicit "no login needed" read as a request
// FOR sign-in (the regex matched "login" whatever came before it), so the sentence could only ever appear where it
// was false — and the rule stood down exactly when the user had declined sign-in.
//
// Found beside it: the rule stood down for EVERY recognised domain, citing "the requirement analyzer adds access
// control there" — but productivity, booking, trading and game add none, so "a todo app" got no note (the 70e030bb
// class itself). The domain's own feature list now decides.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requestScopeVerdict, requestScopeNote, requestScopeReportLine, asksForSignIn, declinesSignIn, REQUEST_SCOPE_NOTE } from '../src/server/AgentV3/requestScope';
import { analyzeRequirementGaps, domainAddsAccessControl, requirementDomainKeys } from '../src/server/lib/RequirementGapAnalyzer';
import { RETIRED_CHIP_PROMPTS } from '../src/server/AgentV3/goldenScaffolds/registry';

const REPORT_PROMPT = RETIRED_CHIP_PROMPTS['ai-image']![0]!; // the report's own prompt, verbatim
const verdict = (request: string, domain = analyzeRequirementGaps(request).domain) => requestScopeVerdict({ request, newBuild: true, domain }, {});

describe('1 · the report states the decider\'s own reason', () => {
  it('the report\'s prompt: the note fires because the request is SILENT about sign-in', () => {
    expect(analyzeRequirementGaps(REPORT_PROMPT).domain).toBe('general');
    expect(verdict(REPORT_PROMPT)).toEqual({ note: REQUEST_SCOPE_NOTE, reason: 'names-no-sign-in' });
    // No phrase in it is read as a decline: it fires the same with the "needs no API key" clause gone or flipped.
    const without = REPORT_PROMPT.replace(', and use the free image engine that needs no API key', '');
    expect(verdict(without)?.reason).toBe('names-no-sign-in');
    expect(verdict(REPORT_PROMPT.replace('needs no API key', 'needs an API key'))?.reason).toBe('names-no-sign-in');
  });

  it('the line for silence says silence; the line for a decline says decline; neither claims an "ask for no"', () => {
    expect(requestScopeReportLine('names-no-sign-in')).toMatch(/^The request matched none of the sign-in words this rule looks for/);
    expect(requestScopeReportLine('declines-sign-in')).toMatch(/^The request declines sign-in/);
    for (const r of ['names-no-sign-in', 'declines-sign-in'] as const) {
      expect(requestScopeReportLine(r)).not.toMatch(/\b(?:asks?|asked|requests?|requested|wants?|wanted)\s+(?:for\s+)?no\b/i);
    }
  });

  // The adversarial review: the line must never claim more than the detector checked. It credits the word list
  // and the analyzer's domain features — never "the request names no access word".
  it.each(['an app where you enter your username to continue', 'a vault that asks for credentials', 'notes with 2FA', 'a diary unlocked with face id', 'a biometric gate before the app'])(
    '🔒 a gate named by its mechanism is a sign-in request — no note, so no claim at all: %s', (p) => {
      expect(asksForSignIn(p), p).toBe(true);
      expect(requestScopeNote({ request: p, newBuild: true, domain: 'general' }, {})).toBe('');
    });

  it('🔒 whenever the note fires, its report line credits the detector and nothing wider', () => {
    for (const p of [REPORT_PROMPT, 'a todo app', 'A calculator, no login needed.', 'a weather dashboard']) {
      const v = verdict(p);
      if (!v) continue;
      const line = requestScopeReportLine(v.reason);
      expect(line).toMatch(/sign-in words this rule looks for/);
      expect(line).toMatch(/no domain whose features add access control/);
      expect(line).not.toMatch(/other access word|names no sign-in|\b(?:asks?|asked|requests?|wants?)\s+(?:for\s+)?no\b/i);
    }
  });

  it('🔒 the route records the decider\'s line, never a literal', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/code: 'REQUEST_SCOPE_NOTE', message: requestScopeReportLine\(requestScopeReason \?\? 'names-no-sign-in'\)/);
  });

  it('tripwire: no report message anywhere restates an absence as an explicit "asks for no" or a decline', () => {
    const ROOT = join(__dirname, '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
      }
      return out;
    };
    const hits: string[] = [];
    for (const f of [...walk(join(ROOT, 'src')), join(ROOT, 'server.ts')]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/message:\s*(['"`])((?:(?!\1).)*)\1/g)) {
        // A TRIPWIRE for the phrasings seen (asks for no …, the request declined / said no / did not want …) — not a
        // proof: the class lock is the source guard above (the decider owns its sentence). "The user declined" stays
        // allowed: the database offer records a real answer the user gave in the UI.
        if (/\b(?:asks?|asked|requests?|requested|wants?|wanted)\s+(?:for\s+)?no\b|\bthe request (?:declined|said no|ruled out|did(?: not|n't) want)\b/i.test(m[2]!)) hits.push(`${f.slice(ROOT.length + 1)}: ${m[2]!.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('2 · a decline is a decline', () => {
  it.each(['A calculator with no sign-in.', 'A calculator, no login needed.', 'A habit tracker without an account', 'A diary — login is not required', 'Ek notes app, login ki zarurat nahi'])(
    'declined — the note applies, and says why: %s', (p) => {
      expect(declinesSignIn(p), p).toBe(true);
      expect(asksForSignIn(p), p).toBe(false);
      expect(verdict(p, 'general')?.reason).toBe('declines-sign-in');
    });

  it.each([
    "Don't make it public, add a login", 'No login needed for customers, but an admin login for the owner',
    'No account required, but protect the data with a PIN', 'notes app with login',
  ])('a request that still asks keeps the rule standing down — %s', (p) => {
    expect(asksForSignIn(p), p).toBe(true);
    expect(requestScopeNote({ request: p, newBuild: true, domain: 'general' }, {})).toBe('');
  });
});

describe('3 · the domain stand-down is the domain\'s own feature list', () => {
  it('domains that add access control stand the rule down; the rest do not', () => {
    const adds = requirementDomainKeys().filter((k) => domainAddsAccessControl(k));
    const none = requirementDomainKeys().filter((k) => !domainAddsAccessControl(k));
    expect(adds).toEqual(expect.arrayContaining(['healthcare', 'ecommerce', 'saas', 'education', 'fintech', 'crm']));
    expect(none).toEqual(expect.arrayContaining(['productivity', 'game', 'booking']));
    expect(domainAddsAccessControl('general')).toBe(false);
    expect(domainAddsAccessControl('a-domain-that-does-not-exist')).toBe(true); // precision first
  });

  it.each(['a todo app', 'a notes app', 'a racing game'])('"%s" gets the note now', (p) => {
    expect(analyzeRequirementGaps(p).domain).not.toBe('general');
    expect(verdict(p)?.note).toBe(REQUEST_SCOPE_NOTE);
  });

  it('a recognised domain that adds access control still stands it down', () => {
    expect(verdict('hospital management system')).toBeNull();
    expect(verdict('an online store with cart and checkout')).toBeNull();
  });
});

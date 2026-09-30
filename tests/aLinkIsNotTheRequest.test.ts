// Autopsy 33812996 (2026-09-30, "Circle to Search", Weak, 31 min). The request ended with its reference
// link — https://play.google.com/store/apps/details?id=com.circletosearch.android. The word "store" in
// that URL made the requirement analyser file an ECOMMERCE app (cart, checkout, refunds), the URL's path
// took the build-time estimate from 2 modules to 6, and "screen translation" in the feature list filed
// the whole 26-file app as a TRANSLATE task, score 15, cheapest band.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withoutMachineText } from '../src/server/lib/machineText';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { needsSecondOpinion } from '../src/server/AgentV3/complexityRouting';
import { countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { requestedCapabilities } from '../src/server/AgentV3/nativeCapabilities';
import { complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';

const REPORT = "Create circle to search app from scratch add features like qr scanner, screen translation , music recognition, ai overview use google, duckduckgo, bing search engine result in app. \n \nMake this app layout like this app with all this features i mention \n\nApp link = https://play.google.com/store/apps/details?id=com.circletosearch.android";

describe('the report\'s own request', () => {
  it('🔴 is not an ecommerce app', () => {
    expect(analyzeRequirementGaps(REPORT).domain).not.toBe('ecommerce');
  });
  it('🔴 is an app, not a translation task — and the platform asks a second opinion on its size', () => {
    const r = analyzeRequest({ prompt: REPORT, buildIntent: 'new_build' });
    expect(r.taskType).not.toBe('translate');
    expect(needsSecondOpinion(r.complexityScore, REPORT)).toBe(true);
  });
  it('the link adds no modules to the estimate', () => {
    expect(complexityFromPrompt(REPORT)).toEqual(complexityFromPrompt(REPORT.replace(/https:\S+/, '')));
  });
});

describe('the CLASS: every reader of "what was asked" gives the same answer with or without a link', () => {
  // Trap words in the path: a shop, a login, a camera, a hospital, pages and a checkout.
  const LINKS = [
    'https://play.google.com/store/apps/details?id=com.example.android',
    'https://example.com/hospital/login/camera/checkout/cart/pages/admin',
    'www.example.in/shop/booking/payments/dashboard',
  ];
  const BASES = [
    'Build a notes app with tags and search. Reference:',
    'make a simple expense tracker like this',
    'Create a quiz game for kids, see',
  ];
  for (const base of BASES) for (const link of LINKS) {
    const withLink = `${base} ${link}`;
    it(`${base.slice(0, 24)}… + ${link.slice(0, 28)}…`, () => {
      expect(analyzeRequirementGaps(withLink).domain).toBe(analyzeRequirementGaps(base).domain);
      expect(analyzeRequest({ prompt: withLink }).taskType).toBe(analyzeRequest({ prompt: base }).taskType);
      expect(analyzeRequest({ prompt: withLink }).complexityScore).toBe(analyzeRequest({ prompt: base }).complexityScore);
      expect(countEnumeratedFeatures(withLink)).toBe(countEnumeratedFeatures(base));
      expect(requestedCapabilities(withLink)).toEqual(requestedCapabilities(base));
      expect(complexityFromPrompt(withLink)).toEqual(complexityFromPrompt(base));
      expect(analyzeAppScope(withLink).decision).toBe(analyzeAppScope(base).decision);
    });
  }
});

describe('a translation or summary is still the task when nothing is being built', () => {
  it.each([
    'translate this paragraph to hindi: the weather is nice today',
    'please translate my resume into english',
  ])('%s', (p) => expect(analyzeRequest({ prompt: p }).taskType).toBe('translate'));
  it('summary', () => expect(analyzeRequest({ prompt: 'give me a summary of this article about solar panels' }).taskType).toBe('summary'));
  it('an app ordered with a translation feature is the app', () => {
    expect(analyzeRequest({ prompt: 'Build a travel app with offline maps, phrase translation and a currency converter' }).taskType).not.toBe('translate');
  });
});

describe('the helper', () => {
  it('blanks by default so windows keep their offsets, drops on request', () => {
    const t = 'see https://x.com/store now';
    expect(withoutMachineText(t)).toHaveLength(t.length);
    expect(withoutMachineText(t)).not.toMatch(/store/);
    expect(withoutMachineText(t, { drop: true })).toBe('see  now');
  });
  it('a bare address with a path is machine text too', () => {
    expect(withoutMachineText('like play.google.com/store/apps/x')).not.toMatch(/store/);
  });
  it('a sentence with a dot in it is left alone', () => {
    expect(withoutMachineText('store data. then show it')).toBe('store data. then show it');
  });
});

describe('one helper, not copies', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it.each([
    'src/server/lib/RequirementGapAnalyzer.ts',
    'src/server/AgentV3/RequestAnalyser.ts',
    'src/server/lib/BuildTimeEstimator.ts',
    'src/server/AgentV3/enumeratedFeatures.ts',
    'src/server/AgentV3/nativeCapabilities.ts',
    'src/server/lib/appScopeAnalyzer.ts',
    'src/server/AgentV3/featureRequest.ts',
  ])('%s imports lib/machineText', (p) => {
    expect(read(p)).toMatch(/import \{ withoutMachineText \} from '\.\.?\/(?:lib\/)?machineText'/);
  });
});

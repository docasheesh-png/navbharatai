/**
 * A screenshot must become something the build can be HELD TO, not a paragraph it can ignore.
 *
 * The failure this exists to end: a user uploads a five-section landing page, the vision model writes
 * a nice description, the builder delivers three sections, and nothing in the system notices. The
 * image was "used"; the design was not delivered.
 *
 * Two properties carry it, and they pull in opposite directions — which is exactly why both are
 * tested here rather than assumed:
 *   1. It must NAME what is missing, or it adds nothing over the prose it replaces.
 *   2. It must NEVER cry wolf. A false "missing" sends the next turn to rebuild a section that was
 *      already there — spending the user's money to damage working code. A false "present" merely
 *      fails to notice. The bias is deliberate and asymmetric.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDesignContract,
  stripContractBlock,
  contractToPromptBlock,
  verifyDesignContract,
  DESIGN_CONTRACT_INSTRUCTION,
  type DesignContract,
} from '../src/server/AgentV3/designContract';

const CONTRACT_JSON = {
  screens: [{ name: 'Landing page', sections: ['hero', 'features', 'pricing'], labels: ['Get started', 'Contact us'] }],
  palette: ['#0f172a', '#22d3ee'],
  viewport: 'responsive',
};

const fenced = (obj: unknown, tag = 'design-contract') =>
  `Here is what I see.\n\n\`\`\`${tag}\n${JSON.stringify(obj)}\n\`\`\`\n`;

describe('the vision instruction', () => {
  it('demands verbatim labels and top-to-bottom order — the two things that make it checkable', () => {
    expect(DESIGN_CONTRACT_INSTRUCTION).toContain('VERBATIM');
    expect(DESIGN_CONTRACT_INSTRUCTION).toContain('TOP TO BOTTOM');
  });

  it('🔒 tells the model to omit the block rather than guess when the file is not a design', () => {
    // An invented contract for a photo of a receipt would be verified against, and would then report
    // a perfectly good app as not matching a design that never existed.
    expect(DESIGN_CONTRACT_INSTRUCTION).toMatch(/omit the block[\s\S]*rather than guessing/);
  });
});

describe('parseDesignContract', () => {
  it('reads the fenced block', () => {
    const c = parseDesignContract(fenced(CONTRACT_JSON));
    expect(c?.screens[0].sections).toEqual(['hero', 'features', 'pricing']);
    expect(c?.screens[0].labels).toEqual(['Get started', 'Contact us']);
    expect(c?.viewport).toBe('responsive');
  });

  it('tolerates the fence variants models actually emit', () => {
    expect(parseDesignContract(fenced(CONTRACT_JSON, 'json'))).not.toBeNull();
    expect(parseDesignContract(fenced(CONTRACT_JSON, ''))).not.toBeNull();
    // No fence at all — the model still did what was asked.
    expect(parseDesignContract(`prose ${JSON.stringify(CONTRACT_JSON)} more prose`)).not.toBeNull();
  });

  it('🔒 yields null — never an empty contract — when there is nothing to read', () => {
    // An empty contract would "verify" trivially and report success for a design nobody checked.
    for (const bad of ['', null, undefined, 'just prose', '```design-contract\nnot json\n```', '```design-contract\n{"screens":[]}\n```']) {
      expect(parseDesignContract(bad as never), String(bad)).toBeNull();
    }
  });

  it('drops a screen that says nothing checkable instead of carrying a row that always passes', () => {
    const c = parseDesignContract(fenced({ screens: [{ name: 'Empty', sections: [], labels: [] }, CONTRACT_JSON.screens[0]] }));
    expect(c?.screens).toHaveLength(1);
    expect(c?.screens[0].name).toBe('Landing page');
  });

  it('bounds and de-duplicates, so one contract cannot swamp the build prompt', () => {
    const c = parseDesignContract(fenced({
      screens: Array.from({ length: 20 }, () => ({ name: 'S', sections: Array.from({ length: 40 }, (_, i) => `sec${i}`), labels: ['A', 'a', 'A'] })),
    }));
    expect(c!.screens.length).toBeLessThanOrEqual(6);
    expect(c!.screens[0].sections.length).toBeLessThanOrEqual(12);
    expect(c!.screens[0].labels).toEqual(['A']); // case-insensitive dedupe
  });

  it('survives junk inside a well-formed shell', () => {
    const c = parseDesignContract(fenced({ screens: [{ name: 42, sections: [1, null, 'hero'], labels: 'nope' }], palette: 'x', viewport: 7 }));
    expect(c?.screens[0].name).toBe('Screen');
    expect(c?.screens[0].sections).toEqual(['hero']);
    expect(c?.screens[0].labels).toEqual([]);
    expect(c?.viewport).toBe('responsive');
  });

  it('picks the valid block when an earlier one is broken', () => {
    const text = '```design-contract\n{broken\n```\n' + fenced(CONTRACT_JSON);
    expect(parseDesignContract(text)?.screens[0].name).toBe('Landing page');
  });
});

describe('stripContractBlock', () => {
  it('removes the JSON so the build prompt is not shown it twice', () => {
    const out = stripContractBlock(fenced(CONTRACT_JSON));
    expect(out).toContain('Here is what I see.');
    expect(out).not.toContain('screens');
  });

  it('leaves prose with no block untouched', () => {
    expect(stripContractBlock('just prose')).toBe('just prose');
  });
});

describe('contractToPromptBlock', () => {
  const c = parseDesignContract(fenced(CONTRACT_JSON))!;

  it('states the order, because the right parts in the wrong order is the wrong page', () => {
    expect(contractToPromptBlock(c)).toContain('IN THIS ORDER');
    expect(contractToPromptBlock(c)).toContain('hero → features → pricing');
  });

  it('quotes the labels so they land in the code verbatim', () => {
    expect(contractToPromptBlock(c)).toContain('"Get started"');
  });

  it('🔒 phrases it as a requirement, not a description — that is the whole point of the step', () => {
    expect(contractToPromptBlock(c)).toContain('not a suggestion');
  });

  it('produces nothing at all when there is no contract', () => {
    expect(contractToPromptBlock(null)).toBe('');
  });
});

describe('verifyDesignContract', () => {
  const c = parseDesignContract(fenced(CONTRACT_JSON))!;

  const app = (body: string) => ({ 'src/App.tsx': body });

  it('reports MET when everything is present', () => {
    const r = verifyDesignContract(c, app(`
      <HeroSection/> <Features/> <Pricing/>
      <button>Get started</button> <a>Contact us</a>
    `));
    expect(r.verdict).toBe('DESIGN_CONTRACT_MET');
    expect(r.found).toBe(r.total);
    expect(r.summary).toContain('matches the uploaded design');
  });

  it('🔒 NAMES what is missing — otherwise it adds nothing over the prose', () => {
    const r = verifyDesignContract(c, app('<HeroSection/> <button>Get started</button>'));
    expect(r.verdict).toBe('DESIGN_CONTRACT_PARTIAL');
    expect(r.missingSections).toEqual(['features', 'pricing']);
    expect(r.missingLabels).toEqual(['Contact us']);
    expect(r.summary).toContain('features');
    expect(r.summary).toContain('"Contact us"');
    expect(r.summary).toContain('2 of 5');
  });

  it('🔒 matches a section inside a longer identifier — HeroSection IS the hero', () => {
    // Requiring an exact token would report nearly every real component as missing.
    const r = verifyDesignContract(c, app('<HeroSection/><FeaturesGrid/><div className="pricing-table"/>Get started Contact us'));
    expect(r.missingSections).toEqual([]);
  });

  it('🔒 is case- and punctuation-insensitive, as a mockup and real markup always differ', () => {
    const r = verifyDesignContract(c, app('HERO / FEATURES / PRICING — "get started!" · contact-us'));
    expect(r.verdict).toBe('DESIGN_CONTRACT_MET');
  });

  it('🔒 ignores lockfiles and node_modules, or every check would pass on coincidence', () => {
    const r = verifyDesignContract(c, {
      'package-lock.json': 'hero features pricing Get started Contact us',
      'node_modules/x/index.js': 'hero features pricing Get started Contact us',
      'src/App.tsx': '<div/>',
    });
    expect(r.verdict).toBe('DESIGN_CONTRACT_PARTIAL');
    expect(r.found).toBe(0);
  });

  it('🔒 ABSENT — not MET — when no contract was extracted', () => {
    // A model that ignored the JSON request must never read as "the design was matched".
    const r = verifyDesignContract(null, app('anything'));
    expect(r.verdict).toBe('DESIGN_CONTRACT_ABSENT');
    expect(r.summary).toContain('could not be checked');
  });

  it('an empty file set is partial, not a crash', () => {
    const r = verifyDesignContract(c, {});
    expect(r.verdict).toBe('DESIGN_CONTRACT_PARTIAL');
    expect(r.found).toBe(0);
  });

  it('🔒 never claims more found than required', () => {
    const r = verifyDesignContract(c, app('hero hero hero features pricing Get started Get started Contact us'));
    expect(r.found).toBeLessThanOrEqual(r.total);
    expect(r.total).toBe(5);
  });

  it('the summary never names a vendor or model', () => {
    for (const files of [app('<div/>'), app('hero features pricing Get started Contact us')]) {
      expect(verifyDesignContract(c, files).summary).not.toMatch(/gemini|grok|claude|gpt|glm|kimi|vision model/i);
    }
  });
});

describe('the contract never becomes a gate', () => {
  it('a verdict is only ever one of three honest states', () => {
    const states = new Set<string>();
    const c = parseDesignContract(fenced(CONTRACT_JSON));
    states.add(verifyDesignContract(c, { 'a.tsx': 'hero features pricing Get started Contact us' }).verdict);
    states.add(verifyDesignContract(c, { 'a.tsx': '' }).verdict);
    states.add(verifyDesignContract(null, {}).verdict);
    expect([...states].sort()).toEqual(['DESIGN_CONTRACT_ABSENT', 'DESIGN_CONTRACT_MET', 'DESIGN_CONTRACT_PARTIAL']);
  });

  it('🔒 verification is pure — it returns findings and cannot fail a build', () => {
    // There is no throw path and no boolean anywhere that a caller could read as "abort".
    const huge: DesignContract = { screens: [{ name: 'X', sections: ['a'], labels: ['b'] }], palette: [], viewport: 'mobile' };
    expect(() => verifyDesignContract(huge, { 'a.tsx': 'x'.repeat(200_000) })).not.toThrow();
  });
});

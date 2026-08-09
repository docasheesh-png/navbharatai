import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LEGAL_DOCS, legalDocById } from '../src/content/legal';

/**
 * ADMIN ASK 2026-08-08: five detailed legal/trust documents, each on its own page, buttons in
 * Settings. These tests lock three things:
 *   1. COMPLETENESS — each document genuinely covers the sections that give it legal meaning
 *      (a privacy policy without retention or grievance contact is decoration, not compliance);
 *   2. THE WHITE-LABEL LAW — legal pages are user-facing surfaces: no AI vendor or model name may
 *      appear in any of them (the safe-default decision of 2026-08-08: categories, not names);
 *   3. WIRING — the registry drives the Settings buttons and screens, so a document cannot exist
 *      without a button nor a button without a page.
 */

const byId = Object.fromEntries(LEGAL_DOCS.map((d) => [d.id, d.body]));

describe('the registry — five documents, stable ids, real content', () => {
  it('has exactly the five documents, each with a title, subtitle, date and a long body', () => {
    expect(LEGAL_DOCS.map((d) => d.id)).toEqual([
      'legal_privacy', 'legal_terms', 'legal_dpa', 'legal_security', 'legal_nda',
    ]);
    for (const d of LEGAL_DOCS) {
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.subtitle.length).toBeGreaterThan(10);
      expect(d.updated).toMatch(/\d{4}/);
      // "10x detail" was the ask — a document under ~4,000 characters is a summary, not a document.
      expect(d.body.length).toBeGreaterThan(4000);
    }
  });

  it('legalDocById resolves every id and rejects garbage', () => {
    for (const d of LEGAL_DOCS) expect(legalDocById(d.id)?.title).toBe(d.title);
    expect(legalDocById('nope')).toBeNull();
  });
});

describe('Privacy Policy — the sections that make it real', () => {
  const p = byId.legal_privacy;
  it('covers the DPDP Act, grievance contact, retention, transfers, children and rights', () => {
    expect(p).toMatch(/Digital Personal Data Protection Act/);
    expect(p).toMatch(/info@navbharatai\.com/);
    expect(p).toMatch(/Grievance/i);
    expect(p).toMatch(/90 days/); // log retention
    expect(p).toMatch(/Singapore/); // honest cross-border disclosure
    expect(p).toMatch(/under 18/i);
    expect(p).toMatch(/Data Protection Board of India/);
  });
  it('covers the sensitive clinical surface with the doctor-responsibility rule', () => {
    expect(p).toMatch(/clinical decision-support/i);
    expect(p).toMatch(/treating physician/);
  });
  it('makes the no-training and no-selling commitments explicitly', () => {
    expect(p).toMatch(/not used to train/i);
    expect(p).toMatch(/do not sell your personal data/i);
  });
  it('describes the anonymous learning system truthfully (as built, with its test-enforced property)', () => {
    expect(p).toMatch(/anonymous by construction/i);
    expect(p).toMatch(/no account identifier is ever attached/i);
  });
});

describe('Terms of Service — the sections that make it real', () => {
  const t = byId.legal_terms;
  it('encodes the money honesty rules the platform actually enforces', () => {
    expect(t).toMatch(/failed build is never charged|a build that was supposed to produce an app and did not succeed is not charged/i);
    expect(t).toMatch(/prepaid usage credit/i);
    expect(t).toMatch(/Refunds/);
    expect(t).toMatch(/7 days/);
  });
  it('gives users ownership of their apps, and the BYO-database reality', () => {
    expect(t).toMatch(/You own what you make/i);
    expect(t).toMatch(/your own\*\* connected services|your own accounts/i);
  });
  it('has acceptable use, store rules, liability limits, and Indian governing law', () => {
    expect(t).toMatch(/Acceptable use/i);
    expect(t).toMatch(/malware/i);
    expect(t).toMatch(/New Delhi/);
    expect(t).toMatch(/Consumer Protection Act/);
  });
  it('carries the Doctor AI boundary in force', () => {
    expect(t).toMatch(/qualified, registered medical practitioners/i);
    expect(t).toMatch(/It does not practise medicine/i);
  });
});

describe('DPA — the sections an enterprise reviewer checks first', () => {
  const d = byId.legal_dpa;
  it('names the roles, the breach clock, sub-processor rules and deletion', () => {
    expect(d).toMatch(/processor/i);
    expect(d).toMatch(/72 hours/);
    expect(d).toMatch(/Sub-processors/i);
    expect(d).toMatch(/15 days/); // change notice
    expect(d).toMatch(/30 days/); // deletion window
    expect(d).toMatch(/Standard Contractual Clauses/);
  });
  it('resolves the white-label tension the standard enterprise way: named list under NDA', () => {
    expect(d).toMatch(/named sub-processor list is available .* under NDA/i);
  });
  it('includes the Annex A security measures', () => {
    expect(d).toMatch(/Annex A/);
    expect(d).toMatch(/Encryption/);
  });
});

describe('Security Documents — claims must match the product', () => {
  const s = byId.legal_security;
  it('has all four parts: overview, policy, incident response, vulnerability disclosure', () => {
    expect(s).toMatch(/Security Overview/i);
    expect(s).toMatch(/Security Policy/i);
    expect(s).toMatch(/Incident Response/i);
    expect(s).toMatch(/Vulnerability Disclosure/i);
  });
  it('describes only controls that exist in the code (store pipeline, redaction, CI gate)', () => {
    expect(s).toMatch(/no scan ⇒ no publication/i);
    expect(s).toMatch(/dependency-security gate/i);
    expect(s).toMatch(/PAN, IFSC, Aadhaar/);
  });
  it('is HONEST about what we do not yet claim (no fake certifications — rule 2)', () => {
    expect(s).toMatch(/do \*\*not\*\* yet hold SOC 2/i);
  });
  it('gives researchers a real channel and real response clocks', () => {
    expect(s).toMatch(/subject "\*\*SECURITY\*\*"/i);
    expect(s).toMatch(/72 hours/);
  });
});

describe('NDA — a usable mutual template', () => {
  const n = byId.legal_nda;
  it('is mutual, with the standard exceptions, survival, return-or-destroy and injunctive relief', () => {
    expect(n).toMatch(/Mutual Non-Disclosure/i);
    expect(n).toMatch(/independently developed/i);
    expect(n).toMatch(/survive/i);
    expect(n).toMatch(/return or securely destroy/i);
    expect(n).toMatch(/injunctive/i);
  });
  it('is honestly a TEMPLATE — blanks are declared as intentional, nothing pretends to be executed', () => {
    expect(n).toMatch(/blanks \(____\) are intentional/i);
    expect(n).toMatch(/nothing is agreed until a filled copy is signed/i);
  });
});

describe('THE WHITE-LABEL LAW — no AI vendor or model name on any legal page', () => {
  const FORBIDDEN = /\b(anthropic|claude|openai|gpt-?[0-9]|gemini|vertex ai|glm|z\.ai|kimi|moonshot|grok|xai|bedrock|deepseek|sonnet|opus|haiku)\b/i;
  for (const d of LEGAL_DOCS) {
    it(`${d.id} names no AI vendor`, () => {
      expect(d.body).not.toMatch(FORBIDDEN);
    });
  }
  it('but the honest, allowed names remain (payment/identity providers users already see)', () => {
    expect(byId.legal_privacy).toMatch(/Cashfree/);
    expect(byId.legal_privacy).toMatch(/Google \/ Apple|Google\/Apple/);
  });
});

describe('every document carries the lawyer-review honesty note in its source', () => {
  for (const f of ['privacyPolicy', 'termsOfService', 'dpa', 'securityDocs', 'nda']) {
    it(`${f}.ts declares NOT LEGAL ADVICE`, () => {
      expect(readFileSync(join(process.cwd(), `src/content/legal/${f}.ts`), 'utf8')).toMatch(/NOT LEGAL ADVICE/);
    });
  }
});

describe('wiring — registry drives Settings; a doc cannot exist without a button', () => {
  const settings = readFileSync(join(process.cwd(), 'src/components/panels/SettingsPanel.tsx'), 'utf8');
  const types = readFileSync(join(process.cwd(), 'src/types/index.ts'), 'utf8');
  const kb = readFileSync(join(process.cwd(), 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('the Legal & Trust group builds its tiles FROM the registry metadata (no hand-typed second list)', () => {
    expect(settings).toContain("title: 'Legal & Trust'");
    expect(settings).toContain('LEGAL_META.map');
  });

  it('BUNDLE DISCIPLINE: the heavy bodies never enter the main chunk', () => {
    // SettingsPanel may import only the meta module; the full registry (with ~45 KB of bodies) is
    // dynamic-imported by LegalDocPage. A static import here re-breaks the CI bundle budget.
    expect(settings).toContain("from '../../content/legal/meta'");
    expect(settings).not.toMatch(/from '\.\.\/\.\.\/content\/legal';/);
    const page = readFileSync(join(process.cwd(), 'src/components/panels/LegalDocPage.tsx'), 'utf8');
    expect(page).toContain("import('../../content/legal')");
    expect(page).not.toMatch(/^import \{[^}]*legalDocById[^}]*\} from/m);
  });

  it('meta and the full registry can never drift (same ids, titles, dates)', async () => {
    const { LEGAL_META } = await import('../src/content/legal/meta');
    expect(LEGAL_META.map((m) => m.id)).toEqual(LEGAL_DOCS.map((d) => d.id));
    for (let i = 0; i < LEGAL_META.length; i++) {
      expect(LEGAL_META[i].title).toBe(LEGAL_DOCS[i].title);
      expect(LEGAL_META[i].subtitle).toBe(LEGAL_DOCS[i].subtitle);
      expect(LEGAL_META[i].updated).toBe(LEGAL_DOCS[i].updated);
    }
  });

  it('every legal_* id renders the LegalDocPage screen', () => {
    expect(settings).toContain("settingsScreen.startsWith('legal_')");
    expect(settings).toContain('<LegalDocPage docId={settingsScreen} />');
  });

  it('the SettingsScreen type carries all five ids', () => {
    for (const d of LEGAL_DOCS) expect(types).toContain(`'${d.id}'`);
  });

  it('AppKnowledgeBase knows the feature (every AI can answer "privacy policy kahan hai?")', () => {
    expect(kb).toContain("id: 'legal_trust'");
    expect(kb).toContain('gopniyata');
  });
});

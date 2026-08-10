// NavBharatAI — the legal & trust document registry (admin 2026-08-08: "sabhi ke liye ek alag page
// banao, setting me sabhi ke button dedo"). ONE registry drives the screens and the tests.
//
// BUNDLE DISCIPLINE (2026-08-08): this module carries the ~45 KB of document BODIES, so nothing in
// the main chunk may import it statically — SettingsPanel uses ./meta (titles only) and LegalDocPage
// dynamic-imports this module, which makes the documents their own lazy chunk. The CI bundle budget
// caught exactly this: a static import pushed the main chunk to 653.5 KB against a 650 KB budget.

import { LEGAL_META, type LegalMeta } from './meta';
import { PRIVACY_POLICY } from './privacyPolicy';
import { TERMS_OF_SERVICE } from './termsOfService';
import { DPA } from './dpa';
import { SECURITY_DOCS } from './securityDocs';
import { NDA } from './nda';

export interface LegalDoc extends LegalMeta {
  body: string;
}

const BODIES: Record<LegalMeta['id'], string> = {
  legal_privacy: PRIVACY_POLICY,
  legal_terms: TERMS_OF_SERVICE,
  legal_dpa: DPA,
  legal_security: SECURITY_DOCS,
  legal_nda: NDA,
};

export const LEGAL_DOCS: LegalDoc[] = LEGAL_META.map((m) => ({ ...m, body: BODIES[m.id] }));

export function legalDocById(id: string): LegalDoc | null {
  return LEGAL_DOCS.find((d) => d.id === id) ?? null;
}

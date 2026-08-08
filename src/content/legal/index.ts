// NavBharatAI — the legal & trust document registry (admin 2026-08-08: "sabhi ke liye ek alag page
// banao, setting me sabhi ke button dedo"). ONE registry drives the Settings buttons, the screen
// routing and the tests, so a document cannot exist without a button nor a button without a page.

import { PRIVACY_POLICY, PRIVACY_POLICY_TITLE, PRIVACY_POLICY_UPDATED } from './privacyPolicy';
import { TERMS_OF_SERVICE, TERMS_OF_SERVICE_TITLE, TERMS_OF_SERVICE_UPDATED } from './termsOfService';
import { DPA, DPA_TITLE, DPA_UPDATED } from './dpa';
import { SECURITY_DOCS, SECURITY_DOCS_TITLE, SECURITY_DOCS_UPDATED } from './securityDocs';
import { NDA, NDA_TITLE, NDA_UPDATED } from './nda';

export interface LegalDoc {
  /** Also the SettingsScreen id, prefixed `legal_`. */
  id: 'legal_privacy' | 'legal_terms' | 'legal_dpa' | 'legal_security' | 'legal_nda';
  title: string;
  /** One line under the button so a non-lawyer knows which document they need. */
  subtitle: string;
  updated: string;
  body: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: 'legal_privacy',
    title: PRIVACY_POLICY_TITLE,
    subtitle: 'What data we collect, why, where it lives, and your rights (DPDP Act)',
    updated: PRIVACY_POLICY_UPDATED,
    body: PRIVACY_POLICY,
  },
  {
    id: 'legal_terms',
    title: TERMS_OF_SERVICE_TITLE,
    subtitle: 'The rules of using NavBharatAI — tokens, refunds, your app ownership',
    updated: TERMS_OF_SERVICE_UPDATED,
    body: TERMS_OF_SERVICE,
  },
  {
    id: 'legal_dpa',
    title: DPA_TITLE,
    subtitle: 'For business customers — how we process your data as your processor',
    updated: DPA_UPDATED,
    body: DPA,
  },
  {
    id: 'legal_security',
    title: SECURITY_DOCS_TITLE,
    subtitle: 'Encryption, access control, incident response, and how to report a vulnerability',
    updated: SECURITY_DOCS_UPDATED,
    body: SECURITY_DOCS,
  },
  {
    id: 'legal_nda',
    title: NDA_TITLE,
    subtitle: 'Our standard mutual NDA template for partners, investors and contractors',
    updated: NDA_UPDATED,
    body: NDA,
  },
];

export function legalDocById(id: string): LegalDoc | null {
  return LEGAL_DOCS.find((d) => d.id === id) ?? null;
}

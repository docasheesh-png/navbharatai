// Legal registry METADATA only — deliberately free of the document bodies.
//
// WHY THIS FILE EXISTS (bundle budget, 2026-08-08): the five documents are ~45 KB of text. Imported
// statically by SettingsPanel they landed in the app's MAIN chunk and pushed it over the CI bundle
// budget (653.5 KB > 650 KB) — making every user download five legal documents to open a chat.
// The Settings tiles only need titles; the bodies load on demand (LegalDocPage dynamic-imports the
// full registry, which becomes its own lazy chunk). tests/legalDocs.test.ts locks meta ↔ registry
// consistency AND that SettingsPanel never statically imports the heavy index again.

export interface LegalMeta {
  id: 'legal_privacy' | 'legal_terms' | 'legal_dpa' | 'legal_security' | 'legal_nda';
  title: string;
  subtitle: string;
  updated: string;
}

export const LEGAL_META: LegalMeta[] = [
  {
    id: 'legal_privacy',
    title: 'Privacy Policy',
    subtitle: 'What data we collect, why, where it lives, and your rights (DPDP Act)',
    updated: '8 August 2026',
  },
  {
    id: 'legal_terms',
    title: 'Terms of Service',
    subtitle: 'The rules of using NavBharatAI — tokens, refunds, your app ownership',
    updated: '8 August 2026',
  },
  {
    id: 'legal_dpa',
    title: 'Data Processing Agreement (DPA)',
    subtitle: 'For business customers — how we process your data as your processor',
    updated: '8 August 2026',
  },
  {
    id: 'legal_security',
    title: 'Security at NavBharatAI',
    subtitle: 'Encryption, access control, incident response, and how to report a vulnerability',
    updated: '8 August 2026',
  },
  {
    id: 'legal_nda',
    title: 'Non-Disclosure Agreement (NDA)',
    subtitle: 'Our standard mutual NDA template for partners, investors and contractors',
    updated: '8 August 2026',
  },
];

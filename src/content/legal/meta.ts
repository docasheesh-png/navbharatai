// Legal registry METADATA only — deliberately free of the document bodies.
//
// WHY THIS FILE EXISTS (bundle budget, 2026-08-08): the five documents are ~45 KB of text. Imported
// statically by SettingsPanel they landed in the app's MAIN chunk and pushed it over the CI bundle
// budget (653.5 KB > 650 KB) — making every user download five legal documents to open a chat.
// The Settings tiles only need titles; the bodies load on demand (LegalDocPage dynamic-imports the
// full registry, which becomes its own lazy chunk). tests/legalDocs.test.ts locks meta ↔ registry
// consistency AND that SettingsPanel never statically imports the heavy index again.

export interface LegalMeta {
  id: 'legal_privacy' | 'legal_terms' | 'legal_refund' | 'legal_grievance' | 'legal_dpa' | 'legal_security';
  title: string;
  subtitle: string;
  updated: string;
  /**
   * Does this document get its OWN tile in Settings → Legal & Trust?
   *
   * 🔴 THE TILES AND THE DOCUMENTS ARE NO LONGER THE SAME LIST (admin 2026-09-14: "waki ke Grievance
   * Redressal, dpa, Security/Trust page ko Privacy Policy, Terms me ghusa do"). Six tiles made a wall
   * of legal buttons on a phone, most of which a normal user has no reason to open.
   *
   * ⚠️ HIDDEN IS NOT REMOVED, AND THE DIFFERENCE IS THE WHOLE POINT. Every document below still
   * exists, still has a PUBLIC URL, and is still linked from inside the Privacy Policy and the Terms
   * — which is where somebody actually looking for it is already reading. Grievance Redressal in
   * particular is a legal obligation under the IT Rules, 2021: the Privacy Policy links to it three
   * times and the Terms once, and deleting the page would have left four broken links inside our own
   * published legal documents, which is worse than never having had it.
   */
  settingsTile: boolean;
}

export const LEGAL_META: LegalMeta[] = [
  {
    id: 'legal_privacy',
    title: 'Privacy Policy',
    subtitle: 'What data we collect, why, where it lives, and your rights (DPDP Act)',
    updated: '2 September 2026',
    settingsTile: true,
  },
  {
    id: 'legal_terms',
    title: 'Terms of Service',
    subtitle: 'The rules of using NavBharatAI — tokens, refunds, your app ownership',
    updated: '8 August 2026',
    settingsTile: true,
  },
  {
    /**
     * No tile, for the same reason as the three below it — and one more that is specific to this
     * document: a refund policy is read by somebody who has ALREADY decided to ask for their money
     * back, and they find it from the Terms, from Billing, or from a search engine, never by
     * browsing a Settings grid. What it must have is a PUBLIC, separately-addressable URL
     * (/refund), because that is what a payment aggregator's onboarding asks for and what a
     * reviewer checks. It is linked from Terms Section 4, which is the tested requirement for
     * every untiled document.
     */
    id: 'legal_refund',
    title: 'Refund & Cancellation Policy',
    subtitle: 'When you can cancel, what comes back, and how long the money takes',
    updated: '20 September 2026',
    settingsTile: false,
  },
  {
    // No tile, and reachable in MORE places than before: /grievance is a public URL (the address a
    // regulator or a Play reviewer is given), the Privacy Policy links to it three times and the
    // Terms once. A complaint route belongs next to the rule somebody is complaining about.
    id: 'legal_grievance',
    title: 'Grievance Redressal',
    subtitle: 'Who to complain to, and how fast we must answer (IT Rules, 2021)',
    updated: '12 September 2026',
    settingsTile: false,
  },
  {
    id: 'legal_dpa',
    title: 'Data Processing Agreement (DPA)',
    subtitle: 'For business customers — how we process your data as your processor',
    updated: '8 August 2026',
    // For BUSINESS customers, who need a URL to send their lawyer — not a button an ordinary user
    // scrolls past. Now at /dpa, linked from the Privacy Policy's AI-processing section.
    settingsTile: false,
  },
  {
    id: 'legal_security',
    title: 'Security at NavBharatAI',
    subtitle: 'Encryption, access control, incident response, and how to report a vulnerability',
    updated: '8 August 2026',
    // Same reasoning as the DPA: now at /security, linked from the Privacy Policy's Security section,
    // which is exactly where a reader who wants the detail already is.
    settingsTile: false,
  },
];

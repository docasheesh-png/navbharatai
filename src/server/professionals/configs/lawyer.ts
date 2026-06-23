import type { ProfessionalConfig } from '../types';

export const LAWYER_AI: ProfessionalConfig = {
  id: 'lawyer_ai',
  name: 'Lawyer / Legal Assistant',
  systemPrompt: `You are Legal AI inside NavBharatAI — a legal-information assistant for Indian law, for ordinary people, students and businesses. You provide general legal INFORMATION and help understand and draft documents; you are NOT an advocate and you do NOT give binding legal advice.

WHAT YOU HELP WITH (detect the need):
- EXPLAIN a legal concept, right, or process in plain language (consumer rights, tenancy, employment, contracts, cheque bounce, FIR, RTI, etc.).
- UNDERSTAND a document/notice/contract clause — what it means and the usual options to respond.
- DRAFT templates (legal notice, rent/lease agreement, complaint, RTI application, affidavit, simple contract) clearly marked as a DRAFT to be reviewed by an advocate before use.
- PROCESS guidance — how to file an FIR, a consumer complaint, an RTI, approach which forum/court, typical timelines and documents.

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is general legal information, NOT legal advice and NOT a lawyer-client relationship. For any real dispute, deadline, or money/liberty at stake, advise consulting a qualified advocate.
- Indian laws CHANGE and VARY by state and forum. (E.g., the criminal codes were recently overhauled — IPC→Bharatiya Nyaya Sanhita, CrPC→BNSS, Evidence Act→BSA.) NEVER cite a specific section number or case as definitive — describe the concept and tell the user to verify the current statute/section and jurisdiction with an advocate or official source.
- NEVER fabricate sections, case law, judgments, or citations. If unsure, say so.
- Do not help with anything illegal; explain lawful options only.

INDIA CONTEXT: aware of Indian civil/criminal/consumer/labour/property/family law structure, courts/tribunals (District/HC/SC, consumer commissions), RTI, FIR. Reply in the user's language (Hindi/regional) if they use it.`,
  disclaimer: 'Legal AI gives general legal INFORMATION, not legal advice, and does not create a lawyer-client relationship. Indian laws change and vary by state/forum — always verify the current statute and consult a qualified advocate before acting. Drafts must be reviewed by a lawyer.',
  knowledge: [
    {
      id: 'contracts',
      topic: 'Contracts — essentials',
      keywords: ['contract', 'agreement', 'clause', 'terms', 'breach', 'sign'],
      content: 'A valid contract needs offer, acceptance, lawful consideration, free consent, capacity, and a lawful object. Read key clauses: parties, scope, payment, term & termination, liability/indemnity, dispute resolution & jurisdiction, and signatures/witnesses. Get important contracts vetted by an advocate before signing.',
      source: 'Contract law (concept) — verify with an advocate',
    },
    {
      id: 'legal_notice',
      topic: 'Legal notice — structure',
      keywords: ['legal notice', 'notice', 'demand', 'send notice'],
      content: 'A legal notice typically states: sender & recipient details; facts/background; the legal grievance; the specific demand; a time period to comply; and the consequence of non-compliance. It is usually sent by registered post/email through an advocate. Treat any AI draft as a starting point to be vetted by a lawyer.',
      source: 'Standard practice (concept)',
    },
    {
      id: 'rti',
      topic: 'RTI application',
      keywords: ['rti', 'right to information', 'information', 'pio'],
      content: 'Under the RTI Act, a citizen can seek information from a public authority by applying to its Public Information Officer (PIO) with the prescribed fee; the PIO must respond within the statutory time. If denied or delayed, there is a first appeal and then the Information Commission. Verify current fees/forms for the relevant authority.',
      source: 'RTI Act (concept) — verify current rules',
    },
    {
      id: 'consumer',
      topic: 'Consumer complaint',
      keywords: ['consumer', 'complaint', 'refund', 'defective', 'service', 'consumer court'],
      content: 'For deficient goods/services, a consumer can complain to the appropriate Consumer Commission (District/State/National, by value). First send a written complaint/legal notice to the seller; keep bills and evidence. Verify the current pecuniary limits and procedure on the consumer-helpline/commission portal.',
      source: 'Consumer Protection (concept) — verify current limits',
    },
    {
      id: 'fir',
      topic: 'FIR / police complaint',
      keywords: ['fir', 'police complaint', 'cognizable', 'crime', 'report crime'],
      content: 'For a cognizable offence, the police must register an FIR; you are entitled to a free copy. For non-cognizable matters a complaint is recorded differently. If police refuse, you can approach a senior officer or the Magistrate. Note: criminal statutes were recently revised (BNS/BNSS/BSA) — verify current provisions and consult an advocate.',
      source: 'Criminal procedure (concept) — verify current statute',
    },
  ],
};

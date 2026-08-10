// NavBharatAI — Data Processing Agreement (template for business customers). Sub-processors are
// described by CATEGORY (white-label law — the safe default chosen 2026-08-08; the admin can widen
// disclosure after legal review; a named list can be provided under NDA on request, which is the
// standard enterprise compromise). ⚠️ NOT LEGAL ADVICE — for lawyer review before signature.

export const DPA_TITLE = 'Data Processing Agreement (DPA)';
export const DPA_UPDATED = '8 August 2026';

export const DPA = `# Data Processing Agreement

**Version: ${DPA_UPDATED}**

This Data Processing Agreement ("**DPA**") applies when an organisation (the "**Customer**") uses NavBharatAI (the "**Platform**") in a way that involves NavBharatAI processing personal data on the Customer's behalf — for example, when the Customer's team builds and operates applications through the Platform, or shares end-user data with the Platform for support. It supplements the Terms of Service.

**How to execute it:** business customers can request a countersigned copy by emailing **info@navbharatai.com** with the subject "DPA request". Until countersigned, this published version describes our standing commitments.

**Plain-language summary:** for the Customer's data, NavBharatAI acts on the Customer's instructions only; protects the data with the security measures on our Security page; uses vetted sub-processors bound to the same duties; tells the Customer about a breach without undue delay (target: within 72 hours of confirmation); helps the Customer answer their own users' data requests; and deletes or returns the data when the engagement ends.

---

## 1. Definitions

- "**Data Protection Law**" — every law applicable to the processing under this DPA, including India's Digital Personal Data Protection Act, 2023 ("DPDP Act") and, where applicable to the Customer, the EU/UK GDPR.
- "**Customer Personal Data**" — personal data that NavBharatAI processes on behalf of the Customer under the Terms.
- "**Controller / Data Fiduciary**" — the party deciding purposes and means: the **Customer**.
- "**Processor / Data Processor**" — the party processing on instructions: **NavBharatAI**.
- "**Sub-processor**" — a third party NavBharatAI engages to help process Customer Personal Data.
- Terms like "processing", "data principal/data subject", and "personal data breach" carry the meaning given by Data Protection Law.

**Role clarity:** for Customer Personal Data, the Customer is the controller and NavBharatAI the processor. For NavBharatAI's own account data (the Customer's users' logins, wallet, support history), NavBharatAI is an independent controller under its Privacy Policy. For apps the Customer builds and runs on the Customer's **own** connected infrastructure (the Platform's deliberate bring-your-own-database design), the data in that infrastructure is processed by the Customer's providers under the Customer's contracts — not by NavBharatAI.

## 2. Scope and details of processing

- **Subject matter:** provision of the Platform (AI chat, app building, storage, preview, deployment, publishing).
- **Duration:** the term of the Customer's use of the Platform, plus the deletion window in Section 9.
- **Nature and purpose:** hosting and storage; AI-assisted generation and editing; build, preview and deployment; support.
- **Categories of data:** account identifiers (name, email, phone), content the Customer's users submit (prompts, files, project code), usage and billing records, technical logs. **Special/sensitive categories** only if the Customer chooses to submit them, and then only under Section 5 of the Privacy Policy's stricter handling.
- **Data principals:** the Customer's personnel and, where the Customer submits it, the Customer's own end users.

## 3. NavBharatAI's duties as processor

NavBharatAI shall:

1. **Follow instructions.** Process Customer Personal Data only on the Customer's documented instructions (the Terms, this DPA, and the Customer's in-product actions are instructions), unless law requires otherwise — in which case NavBharatAI informs the Customer before processing, where legally permitted.
2. **Confidentiality.** Ensure every person authorised to process the data is bound by confidentiality obligations.
3. **Security.** Implement and maintain the technical and organisational measures described in **Annex A** (and the Security page), reviewing them as threats evolve. Measures may improve over time but will not materially degrade.
4. **No selling, no training.** Never sell Customer Personal Data, never use it for advertising, and never use it to train AI models (its own or any third party's).
5. **Assistance.** Taking into account the nature of the processing, assist the Customer with reasonable technical and organisational measures to (a) answer data principals' requests (access, correction, deletion), and (b) meet the Customer's own security, breach-notification and assessment duties.
6. **Records.** Maintain records of processing activities and make available the information reasonably necessary to demonstrate compliance with this DPA.

## 4. Personal data breach

- NavBharatAI will notify the Customer **without undue delay, and in any case within 72 hours of confirming** a personal data breach affecting Customer Personal Data.
- The notice will describe, to the extent known: the nature of the breach, the categories and approximate volume of data and data principals affected, the likely consequences, the measures taken or proposed, and a contact point.
- NavBharatAI will cooperate with the Customer's own regulatory notifications and will not characterise the Customer's obligations in public statements without the Customer's agreement.

## 5. Sub-processors

- The Customer gives **general authorisation** for NavBharatAI to use sub-processors in these categories: **cloud infrastructure and storage providers; AI infrastructure providers (inference only, no training rights); payment processing (Cashfree Payments); identity/sign-in providers (Google, Apple); code-hosting integration (GitHub, only where the Customer connects it); anti-malware scanning for store uploads; and email/notification delivery.**
- Every sub-processor is bound by a written contract imposing data-protection duties no less protective than this DPA, and NavBharatAI remains fully liable to the Customer for its sub-processors' performance.
- **A current, named sub-processor list is available to the Customer on request under NDA** (info@navbharatai.com) — this balances transparency with the confidentiality of our supply chain.
- **Changes:** NavBharatAI will give at least **15 days' notice** (in-app or by email) before adding or replacing a sub-processor that processes Customer Personal Data. The Customer may object on reasonable data-protection grounds; if the objection cannot be resolved, the Customer may terminate the affected service and receive a pro-rata refund of unused prepaid amounts.

## 6. International transfers

Customer Personal Data is stored and processed primarily in **Asia (Singapore)**, with some sub-processing in other regions. NavBharatAI will ensure every cross-border transfer is protected by safeguards recognised under applicable Data Protection Law (for GDPR-scope customers, the EU Standard Contractual Clauses (2021/914, Module 2) are incorporated by reference into an executed DPA, with the UK Addendum where relevant; under the DPDP Act, transfers avoid any jurisdiction restricted by the Government of India).

## 7. Audits

- On written request (not more than once per 12 months, absent a breach or regulator requirement), NavBharatAI will make available documentation demonstrating compliance: this DPA, the Annex A measures, summaries of independent assessments and penetration-test results when available.
- Where that documentation is genuinely insufficient, the Customer may conduct (directly or through an independent auditor bound to confidentiality) an audit limited in scope, at reasonable notice, during business hours, at the Customer's cost, and without access to other customers' data.

## 8. Data principals' requests

If a data principal contacts NavBharatAI directly about Customer Personal Data, NavBharatAI will (where lawful) redirect them to the Customer and will not respond substantively except on the Customer's instruction or where law requires.

## 9. Return and deletion

- During the term, the Customer can export projects and content through the Platform's own export features at any time.
- On termination of the engagement, NavBharatAI will, at the Customer's choice, return (export) and/or delete Customer Personal Data within **30 days**, and delete residual copies from backups in the ordinary backup rotation — except records law requires us to keep (e.g. tax), which remain protected under this DPA until deleted.
- On request, NavBharatAI will confirm deletion in writing.

## 10. Liability and order of precedence

- Liability under this DPA is subject to the limitations in the Terms of Service, except where Data Protection Law does not permit such limits.
- If this DPA conflicts with the Terms, **this DPA controls** for data-protection matters. If an executed copy conflicts with this published version, the executed copy controls.

---

## Annex A — Technical and organisational measures (summary)

1. **Encryption:** TLS for all data in transit; encryption at rest for databases and file storage; customer-stored secrets encrypted with a dedicated key.
2. **Access control:** production access restricted to a small, named set of personnel; role-based; logged. Admin-only diagnostics are gated server-side and fail closed.
3. **Redaction by construction:** automated masking of secret shapes (API keys, tokens, private keys) and personal identifiers (emails, phone numbers, PAN/Aadhaar patterns) in logs, on-screen tool output, and the anonymised learning system.
4. **Isolation:** build sandboxes are per-workspace and automatically recycled after inactivity; clinical cases are isolated per case-session.
5. **Integrity of the store:** signed-package verification + malware scanning + human review before any Nav App Store listing; failed scans block publication.
6. **Resilience:** durable, versioned storage of customer projects; automated reconciliation of interrupted payments; documented incident-response runbook (see the Security page).
7. **Personnel:** confidentiality undertakings; least-privilege by default; access revoked promptly on role change or exit.
8. **Vulnerability management:** dependency-security gates in CI that block known-vulnerable components; a public vulnerability-disclosure channel; timely patching.

---

*Template version ${DPA_UPDATED}. To execute this DPA or request the named sub-processor list under NDA: info@navbharatai.com.*`;

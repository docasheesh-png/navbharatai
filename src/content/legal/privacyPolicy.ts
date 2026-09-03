// NavBharatAI — Privacy Policy (admin 2026-08-08: "sabhi 5 cheeze details me").
//
// Grounded in the app's REAL data flows (verified against the code, not a generic template):
// Firebase auth, chats/prompts, built app files + build history, wallet/token ledger, document
// uploads incl. clinical documents in Doctor AI (web), Cashfree payments, optional GitHub connection,
// the Nav App Store, and the secrets vault. WHITE-LABEL LAW: AI providers are described as
// CATEGORIES, never named — the admin's standing rule applies to legal pages too (the safe default
// chosen 2026-08-08; the admin can widen disclosure after legal review).
//
// ⚠️ UPDATED 2026-09-02 — ADVERTISING MEASUREMENT. NavBharatAI now advertises ITSELF on Meta
// (Facebook/Instagram) and measures whether those ads work: a Meta pixel on the website and, in
// builds that enable it, Meta's app-events SDK in the Android app. Three statements in the previous
// version became FALSE the moment that shipped ("we do not show third-party advertising", "We never
// share your data with advertisers or data brokers", "We do not use third-party advertising
// cookies"), so they are corrected here and Section 3.1 states exactly what is shared. Caught before
// either was switched on in production — nothing was ever collected under the old wording.
//
// The one thing that did NOT change: chat content, uploaded files and clinical data are still never
// sent to an ad platform. Section 3.1 says so because the code enforces it — the pixel forwards a
// hard-coded ALLOWLIST of four conversion events (src/lib/metaPixel.ts) and nothing else, which is a
// promise a reader can hold us to rather than a claim of good intentions.
//
// ⚠️ 2026-09-02 — REMOVED a claim that could go stale silently: the Hosting bullet used to end
// "…and Singapore is not a jurisdiction restricted by the Indian government for such transfers as of
// the date above." That is a legal CONCLUSION about a government list which can change without us
// noticing, and a policy that asserts it would become false the day it did — with nothing to flag it.
// Replaced with a statement of what we actually control ("we transfer it only where permitted by
// applicable law"). Do not restore the specific version: naming a jurisdiction as unrestricted is a
// claim we cannot keep true by writing code.
//
// ⚠️ NOT LEGAL ADVICE: drafted to be reviewed by a lawyer before being relied on in a dispute.

export const PRIVACY_POLICY_TITLE = 'Privacy Policy';
export const PRIVACY_POLICY_UPDATED = '2 September 2026';

export const PRIVACY_POLICY = `# Privacy Policy

**Last updated: ${PRIVACY_POLICY_UPDATED}**

This Privacy Policy explains how **NavBharatAI** ("NavBharatAI", "we", "us", "our") collects, uses, stores, shares and protects your information when you use the NavBharatAI website (navbharatai.com), the NavBharatAI mobile applications, and every product surface inside them — including NavBharatAI Free chat, NavBharatAI Pro v5.0 (the AI app builder), the Professionals assistants, the Nav App Store, and the developer tools (together, the "Platform").

We have written this policy to be read by real people, not only by lawyers. Where a section has legal weight, we have still tried to say it plainly.

By creating an account or using the Platform, you agree to the practices described here. If you do not agree, please do not use the Platform.

---

## 1. Who we are, and how to reach us

NavBharatAI is an India-first AI platform. For every question, request or complaint about your data, contact:

**Email:** info@navbharatai.com
**Subject line suggestion:** "Privacy request — [your account email]"

This mailbox also serves as our **Grievance contact** for the purposes of Indian law, including the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023 ("**DPDP Act**"). We aim to acknowledge privacy requests within **72 hours** and resolve them within **30 days**.

---

## 2. What we collect, and where it comes from

### 2.1 Information you give us directly

- **Account information.** When you sign in with Google, Apple, or a mobile number (OTP), we receive your name, email address and/or phone number, and a profile picture if your sign-in provider supplies one. We do not see or store your Google or Apple password. Phone-number login is verified by a one-time password; we store the number, never the OTP.
- **Chats and prompts.** The messages you type or dictate into any NavBharatAI chat (Free chat, Pro v5.0 build requests, Professionals assistants), including follow-up instructions, feedback and corrections.
- **Files you upload.** Documents, images, spreadsheets, PDFs and archives you attach — for example a .zip of an app you import into Pro v5.0, a logo you add to a build, or a document you ask an assistant to analyse.
- **Health-related documents and descriptions (web only).** The Doctor AI / Senior Doctor Assistant surface (available on the website, intended for qualified medical professionals) accepts clinical descriptions and documents such as lab reports. This is **sensitive information** and is treated under the stricter rules in Section 5.
- **Payment identifiers.** When you buy tokens or a plan, the payment itself is processed by our payment provider (Section 7). We store the order identifiers, the amount, and the outcome — **we never see or store your full card number, UPI PIN or banking password**.
- **Things you publish.** If you publish an app to the Nav App Store, the app package, its listing (name, description, icon) and your developer name become part of the store listing you asked us to create.
- **Support communication.** Emails you send to our support address.

### 2.2 Information created while you use the Platform

- **Your built apps.** The source files, assets and configuration of every app you build or import — stored durably so your project survives between sessions and devices.
- **Build history and reports.** What a build did, which steps ran, what failed and was repaired, timing, and honest success/failure verdicts. These records exist so builds can resume, so you can see what happened, and so we can fix real defects.
- **Wallet and usage records.** Your token balance, the ledger of purchases and deductions, and per-build/per-action usage — kept accurately because they are money.
- **Preferences.** Theme, text size, language, and similar settings.
- **Secrets you store on purpose.** API keys and credentials you save in Settings → Secrets & API Keys so your built apps can use them. These are stored **encrypted**, are injected only into **your own** apps, and are never used for any other purpose.
- **Learning signals.** The Platform learns from real build errors so mistakes are not repeated. Cross-user learning is **anonymous by construction**: it is keyed by machine "error signatures" with numbers, file paths and quoted text stripped, the stored text passes an automatic secret-and-personal-data redaction step, and **no account identifier is ever attached** (this design is enforced by automated tests).
- **Technical logs.** IP address, device/browser type, timestamps, pages visited, errors encountered. We use privacy-friendly analytics; the consent banner in the app describes and controls measurement.

### 2.3 Information from third parties

- Your sign-in provider (Google/Apple) shares the basic profile described above.
- If you **choose** to connect GitHub, we receive the repository access you grant, so we can import or save your code where you asked.
- Our payment provider tells us whether a payment succeeded, failed or was refunded.

We do not buy data about you from data brokers.

---

## 3. What we use it for

- **Providing the service** — answering your chats, building and previewing your apps, storing your projects, keeping your wallet accurate. *(Basis: performance of the service you signed up for.)*
- **AI processing** — sending your prompt and relevant project context to AI infrastructure so a reply or a build can be produced. *(Basis: performance of the service.)*
- **Payments** — creating orders, crediting tokens, settling incomplete orders on your next sign-in so paid money is never lost. *(Basis: performance of the service; legal obligations.)*
- **Safety and integrity** — malware-scanning Nav App Store uploads, rate-limiting abuse, blocking fraud. *(Basis: legitimate interest in a safe platform.)*
- **Improving the Platform** — fixing defects found in honest build reports; anonymous cross-user mistake learning. *(Basis: legitimate interest; anonymised data.)*
- **Communication** — service messages (build finished, payment received, plan expiring), support replies. *(Basis: performance of the service.)*
- **Legal compliance** — tax records, responding to lawful orders. *(Basis: legal obligation.)*

**What we do NOT do:** we do not sell your personal data; we do not show third-party advertising **inside** NavBharatAI (we do advertise NavBharatAI itself on other platforms and measure whether those ads work — Section 3.1 sets out exactly what that shares); we do not use the private content of your chats, your uploaded documents or your built apps to train any AI model of our own or of any third party; and we do not read your projects out of curiosity — access by our team is restricted to what is needed to run the service, fix a defect you reported, or meet a legal duty.

### 3.1 Advertising measurement (Meta / Facebook and Instagram)

We advertise NavBharatAI on Facebook and Instagram so people can find it. To know which of those ads actually bring people — rather than guessing and wasting money — we share a **small, fixed set of events** with Meta.

**On the website**, if and only if you accept the consent banner, a Meta pixel loads and reports:

- that a page was viewed;
- that an account was created;
- that a purchase completed, with the **real amount in rupees**;
- that an app was built.

**In our Android app**, builds that enable Meta's measurement SDK report that the app was **installed** or **opened**, together with your device's **advertising ID** — the resettable identifier Android provides for exactly this purpose.

**What is NEVER shared with Meta or any advertising platform:**

- the content of your chats or prompts;
- files or documents you upload;
- anything from the Doctor AI / clinical surface;
- your built apps, their code, or their data;
- your name, email address or phone number.

This is enforced in our code, not just promised: the pixel can only send the four events listed above, because that list is written into the software as a fixed allowlist.

**Your control.** On the web, choose **Decline** on the consent banner and no advertising measurement runs at all — nothing loads, nothing is sent. In the Android app, your phone's *Settings → Privacy → Ads* lets you reset or delete your advertising ID.

*(Basis: your consent, which you can withdraw at any time.)*

---

## 4. AI processing — an honest explanation

NavBharatAI's intelligence is delivered by **NavBharatAI's engine**, which runs on enterprise AI infrastructure. What you should know:

- Your prompts, relevant project files and conversation context are processed by AI infrastructure providers acting as our processors, **only to generate the reply or build you asked for**.
- We contractually require that this data is **not used to train** those providers' models.
- AI output can be wrong. Verify important results — and see the specific medical disclaimer in Section 5.
- Provider-level processing details are available to business customers under our Data Processing Agreement (see the DPA page), including a sub-processor description by category.

---

## 5. Sensitive data: the Doctor AI / clinical surface (web)

The Senior Doctor Assistant is a **clinical decision-support tool intended for qualified doctors**. All diagnoses and treatment decisions remain the sole responsibility of the treating physician. It is not available in our Android app.

If you use it, you may enter health-related information or upload clinical documents. For this data specifically:

- It is used **only** to produce the assistance you asked for in that case, and to keep your own case history available to you.
- Cases are isolated per case-session, so a new patient's case never inherits a previous patient's context.
- It is never used for advertising, profiling, or model training.
- **If you are a doctor entering information about a patient, you are responsible for having the patient's consent** and for entering only what is needed. Prefer de-identified details wherever possible.
- You can delete a case, and account deletion removes your case history (Section 9).

---

## 6. Where your data lives, and for how long

- **Hosting.** The Platform runs on enterprise-grade cloud infrastructure. Our primary serving and storage region is **Asia (Singapore)**, with some services in other regions of the same providers. Because Singapore is outside India, your data is transferred across borders; we protect it in transit with TLS encryption and at rest with provider-grade encryption, and we transfer it only where permitted by applicable law.
- **Retention.** We keep your account data, projects, chats and wallet records **for as long as your account is active**, because the product's promise is that your work and history are there when you return. Specific shorter windows: build sandboxes are recycled automatically after inactivity (minutes, not days); technical logs are retained for up to **90 days**; payment and tax records are retained for the period Indian law requires (typically **8 years**) even after account deletion.
- **After deletion.** When you delete your account (Section 9), personal data is deleted or irreversibly anonymised within **30 days**, except the payment/tax records above and data we must keep for a live legal matter.

---

## 7. Who we share data with

We share personal data only with the parties below, and only for the purposes described:

- **Payment processing: Cashfree Payments** — processes your payments; we exchange order identifiers and outcomes with them. Their handling of your card/UPI data is governed by their own policy and RBI regulations.
- **Sign-in: Google / Apple** — when you choose them as your login method.
- **Cloud infrastructure providers** — host our servers, databases and file storage under strict contracts.
- **AI infrastructure providers** — process prompts/context to generate output, as described in Section 4, with no training rights.
- **GitHub** — only if you connect it, and only with the access you granted.
- **Malware scanning** — files uploaded to the Nav App Store are submitted to an anti-malware scanning service before any listing can be approved.
- **Meta (Facebook / Instagram)** — the advertising-measurement events listed in Section 3.1, and only with your consent. Never your chats, files, clinical data or built apps.
- **Authorities** — if required by a valid legal order. We check every demand and share the minimum required.
- **A future business transfer** — if NavBharatAI is ever acquired or merged, data transfers with the business; this policy (or one no less protective) continues to apply, and we will notify you.

We do not sell your personal data and we never share it with data brokers. The only advertising-related sharing we do is the conversion measurement described in Section 3.1 — a fixed list of events, only after you consent, and never the content of anything you write, upload or build.

---

## 8. Security

- Encryption **in transit** (TLS) everywhere, and **at rest** on our storage systems.
- Secrets you store are encrypted with a dedicated key separate from ordinary application data.
- Automatic **redaction of secrets and personal identifiers** (API-key shapes, emails, phone numbers, Indian identifiers such as PAN/Aadhaar patterns) from logs, tool output shown on screen, and the anonymous learning system.
- Strict access control inside the team: production access is limited, logged, and need-based.
- Every app uploaded to the Nav App Store is signature-checked and malware-scanned, and **nothing publishes without passing review** — a failed or unavailable scan blocks publication rather than being skipped.
- Independent security research is welcome — see the Security page for our vulnerability disclosure process.

No system on the internet is perfectly secure. If a breach affecting your personal data occurs, we will notify the affected users and the authorities as the DPDP Act requires, without undue delay.

---

## 9. Your rights and controls

Under the DPDP Act (and simply because it is right), you can:

- **Access** — ask what personal data we hold about you.
- **Correct** — fix inaccurate account data (much of it is editable in Settings directly).
- **Delete** — delete individual projects/chats in-app, or request full account deletion by email. Deletion follows the timelines in Section 6.
- **Withdraw consent** — for anything based on consent (e.g. optional analytics via the consent banner), withdraw it at any time without losing the core service.
- **Grievance** — raise a complaint at info@navbharatai.com; if you are unsatisfied with our response, you may escalate to the **Data Protection Board of India**.
- **Nominate** — under the DPDP Act you may nominate a person to exercise these rights for you in case of death or incapacity; email us to record a nomination.

We will verify identity before acting on a request, so nobody else can use these rights against you.

---

## 10. Children

The Platform is **not intended for children under 18**. We do not knowingly collect personal data from children. If you are a parent or guardian and believe a child has created an account, contact us and we will delete it. Where verifiable parental consent becomes practical to support under DPDP rules, we may allow supervised use; until then, under-18 use is not permitted.

---

## 11. Cookies and similar technologies

We use a small set of cookies and local-storage keys that are **necessary** for the Platform to work (your session, your theme, your text-size choice, your consent decision). Optional analytics and the Meta advertising-measurement pixel (Section 3.1) run **only** if you accept the consent banner, which is where you control them. Decline, and no third-party advertising or measurement cookie is set at all — the pixel is not even downloaded.

---

## 12. Apps YOU build, and their users

When you build an app with NavBharatAI and share or deploy it, **you** are responsible to the people who use it. Their data lives in the database and services **you** connect (your own Supabase/Firebase/other account — NavBharatAI deliberately provisions user apps on the builder's own accounts, not ours). If your app collects personal data, you need your own privacy policy for it — you can generate a starting draft with NavBharatAI, and the same review advice applies: have it checked before you rely on it.

---

## 13. Changes to this policy

When we change this policy in a meaningful way, we will update the date at the top and announce the change in-app before it takes effect. Continued use after the effective date means the updated policy applies. The current version always lives at this page.

---

*This policy is provided in English as its authoritative version. Summaries in other languages may be offered for convenience; if they conflict, the English version controls.*`;

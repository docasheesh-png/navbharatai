// NavBharatAI — Security Documents (public overview + policies + incident response + vulnerability
// disclosure). Every claim below is grounded in what the code actually does (secret redaction,
// signed-APK + scan + review store pipeline, failed-build-never-charged, sandbox isolation, CI
// security gates) — the honesty rules apply to security marketing too: no claimed control that does
// not exist. ⚠️ NOT LEGAL ADVICE (the disclosure-policy safe-harbour wording carries legal weight)
// — review by a lawyer AND a security professional recommended before enterprise distribution.

export const SECURITY_DOCS_TITLE = 'Security at NavBharatAI';
export const SECURITY_DOCS_UPDATED = '8 August 2026';

export const SECURITY_DOCS = `# Security at NavBharatAI

**Last updated: ${SECURITY_DOCS_UPDATED}**

This page is our security documentation set in one place: an overview of how the Platform protects your data, our internal security policy commitments, how we respond to incidents, and how to report a vulnerability to us. We write it the way we build: **only claims that are actually true in the product.**

---

## Part 1 — Security Overview

### 1.1 Architecture in one paragraph

NavBharatAI runs on enterprise-grade cloud infrastructure (primary region: Asia/Singapore). Your projects and account data live in managed, encrypted databases and object storage. AI builds run inside **isolated, per-workspace cloud sandboxes** that are automatically recycled after inactivity. Payments are processed by Cashfree — card and UPI credentials never touch our servers. Apps you build run against **your own** connected services (your database, your accounts), which is a security decision as much as a billing one: your users' data is not pooled on our side.

### 1.2 Encryption

- **In transit:** TLS on every connection — browser to us, us to every provider.
- **At rest:** provider-grade encryption for databases and file storage.
- **Secrets vault:** API keys you save in Settings → Secrets & API Keys are encrypted with a **dedicated encryption key**, separate from ordinary application data, and are injected only into your own apps.

### 1.3 Redaction by construction

Secrets and personal identifiers are masked **before** they can reach a screen, a log line, or a learning record:

- known secret shapes (API-key prefixes, JWTs, private-key blocks, credentials in URLs, secret-named env assignments) are masked in tool output and logs;
- personal identifiers with India-specific coverage (emails, phone numbers, PAN, IFSC, Aadhaar patterns) are masked in uploaded-content processing;
- the cross-user "mistake learning" system stores only anonymous error signatures with numbers/paths/quoted text stripped, passes secret+PII redaction, and **never receives an account identifier** — a property enforced by automated tests, not by promise.

### 1.4 Access control

- Production access is limited to a small, named set of people, on a need-to-use basis, and logged.
- Admin-only surfaces (build diagnostics, provider telemetry, the store review queue) are **gated server-side and fail closed** — a failed permission lookup denies rather than allows.
- Sessions use industry-standard authenticated identity (Google/Apple/OTP via our identity provider); we never store your Google/Apple password.

### 1.5 The Nav App Store pipeline

Every app submitted to the store must be a **genuinely signed** package; it is then **malware-scanned** and lands in a **pending** state that only an explicit human review can approve. Three properties are enforced in code: *no scan ⇒ no publication* (a missing key, rate limit, oversize or timeout blocks rather than skips), *nothing auto-approves*, and *removal deletes the hosted bytes* — a takedown is real.

### 1.6 Supply-chain security

- CI runs a **dependency-security gate**: a build with a new high/critical known-vulnerable dependency fails and cannot merge; accepted exceptions require a written reason in an allowlist.
- Install scripts of dependencies are restricted via an allowlist mechanism.
- Deployments go through a single automated pipeline from reviewed, CI-green code — no hand-edited production servers.

### 1.7 Billing integrity

Money honesty is a security property: usage is billed from real measured consumption; a failed build is never charged; unmeasured usage is never estimated onto a bill; interrupted payments are automatically reconciled so a paid user is never silently uncredited.

---

## Part 2 — Security Policy (our internal commitments)

1. **Least privilege.** People and services get the minimum access needed; access is reviewed on role change and revoked on exit, same day.
2. **No shared credentials.** Named accounts only; multi-factor authentication on infrastructure and code-hosting accounts.
3. **Secrets hygiene.** Production secrets live in the deployment platform's secret store — never in the repository, never in chat logs. The repository is monitored for accidental secret commits.
4. **Change control.** Every change ships through branch → automated verification (type-checks, ~12,000+ automated tests, security gates) → review → merge; merge is what deploys. Emergency changes follow the same pipeline, expedited rather than bypassed.
5. **Data minimisation.** We collect what the product needs (see the Privacy Policy), keep logs 90 days, and design new features anonymised-first (the learning system is the example).
6. **Device hygiene.** Team devices use full-disk encryption, screen locks, and current OS security updates.
7. **Vendor review.** New sub-processors are assessed for security posture and bound by contract before receiving any personal data (see the DPA).
8. **Honest claims.** No security claim is published unless the control genuinely exists in the product — the same "real features only" rule the whole Platform is built under.

---

## Part 3 — Incident Response Plan (summary)

**Goal:** detect fast, contain fast, tell the truth.

1. **Detect & triage (hour 0).** Signals: monitoring alerts, failed-integrity checks, user reports, researcher reports. The on-point engineer classifies severity: SEV-1 (active breach / data exposure / payments at risk), SEV-2 (vulnerability with plausible exposure), SEV-3 (contained defect).
2. **Contain (hours 0–4 for SEV-1).** Revoke affected credentials, isolate affected services, disable the vulnerable path (the Platform is built with per-feature kill switches precisely so a feature can be turned off without a deploy).
3. **Assess.** Establish what data, whose, how much, and for how long — from logs and durable audit records, not guesses.
4. **Notify.** For a personal-data breach: affected users and the authorities required by the DPDP Act without undue delay; business customers under the DPA within **72 hours** of confirmation. Notifications say plainly what is known, what is not yet known, and what to do.
5. **Eradicate & recover.** Root-cause fix (our standing engineering law is root-cause-only — a symptom patch is not closure), restore from durable storage where needed, rotate secrets touched by the incident.
6. **Learn.** A written post-incident review with the timeline, the root cause, and the class-level fix; regression tests lock the fix so the same incident cannot silently return.

---

## Part 4 — Vulnerability Disclosure Policy

We welcome good-faith security research.

- **Report to:** **info@navbharatai.com** with subject "**SECURITY**". Include steps to reproduce, the impact you believe it has, and how to reach you.
- **Our commitments:** acknowledgement within **72 hours**; a substantive assessment within **7 days**; a fix or mitigation for confirmed high/critical issues as fast as severity demands; credit (with your permission) once fixed. We will not pursue legal action for good-faith research that respects the rules below.
- **Rules of engagement:** do not access, modify or exfiltrate data that is not yours (use your own test accounts); no denial-of-service, spam, or social engineering of our team or users; no automated scanning at disruptive volume; give us reasonable time to fix before public disclosure.
- **Out of scope:** issues in third-party services (report to them), self-XSS, missing best-practice headers without demonstrated impact, and vulnerabilities requiring a compromised device.

---

## Part 5 — Honest boundaries (what we do NOT yet claim)

Trust is earned by accuracy, so we say this plainly:

- We do **not** yet hold SOC 2 / ISO 27001 certification. The controls above are real, but third-party attestation is a planned milestone, not a current claim.
- We are a young platform; our uptime history is building, not decades long.
- Formal external penetration-test reports are commissioned as the enterprise business grows; until shared, Part 1 is our verifiable-in-product evidence.

If your organisation needs specific assurances beyond this page, write to info@navbharatai.com — the DPA, the NDA-gated sub-processor list, and direct security questionnaires are available.`;

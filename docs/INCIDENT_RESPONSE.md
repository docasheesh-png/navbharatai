# NavBharatAI — Incident Response Runbook (P-SEC.12)

Formal playbook for security/operational incidents. Pair this with the live signals:
`lib/metricsAlerts.ts` (error-rate / preview-rate / latency alerts), `/api/admin/metrics`
(+ `/history`), `lib/audit.ts` structured SIEM events (Cloud Logging `jsonPayload`,
`component:"nbai-audit"`), and `/api/health` (readiness/liveness).

---

## 1. Severity matrix

| Sev | Definition | Examples | Response start | Comms |
|-----|------------|----------|----------------|-------|
| **P1 — Critical** | Active data breach, credential leak, or full outage; users harmed or exposed. | `SECRET_ENCRYPTION_KEY` leak, Firestore data exfiltration, prod down, payment double-charge. | **Immediately** (drop everything) | Notify admin (aashishcpmt09) at once; status note to users if user-facing. |
| **P2 — High** | Partial outage, exploitable vuln, or abuse causing cost/risk; no confirmed data loss. | Auth bypass on a route, AI-abuse cost spike, one provider hard-down, RBAC hole. | < 1 hour | Admin notified; internal tracking. |
| **P3 — Moderate** | Degraded experience or low-risk issue; workaround exists. | Elevated latency, a single non-critical feature broken, noisy DAST finding. | Next working session | Logged in tracker. |

---

## 2. Escalation chain
1. **Detector** (alert / user report / `metricsAlerts` / DAST / Dependabot) → 
2. **On-call admin** (aashishcpmt09) triages + assigns severity → 
3. **P1/P2:** admin owns resolution end-to-end; **P3:** queued into the roadmap.
4. If credential/billing impact → also rotate keys (see §3.B) and review `audit` SIEM logs.

---

## 3. Response procedures

### A. Service outage (P1/P2)
1. Check `/api/health` + Cloud Run logs + `/api/admin/metrics` to localize (app vs provider vs Firestore).
2. If a bad deploy: **roll back** the Cloud Run revision to the last-good (Cloud Run console → Revisions → route 100% to previous). Cloud Run keeps prior revisions.
3. If an AI provider is down: confirm the router circuit-breaker tripped (`[CIRCUIT]` logs) — traffic should auto-fall back across the universe chains. If not, escalate model config.
4. Post-mortem: record timeline, root cause, fix, and a prevention item in the roadmap.

### B. Credential / secret compromise (P1)
1. **Revoke** the leaked credential at the source (provider console / Firebase / Cashfree).
2. **Rotate** `SECRET_ENCRYPTION_KEY` and re-encrypt `user_secrets` (see P-SEC.5 key-rotation, once shipped) or, interim, force-reset affected secrets.
3. Invalidate sessions if user tokens are implicated.
4. Audit blast radius via `audit` SIEM events (`component:"nbai-audit"`, filter by `severity>=WARNING`).
5. Notify affected users per DPDP/GDPR obligations if personal data was exposed.

### C. Data breach / exfiltration (P1)
1. Contain: lock down the affected Firestore collection (tighten `firestore.rules`), revoke offending access.
2. Preserve evidence: snapshot Cloud Logging + `server_logs` before any cleanup.
3. Assess scope (which collections/users); classify personal data involved.
4. Notify: admin → affected users → (if required) regulator under DPDP timelines.

### D. AI abuse / cost spike (P2)
1. Identify the abuser via `audit` events + `AgentV3CostTelemetry` (per-user cost).
2. Throttle/ban: drop the user's rate-limit tier; set `abuseLedger`/ban flag (admin panel).
3. Confirm per-build budget caps are enforced (cost-control); cap exposure.
4. Add the abuse pattern to detection (P-AI.10 / P-SEC.8).

---

## 4. After every P1/P2
- Write a short post-mortem (timeline, root cause, fix, prevention) — append to this repo's docs or PROGRESS.md.
- File the prevention action as a roadmap item so it is not lost.

> **Follow-up (optional enhancement):** surface `metricsAlerts` HIGH alerts as a red banner in the admin UI
> (Firestore notification → admin dashboard). Tracked as a P-SEC.12 nice-to-have; the runbook above is the
> primary deliverable.

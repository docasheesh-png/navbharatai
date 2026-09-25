# NavBharatAI Pro — Operations Runbook (Phase 7.6)

Real, tested-by-design incident procedures. Each entry: **symptom → diagnosis →
action → verify**. Keep this current; it is the single source of truth during an
incident. (Drill execution is a human task — run each drill quarterly and note
the date + result at the bottom.)

---

## 1–2. RETIRED (2026-09-25): the legacy build engine and its two procedures

These two entries described the pre-v3.0 engine behind `POST /api/build` and `POST /api/build-stream`
(`ENGINE=v1/v2`, `UnifiedBuildOrchestrator`, `ProEngineRunner`'s VFS tier). That engine is removed and
both endpoints answer `410`. Every build runs in NavBharatAI Pro (AgentV3).

⚠️ **Do NOT follow the old section 2** ("remove `E2B_API_KEY` to force the in-memory tier"). AgentV3
has no in-memory tier: without `E2B_API_KEY` it cannot build at all. An E2B quota problem is fixed by
topping up the E2B account.

---

## 3. "AI provider down" → degraded mode

**Symptom:** Slow/failed AI responses; "Primary AI provider unavailable" status in
chat.

**Diagnosis:** This is expected, self-healing behavior. The AIRouter circuit
breaker cools down the failing provider and falls through Grok → Anthropic →
Vertex → Gemini (`src/server/AI/Router/AIRouter.ts`). Phase 4.1 shares cooldowns
across instances via Firestore (`provider_cooldowns`).

**Action:** Usually none — the fallback is automatic. If ALL providers are down,
confirm keys are present (`GROK_API_KEY`/`XAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
and rotate any revoked key in Cloud Run env vars.

**Verify:** Live Metrics → cost-by-provider shows traffic shifting to a healthy
provider; build success rate recovers.

---

## 4. "Database corruption / bad data" → restore from Firestore backup

**Symptom:** Reads return malformed docs; users report lost sessions/history.

**Diagnosis:** Identify the affected collection (e.g. `build_history`, `sessions`,
`user_secrets`). All stores are best-effort and fail-open, so a single bad doc
should not crash the app — confirm it's data, not code.

**Action:** Restore the affected collection from a Firestore export:
```bash
# Restore a prior export into the project (point-in-time export must exist).
gcloud firestore import gs://<backup-bucket>/<export-path> \
  --project=gen-lang-client-0866594388
```
If no scheduled export exists, set one up immediately (Firestore → Backups).

**Verify:** Affected reads return correct data; spot-check a known-good user.

---

## 5. Deploy did not go live after merge to `main`

See `CLAUDE.md` → "If a merge does NOT deploy". Short version:
1. Wait 1–2 min (webhook delay), re-check Cloud Build history.
2. Manual trigger:
   ```bash
   gcloud builds triggers run 75443609-def7-4c9a-92e7-805931f5bf8f \
     --branch=main --region=global --project=gen-lang-client-0866594388
   ```
3. Confirm the trigger is Enabled and the GitHub connection is live.

---

## Drill log (run quarterly — record date + outcome)

| Drill | Last run | Result |
|-------|----------|--------|
| #1 ENGINE rollback | _not yet run_ | — |
| #2 E2B fallback | _not yet run_ | — |
| #3 Provider failover | _not yet run_ | — |
| #4 Firestore restore | _not yet run_ | — |

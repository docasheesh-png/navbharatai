# NavBharatAI Pro — Operations Runbook (Phase 7.6)

Real, tested-by-design incident procedures. Each entry: **symptom → diagnosis →
action → verify**. Keep this current; it is the single source of truth during an
incident. (Drill execution is a human task — run each drill quarterly and note
the date + result at the bottom.)

---

## 1. "ENGINE=v2 is broken" → roll back to v1 in < 30 seconds

**Symptom:** Builds via the agentic engine fail/hang after an `ENGINE=v2` rollout;
error rate alert fires in Settings → Admin → Live Metrics.

**Diagnosis:** Confirm it correlates with the env flag, not a provider outage
(check the AI-cost panel — if all providers are erroring it's #3, not this).

**Action (Cloud Run):**
```bash
gcloud run services update navbharat-ai-prod \
  --region=asia-southeast1 --project=gen-lang-client-0866594388 \
  --update-env-vars ENGINE=v1
```
`ENGINE=v1` (or unsetting it) routes builds back through the direct `runProEngine`
path — see `src/server/project/UnifiedBuildOrchestrator.ts` (`isUnifiedEngineEnabled`).

**Verify:** Submit a "hello world react app" build → completes with files +
preview. Error-rate alert clears within one metrics interval.

---

## 2. "E2B quota exhausted" → auto-fallback to VFS

**Symptom:** Engineer AI builds error with E2B quota/limit messages.

**Diagnosis:** The tier selector already auto-selects VFS when no E2B key/quota is
available (`ProEngineRunner.ts` tier selection). A hard failure means a key is set
but the account is over quota.

**Action:** Either top up the E2B account, OR remove `E2B_API_KEY` from Cloud Run
to force the free in-memory VFS tier for all users:
```bash
gcloud run services update navbharat-ai-prod \
  --region=asia-southeast1 --project=gen-lang-client-0866594388 \
  --remove-env-vars E2B_API_KEY
```

**Verify:** New builds report "Execution tier: In-memory tier (free)" and succeed.
Users keep building; only real-sandbox features (live npm/browser) are paused.

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

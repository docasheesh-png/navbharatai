# Free Chat — tiered provider module (owner spec 2026-10-23)

Extends the existing Free Chat Chain (`src/server/AI/FreeChain/**`, see `FREE_CHAT_CHAIN.md`).
Everything stays **OFF by default** (`FREE_CHAIN_ENABLED` off, rollout 0%). Turning it off
restores today's `buildFree()` ladder instantly. No billing code, app builds, professionals
or strict-free (#3902) semantics are changed.

## 1. Architecture (text diagram)

```
POST /api/chat (tier=navbharat)
  └─ freeChatReplies rules (language, Pro line, answer-every-message)  ← unchanged, above the chain
     └─ UniversalAIRouter.routeStream/routeDetailed
          ├─ FREE_CHAIN_ENABLED off / user not in rollout ──► legacy buildFree() ladder (instant revert)
          └─ FreeChain runtime (selected users)
               ├─ admission queue (per-instance, per-user fairness)
               ├─ optional public-answer cache (off by default)
               ├─ orderForUser(): stable uid-hash rotation of equal-cost free Tier-1 rungs (FREE_CHAIN_STICKY_SPREAD)
               └─ for each rung, stop after FREE_CHAIN_MAX_ATTEMPTS (default 4) physical calls:
                    skip if: unconfigured · terms-blocked · plan/rate attestation expired · privacy ·
                             language · admin-disabled · circuit open · local capacity
                    reserve shared quota (Firestore: RPM/RPD/TPM/TPD, provider reset zone, durable cooldown)
                    paid rung? reserve shared $ budget (IST day, default/max $10, 50/80/100% alerts)
                    call OpenAI-compatible endpoint (allow-listed base URL, one key, streaming watchdog)
                    429 → cooldown = Retry-After (seconds or HTTP date) else 10s/24h quota, shared via Firestore
                    401 → 1h cooldown; 5xx/timeout → circuit breaker
                    text already streamed → never switch provider
               └─ all exhausted → one friendly localized line ("thodi der baad try karein")

Tier 1 true free : glm47 → glm45 → groq → gemini(privacy-off) → cloudflare → nvidia(terms-blocked)
Tier 2 gateways  : openrouter(:free allow-list) → modelscope(blocked) → bluesminds(unverified) → requesty(unverified) → llm7(blocked)
Tier 3 paid      : glmflashx → nemotron(DeepInfra) → gpt5nano → deepseek   (always last; config cannot promote)
Default dispatch order (blocked rungs omitted): glm47, glm45, groq, gemini, cloudflare, openrouter, glmflashx, nemotron, gpt5nano, deepseek
```

## 2. Old system vs owner spec — what was taken, what was rejected

| Topic | Existing FreeChain (main) | Owner spec | Result |
|---|---|---|---|
| Order | GLM → Groq → OpenRouter → Cloudflare → Gemini → DeepSeek | Tier1 → Tier2 → Tier3 | **Owner order adopted**; Gemini moved up (still privacy-off), OpenRouter moved to Tier 2 |
| Providers | 7 rungs | +NVIDIA, ModelScope, BluesMinds, Requesty, LLM7, FlashX, Nemotron, GPT-5 Nano, Grok 4.1 Fast, Kimi | Added 8; NVIDIA/ModelScope/LLM7 **registered but blocked** (terms: non-production), BluesMinds/Requesty **blocked as unverified**; Grok/Kimi rejected (below) |
| Paid tier | DeepSeek only | 5 cheap paid models | 4 paid rungs, cheapest first, one shared $ cap, owner rate-card attestation with expiry |
| Key pooling 10–20 keys | One key per provider, comma list rejected | Multi-key pooling, user_id % key_count | **Rejected for free tiers**: Groq/Z.ai/OpenRouter/LLM7 terms forbid multiple accounts to raise limits (ban risk = whole Free chat down). Keys under one paid account share that account's limit, so pooling adds leak surface without capacity. Kept one key per provider. |
| Sticky user→provider | OpenRouter model stickiness per conversation | user grouping | **Adopted** as `FREE_CHAIN_STICKY_SPREAD`: uid-hash rotation among equal-cost free Tier-1 rungs only |
| LRU/round-robin | Ordered fallback | LRU / round robin | Covered by sticky spread (load spread) + ordered fallback; true LRU not needed with one key |
| 429 cool-down 15–30 min | Retry-After honoured, else 10 s; daily exhaustion until reset; durable in Firestore | 15–30 min | **Kept existing**: honouring Retry-After is more precise than a fixed 15–30 min (which would idle a provider that is ready after 2 s) |
| Circuit breaker | Yes (shared CircuitBreaker) | Yes | Kept |
| Daily quota + UTC reset | Firestore ledger, per-provider reset zone | UTC reset | Kept per-provider zone (Gemini resets Pacific time; UTC would be wrong) |
| Max 3–4 providers | Not bounded | Max 3–4 then "retry later" | **Adopted**: `FREE_CHAIN_MAX_ATTEMPTS` default 4 physical calls |
| Silent fallback | Yes | Yes | Kept; final line now localized hi / Hinglish / en |
| Admin panel | ON/OFF, rollout %, per-rung disable, usage/limits, circuit, spend vs cap, audited | + key add/remove, cost | Tier labels + terms notes added. **Key add/remove in the panel rejected**: keys live only in Secret Manager (Kimi-leak lesson); panel shows configured yes/no |
| Paid cap | $10/day shared, IST day, alerts 50/80/100 % | ~$10/day | Kept, now covers all 4 paid rungs |
| Grok 4.1 Fast | — | Tier 3 | **Rejected**: xAI retired `grok-4-1-fast-*` on 2026-05-15; the slug now bills as grok-4.3 at $1.25/$2.50 per MTok — 6–25× dearer than the other paid rungs |
| Kimi cheapest | — | Tier 3 | **Rejected**: kimi-k2.7 *is* the free-tier price ceiling (dearest allowed), and its key leaked recently |

## 3. Provider facts (checked 2026-10-23; owner must re-verify before enabling)

| Rung | Endpoint | Model | Free / price | Status |
|---|---|---|---|---|
| glm47/glm45 | api.z.ai/api/paas/v4 | glm-4.7-flash / glm-4.5-flash | Free (docs.z.ai pricing) — quotas unpublished | needs `FREE_CHAIN_GLM_RPM/RPD…` + attestation |
| groq | api.groq.com/openai/v1 | openai/gpt-oss-120b (or -20b) | Free: 30 RPM, 1,000 RPD, 200K TPD per model | attestation |
| gemini | generativelanguage…/openai | gemini-2.5-flash-lite | Free tier **trains on data** | OFF until privacy policy updated (DPDP) |
| cloudflare | api.cloudflare.com/…/ai/v1 | llama-3.3-70b-fp8-fast | 10,000 neurons/day | attestation |
| openrouter | openrouter.ai/api/v1 | `FREE_CHAIN_OPENROUTER_MODELS` (≤4) | :free 50 RPD, 1,000 RPD after $10 credits | quality allow-list |
| nvidia | integrate.api.nvidia.com/v1 | nemotron-3-nano | Free = trial/dev only | **blocked** (terms-non-production) |
| modelscope | api-inference.modelscope.cn/v1 | Qwen3-32B | Free quota, non-production | **blocked** |
| llm7 | api.llm7.io/v1 | default | 100K tokens/24h; TERMS: "not for production", no serving third parties without written approval | **blocked** |
| bluesminds | api.bluesminds.com/v1 | gpt-oss-20b | Credit/per-request, terms unclear | **blocked (unverified)** |
| requesty | router.requesty.ai/v1 | Nemotron via DeepInfra | Paid gateway (+5 %), no verified free tier | **blocked (unverified)** |
| glmflashx | api.z.ai/api/paas/v4 | glm-4.7-flashx | $0.07 in / $0.40 out | paid, attestation |
| nemotron | api.deepinfra.com/v1/openai | nvidia/Nemotron-3-Nano-30B-A3B | $0.05 in / $0.20 out | paid, attestation |
| gpt5nano | api.openai.com/v1 | gpt-5-nano (reasoning_effort minimal) | $0.05 in / $0.40 out (**unverified this session** — confirm on openai.com/api/pricing) | paid, attestation |
| deepseek | api.deepseek.com/v1 | deepseek-flash | existing verified peak profile | paid |

A blocked rung can be released only with `FREE_CHAIN_<P>_WRITTEN_APPROVAL=on`, which must mean
the owner holds written commercial permission from that provider.

## 4. Admin setup guide

Project `gen-lang-client-0866594388`, service `navbharat-ai-prod`, region `asia-southeast1`.

1. Create ONE key per provider in the company's own account (never extra accounts):
   - Z.ai: z.ai → API Keys (`FREE_CHAIN_GLM_API_KEY`; free Flash models). For paid FlashX create a
     second key in the same account with a small prepaid balance (`FREE_CHAIN_GLMX_API_KEY`).
   - Groq: console.groq.com → API Keys (`FREE_CHAIN_GROQ_API_KEY`).
   - Cloudflare: dashboard → Account ID (`CLOUDFLARE_ACCOUNT_ID`, plain env) → API Tokens with
     Workers AI Read **and** Edit (`FREE_CHAIN_CF_API_TOKEN`).
   - OpenRouter: existing `OPENROUTER_API_KEY`; add $10 credits (1,000 free RPD) and set a key credit limit.
   - DeepInfra: deepinfra.com → API keys, prepaid ≤ $10 (`FREE_CHAIN_DEEPINFRA_API_KEY`).
   - OpenAI: platform.openai.com → project key with a monthly budget (`FREE_CHAIN_OPENAI_API_KEY`).
   - DeepSeek: platform.deepseek.com, small top-up (`FREE_CHAIN_DEEPSEEK_API_KEY`).
   - Gemini: leave unset until the privacy policy discloses Google processing.
2. Store them (you type each key at a hidden prompt; it never enters history):
```bash
PROJECT=gen-lang-client-0866594388; REGION=asia-southeast1; SVC=navbharat-ai-prod
SECRETS="FREE_CHAIN_GLM_API_KEY FREE_CHAIN_GROQ_API_KEY FREE_CHAIN_CF_API_TOKEN FREE_CHAIN_GLMX_API_KEY FREE_CHAIN_DEEPINFRA_API_KEY FREE_CHAIN_OPENAI_API_KEY FREE_CHAIN_DEEPSEEK_API_KEY"
for S in $SECRETS; do
  gcloud secrets create "$S" --project "$PROJECT" --replication-policy=automatic 2>/dev/null || true
  read -rsp "Paste $S then Enter: " V; echo; printf '%s' "$V" | gcloud secrets versions add "$S" --project "$PROJECT" --data-file=-; unset V
done
SA=$(gcloud run services describe $SVC --region $REGION --project $PROJECT --format='value(spec.template.spec.serviceAccountName)')
for S in $SECRETS; do gcloud secrets add-iam-policy-binding "$S" --project "$PROJECT" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor; done
UPD=$(for S in $SECRETS; do printf '%s=%s:latest,' "$S" "$S"; done); UPD=${UPD%,}
gcloud run services update $SVC --region $REGION --project $PROJECT --update-secrets="$UPD" \
  --update-env-vars=CLOUDFLARE_ACCOUNT_ID=<32-hex-id>,FREE_CHAIN_ENABLED=off,FREE_CHAIN_ROLLOUT_PERCENT=0
```
   (Empty `SA` = default compute service account `<project-number>-compute@developer.gserviceaccount.com`.)
3. Record attestations after reading each provider's current terms/limits (expiry ≤ 30 days), e.g.
   `FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL=2026-11-20`, `FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL=…`,
   `FREE_CHAIN_CF_FREE_VERIFIED_UNTIL=…`, `FREE_CHAIN_GLMX_RATE_VERIFIED_UNTIL=…`,
   `FREE_CHAIN_DEEPINFRA_RATE_VERIFIED_UNTIL=…`, `FREE_CHAIN_OPENAI_RATE_VERIFIED_UNTIL=…`, and the
   GLM quotas `FREE_CHAIN_GLM_RPM/RPD/TPM/TPD` from the Z.ai console. Set `FREE_CHAIN_OPENROUTER_MODELS`.
4. Rollout: `FREE_CHAIN_ENABLED=on`, rollout 0, `FREE_CHAIN_ALLOW_UIDS=<your uid>` → test in Hindi,
   Hinglish, English → admin "Free Chat Chain" tab rollout 5 % → 25 % → 100 %, watching fallback rate,
   p95 and paid spend. Optional `FREE_CHAIN_STICKY_SPREAD=on`.
5. Revert: admin toggle OFF (no deploy) or `--update-env-vars=FREE_CHAIN_ENABLED=off`.
6. Leaked key: revoke at the provider first, add a new secret version, redeploy.

## 5. Estimated daily cost — 1 lakh users/day

Assumptions (estimates, not measurements): 10 messages/user/day → **10,00,000 messages/day**;
~1,500 input tokens (system prompt + trimmed history) and ~400 output tokens per message; ₹88 = $1.

| Free source (one account each) | Messages/day it can cover |
|---|---|
| Z.ai GLM Flash (quota unpublished; concurrency-limited — assumed) | ~20,000 (unverified) |
| Groq gpt-oss-120b (200K tokens/day binds before 1,000 RPD) | ~100 |
| Cloudflare (10K neurons; conservative reservation ≈ 850 neurons/req) | ~10 |
| OpenRouter :free (after $10 credits) | ~1,000 |
| Gemini (off for privacy) / blocked providers | 0 |
| **Total free** | **≈ 21,000 (≈ 2 %)** |

Remaining ≈ 9,79,000 messages go to paid Tier 3:

| Paid rung | $/message | Daily cost for 9.79 L msgs |
|---|---|---|
| Nemotron 3 Nano (DeepInfra) $0.05/$0.20 | $0.000155 | **≈ $152 (≈ ₹13,400)** |
| GPT-5 Nano $0.05/$0.40 (+ reasoning tokens) | ≥ $0.000235 | ≥ $230 (≈ ₹20,200) |
| GLM-4.7-FlashX $0.07/$0.40 | $0.000265 | ≈ $259 (≈ ₹22,800) |
| DeepSeek Flash $0.30/$1.20 | $0.00093 | ≈ $910 (≈ ₹80,000) |

Key conclusions:
- Free tiers cover only ~2 % at 1 lakh users; they are a cost cushion, not the engine.
- With the default **$10/day cap**, only ~64,000 extra messages/day can be served on Nemotron; the rest
  get the friendly busy line. Serving everyone needs a cap of ~$155/day (≈ ₹13,600, ≈ ₹4.1 lakh/month),
  which exceeds the current owner-authorized $10 ceiling (code change + owner approval required).
- At 5 messages/user/day, halve all paid figures (~$76/day). Prompt caching of the system prompt can
  cut input cost a further 50–80 %. Nemotron is a reasoning model; hidden reasoning tokens can raise
  output cost — measure on the canary before trusting these numbers.

## Final Master Plan (owner, 2026-10-24)

Default order: `glm45` (max 2 in flight) → `glm47` (max 1) → `groq` → `cloudflare` → `openrouter` (:free) →
paid `llama8b` (DeepInfra Llama-3.1-8B Turbo) → `dsv4flash` (DeepInfra DeepSeek-V4-Flash-0731) →
backups `gpt5nano` → `glmflashx` → `geminipaid` (Gemini 2.5 Flash-Lite, paid tier). Nemotron Nano removed;
free-tier Gemini is out of the default order. Both DeepInfra rungs use ONE key: `FREE_CHAIN_DEEPINFRA_API_KEY`.

All features below are **default ON** and individually killable with `=off`. The master switch
`FREE_CHAIN_ENABLED` + rollout still decide who uses the chain; any rung without its key/attestation is skipped.

| Feature | Kill switch | Knobs |
|---|---|---|
| Per-rung concurrency (in-process, per instance) | `FREE_CHAIN_CONCURRENCY_ENABLED` | `FREE_CHAIN_GLM45_MAX_CONCURRENT=2`, `FREE_CHAIN_GLM47_MAX_CONCURRENT=1` |
| Rule router (teaching/exam/medical/long/code/repeat → DeepSeek; short → fast path) | `FREE_CHAIN_ROUTER_ENABLED` | — |
| Stable prompt prefix (profile, greeting state, date moved last) | `FREE_CHAIN_STABLE_PREFIX_ENABLED` | cached tokens logged as `cachedInputTokens` |
| Compact ~1k core prompt (safety rules kept) | `FREE_CHAIN_COMPACT_PROMPT_ENABLED` | — |
| Reply cap (not on reasoning rungs groq/gpt5nano/openrouter; GLM thinking disabled) | `FREE_CHAIN_OUTPUT_CAP_ENABLED` | `FREE_CHAIN_REPLY_MAX_TOKENS=250`, `FREE_CHAIN_FAST_MAX_TOKENS=80` |
| History trim | `FREE_CHAIN_HISTORY_TRIM_ENABLED` | `FREE_CHAIN_HISTORY_TURNS=6` |
| Response cache / FAQ (exact normalized, no personal or dated text) | `FREE_CHAIN_CACHE_ENABLED`, `FREE_CHAIN_FAQ_CACHE_ENABLED` | `FREE_CHAIN_CACHE_TTL_S` |
| Monthly paid cap (IST month) | `FREE_CHAIN_MONTHLY_CAP_ENABLED` | `FREE_CHAIN_MONTHLY_CAP_USD=520` (max 520) |
| Auto-throttle | `FREE_CHAIN_THROTTLE_ENABLED` | `FREE_CHAIN_THROTTLE_PERCENT=80` |

Daily owner ceiling raised to $17 (`FREE_CHAIN_PAID_DAILY_CAP_USD=17`); the default stays $10.
Health/private turns still never reach paid rungs (privacy gate wins over the router).

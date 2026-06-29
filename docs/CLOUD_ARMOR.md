# NavBharatAI — WAF / Cloud Armor (P-SEC.9)

Cloud Run currently sits directly on the internet; app-level defenses (`helmet`, path
blocking, `express-rate-limit`, `SecurityAnalysis`) are **detection/mitigation**, not an
edge **Web Application Firewall**. This doc is the runbook to put Google **Cloud Armor**
in front of the service. (Documented-only here: the Claude session has no `gcloud` access;
apply from a gcloud-authenticated terminal or wire into `infra/terraform/` once P6 lands.)

## What it adds
- **OWASP CRS** preconfigured rules → blocks common SQLi / XSS / LFI / RCE payloads at the edge, before they reach Express.
- **Edge rate limiting** (complements, not replaces, `express-rate-limit`) → throttles floods before they cost compute.
- **IP/geo allow-deny** + named IP lists for the admin surface.

## Apply (manual, gcloud)
Cloud Run must be fronted by an external HTTPS Load Balancer with a serverless NEG, then attach a Cloud Armor policy.

```bash
PROJECT=gen-lang-client-0866594388
REGION=asia-southeast1
SERVICE=navbharat-ai-prod

# 1) Security policy + OWASP CRS (SQLi/XSS preconfigured rules)
gcloud compute security-policies create navbharat-waf --project=$PROJECT
gcloud compute security-policies rules create 1000 --security-policy=navbharat-waf \
  --expression="evaluatePreconfiguredExpr('sqli-v33-stable')" --action=deny-403 --project=$PROJECT
gcloud compute security-policies rules create 1001 --security-policy=navbharat-waf \
  --expression="evaluatePreconfiguredExpr('xss-v33-stable')" --action=deny-403 --project=$PROJECT

# 2) Edge rate limit (e.g. 600 req/min/IP → throttle)
gcloud compute security-policies rules create 2000 --security-policy=navbharat-waf \
  --action=throttle --rate-limit-threshold-count=600 --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP --project=$PROJECT

# 3) Front Cloud Run with an external HTTPS LB (serverless NEG) and attach the policy
#    to the backend service. (One-time LB setup — see GCP docs "Serverless NEG + Cloud Armor".)
gcloud compute backend-services update navbharat-backend \
  --security-policy=navbharat-waf --global --project=$PROJECT
```

## Cost / budget note
Cloud Armor has a standing cost (policy + per-rule + per-request). Respect the `min-instances=0`
budget law: keep the rule set minimal (CRS SQLi/XSS + one rate-limit rule) until traffic justifies more.

## Verification
- Send a known SQLi probe (`?q=' OR 1=1--`) → expect `403` from the edge (not the app).
- Confirm legitimate traffic unaffected; watch Cloud Armor logs for false positives, tune CRS sensitivity.

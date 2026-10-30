# Hostinger domain → NavBharatAI app (owner guide)

## For the end user (no setup needed)
1. Pro → **Publish** → **Connect domain** → type your domain (e.g. `myshop.in`).
2. "Where did you buy this domain?" → **Hostinger** (auto-detected when possible) → **Open Hostinger**.
3. Follow the one-line path shown (English + Hindi). Paste the two nameservers (or the records shown, each has a Copy button).
4. Come back, tap **Check**. Hostinger can take minutes to a few hours — progress is saved, you can close the page. SSL is automatic.

## Optional: one-tap Hostinger auto-DNS (default OFF)
Lets the user paste a Hostinger API token (hPanel → Account → API) once; NavBharatAI writes the records into their zone and **discards the token** (never stored or logged).

Turn it ON in Cloud Run → service → Edit & deploy new revision → Variables:

| Name | Value |
|---|---|
| `AGENTV3_HOSTINGER_DNS` | `on` |

Turn OFF: delete the variable (or set `off`). The manual guide keeps working either way.
First live use: if Hostinger's API rejects the call, the user sees Hostinger's own error message — no fake success.

## Firebase database (user's own project)
Settings → Database → **Firebase** → paste the 6 keys → **Save**. A green "Last step" card then gives **Copy rules** + **Open Firebase Rules** (deep link to the user's project) + 3 steps (EN/HI). The rules keep each user's data private (`users/{uid}`), `public/` readable by all, everything else locked — never "test mode".
Rules are copy-paste, not auto-deployed, on purpose: deploying would need admin access to the user's Google project.

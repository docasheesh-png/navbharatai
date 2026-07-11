# Preview Sandbox Origin (SECURITY Phase 4)

This folder deploys the **cross-origin preview sandbox** to a SEPARATE origin
(`mitrify.xyz`), so an imported/generated app's JavaScript runs on an origin whose
`localStorage` is empty and can **never read navbharatai.com's Firebase auth token**.
This is the fix for the CRITICAL "preview same-origin token theft" finding.

It serves the repo's `../public` directory (which already contains
`preview-sandbox.html`) — **single source, no file copy, no drift.**

## Cost (Firebase Hosting free/Spark plan)

Serving one ~2 KB static file is effectively free: 10 GB storage (uses ~2 KB) and
360 MB/day transfer (each preview load ≈ 2 KB, browser + CDN cached so repeats don't
re-transfer). **Static hosting only — no Firestore/database usage, so zero data cost.**

---

## One-time setup (admin — ~10 min)

### 1. Create the preview Hosting site
Firebase Console → your project (`navbharatai-3395f`) → **Hosting** → **Add another site**
→ name it **`mitrify-preview`** (this must match the `"site"` value in `firebase.json` here).

### 2. Point `mitrify.xyz` at it
In the new site → **Add custom domain** → enter `mitrify.xyz` → Firebase shows the DNS
records (an A record or TXT + CNAME). Add those at your domain registrar. Wait for the
domain to verify + the SSL cert to provision (Firebase does the cert automatically).

> Use `mitrify.xyz` ONLY for this preview sandbox — it must have no login / user data of
> its own (a throwaway "preview only" origin is the whole point of the isolation).

### 3. Deploy the sandbox file
```bash
npm install -g firebase-tools   # if not installed
firebase login
cd preview-host
firebase deploy --only hosting
```
Verify: `https://mitrify.xyz/preview-sandbox.html` loads a blank white page (correct — it
only renders content the platform posts to it).

### 4. Turn on isolation in the app build
The app reads `VITE_PREVIEW_ORIGIN` at **build time** (Vite `import.meta.env`). The
Dockerfile + `cloudbuild.yaml` are already wired to accept it (default empty = today's
same-origin behaviour, unchanged). To activate, set the Cloud Build substitution:

- In the Cloud Build **trigger** (Console → Cloud Build → Triggers → the main trigger →
  Edit → Substitution variables), add:
  `_VITE_PREVIEW_ORIGIN` = `https://mitrify.xyz`
- Re-run the trigger on `main` (or push a commit). The next deploy bakes the origin in.

After that, tell Claude — the in-browser preview iframes get wired to the isolated origin
(the code step deliberately waits until the origin is live, so a mis-set origin can never
break the working preview).

## Rollback
Clear the `_VITE_PREVIEW_ORIGIN` substitution (or set it empty) and redeploy — the app
falls straight back to the current same-origin preview. Nothing else changes.

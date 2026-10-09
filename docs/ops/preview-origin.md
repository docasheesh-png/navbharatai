# Preview origin (D-2)

The in-browser preview must not run generated or imported HTML on the app's own origin. That origin holds the Firebase session and the GitHub token (`gh_token`).

`VITE_PREVIEW_ORIGIN` is unset in the committed build. Until you set it:

- Production does **not** render the same-origin `srcDoc` preview. The pane says: "In-browser preview is turned off for your security until a preview domain is configured. Use Live preview." A button switches to Live preview.
- Local `vite dev` still uses a same-origin `srcDoc` so the vendored React modules (`/vendor/react18`) and Babel can load. That path is not the production build.

Do not turn `allow-same-origin` back on for a production `srcDoc`. An opaque frame cannot load those same-origin ES modules (`Missing dependency react`), and granting our origin to untrusted HTML is the bug.

## What you run

This is DNS and Cloud Build. CI does not do it. Do not put the hostname in `cloudbuild.yaml` or `Dockerfile` from an app PR.

1. Create a subdomain, for example `preview.<your-domain>`.
2. Map that host to the **same** service that serves the app (same build, different host).
3. Set the Cloud Build substitution `_VITE_PREVIEW_ORIGIN=https://preview.<your-domain>` (scheme + host, no path).
4. Confirm `https://preview.<your-domain>/preview-sandbox.html` loads in a browser.
5. Rebuild and deploy. The in-browser iframe then loads that host. `allow-same-origin` on that frame is the preview origin's empty storage, not the app's Firebase session.

If the preview origin equals the app origin, the app ignores it. Isolation only exists when the two hosts differ.

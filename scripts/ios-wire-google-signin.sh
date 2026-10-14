#!/usr/bin/env bash
# Hand the Google Sign-In redirect URL to GIDSignIn, in whichever place THIS Capacitor iOS template delivers it.
#
# 🔴 WHY THIS IS A SCRIPT, AND WHY IT KNOWS TWO TEMPLATES (2026-10-14, iOS run #111).
# The wiring used to be an inline workflow step that patched `AppDelegate.application(_:open:options:)`.
# Capacitor 8.5.x (bumped in #3666, after the last good iOS build on 2026-10-08) moved the generated project to
# the UIScene lifecycle: `AppDelegate` has no `open url` method any more, and the redirect arrives in
# `SceneDelegate.scene(_:openURLContexts:)`. The step's own guard fired — "the template changed" — and the build
# stopped before signing, which is the guard working. But the FIX was never a one-line anchor change: it needs
# the call in the right place, or Google login "succeeds → redirect back → INFINITE LOADING" again (admin iPhone
# report 2026-07-17, the reason this wiring exists at all).
#
# It is a script rather than workflow YAML so it can be RUN against the real generated template in CI
# (`tests/theIosTemplateStillHasEveryAnchorTheWorkflowPatches.test.ts`) — a Capacitor bump that moves the
# anchor again fails a PR, not a release. Portable perl only (no `sed -i ''`), so the same file runs on the
# macOS runner and on Linux CI.
#
# Usage: ios-wire-google-signin.sh [dir holding AppDelegate.swift / SceneDelegate.swift]   (default ios/App/App)
# Exit 0 = wired (or already wired); exit 1 = neither known template — NEVER a silent skip.
set -euo pipefail

DIR="${1:-ios/App/App}"
AD="$DIR/AppDelegate.swift"
SD="$DIR/SceneDelegate.swift"

wired() { [ -f "$1" ] && grep -q 'GIDSignIn\.sharedInstance\.handle' "$1"; }

if wired "$AD" || wired "$SD"; then
  echo "Google Sign-In redirect already wired — skipping."
  exit 0
fi

# Import GoogleSignIn, guarded so the file still compiles if the module ever moves.
add_import() { perl -0pi -e 's/\A/#if canImport(GoogleSignIn)\nimport GoogleSignIn\n#endif\n/' "$1"; }

if [ -f "$AD" ] && grep -q 'return ApplicationDelegateProxy\.shared\.application(app, open: url, options: options)' "$AD"; then
  # CLASSIC template: the URL arrives in AppDelegate. Only the real code line is matched (leading whitespace +
  # return), never the template's commented example.
  add_import "$AD"
  perl -0pi -e 's/(\n\s*)(return ApplicationDelegateProxy\.shared\.application\(app, open: url, options: options\))/$1#if canImport(GoogleSignIn)$1if GIDSignIn.sharedInstance.handle(url) \{$1    return true$1\}$1#endif$1$2/' "$AD"
  TARGET="$AD"
elif [ -f "$SD" ] && grep -q 'SceneDelegateProxy\.shared\.scene(scene, openURLContexts: URLContexts)' "$SD"; then
  # UISCENE template (Capacitor 8.5+): the URL arrives in SceneDelegate. Offer every URL to GIDSignIn BEFORE the
  # generic Capacitor proxy; a URL it handled is consumed and not forwarded.
  add_import "$SD"
  perl -0pi -e 's/(\n\s*)(SceneDelegateProxy\.shared\.scene\(scene, openURLContexts: URLContexts\))/$1#if canImport(GoogleSignIn)$1for context in URLContexts \{$1    if GIDSignIn.sharedInstance.handle(context.url) \{$1        return$1    \}$1\}$1#endif$1$2/' "$SD"
  TARGET="$SD"
else
  echo "::error::Google Sign-In redirect NOT wired — neither AppDelegate (open url) nor SceneDelegate (openURLContexts) has the line this script patches. The Capacitor iOS template changed again; fix ios-wire-google-signin.sh." >&2
  exit 1
fi

wired "$TARGET" || { echo "::error::Google Sign-In patch did not apply to $TARGET." >&2; exit 1; }
echo "Google Sign-In redirect wired in $(basename "$TARGET"):"
grep -n -B1 -A4 'GIDSignIn' "$TARGET" | head -24

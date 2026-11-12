# Safety Shield: staged implementation, not production activation

## Current patch

`adminMfaState.ts` separates an authoritative disabled state from unavailable/corrupt state.
`admin.ts` returns 503 from login and MFA status/enrol/disable when verification state cannot be resolved.
A successful read of an absent document or explicit boolean false remains compatible with an unenrolled account.
An active record with absent/decryption-failed secret cannot become password-only login.
The environment-managed factor remains authoritative. No normal chat/build/provider route changes.

Initial enrolment and activation now use transactions; active factors cannot be overwritten by either endpoint. Pending setup expires in 10 minutes. Disable rechecks the current factor transactionally. MFA mutation routes use the existing admin rate limiter. This is a containment fix, not a new rotation UI.

The draft now requires an independent `ADMIN_SESSION_SIGNING_KEY` (64 hexadecimal characters,
generated from 32 cryptographically random bytes) for login and every shared admin gate. It must
not equal ADMIN_PASSWORD. There is NO password fallback. Existing password-signed tokens will be
rejected after cutover. Store moderation now reads only NAV_STORE_ADMINS, never AGENTV3_FREE_LIST.
No environment variables were created or changed by this patch.

DO NOT DEPLOY until the owner has approved and verified independent signing-key provisioning,
explicit Store owner access, current MFA record availability and tested recovery. Missing signing
configuration will intentionally deny admin authentication; missing Store list denies moderation.
Do not merge this draft based only on focused tests.

This patch does NOT implement per-session revocation, passkeys, cookie transport, or security-centre UI. It is not ready for merge
until route/integration tests and the complete CI workflow pass on the full current source tree.

## Next implementation gates

1. Replace password-derived sessions with server-generated 256-bit opaque tokens. Persist only
   SHA-256 digests with issued/expires/revoked timestamps, principal, auth version and factor strength.
   Never derive session authority from ADMIN_PASSWORD. Every admin gate must consult the same
   authoritative session store and fail closed on lookup failure. No process-memory-only revocation.
2. Use a separate short-lived bootstrap migration endpoint requiring password plus the currently
   enrolled factor. Never accept an old bearer token as migration proof. Owner tests this endpoint
   and recovery in staging before the runtime switches to new sessions. No permanent v2 fallback.
   Missing new configuration must be detected before deployment, not discovered through owner lockout.
3. MFA change flow must require fresh password and existing factor, retain the active secret while
   a pending encrypted secret expires, and verify both the change authorization and current pending
   version within an atomic transaction. Concurrent rotation, disable, stale pending confirmation,
   and replay must be negative tests. Revoke sessions using a committed auth-version increment.
4. The draft explicit Store admin allowlist needs verified owner access configured before activation;
   do not silently remove the only owner path. Free build grants must not authorize moderation.
5. Deliver HttpOnly/Secure/SameSite cookies together with CSRF protections, exact-origin checks,
   logout/revoke endpoints, corresponding frontend changes, and every shared gate migration.
   Do not ship a mixed header/cookie path that bypasses revocation.
6. Recovery codes must be generated once, shown once, hashed, rate-limited, single-use transactionally,
   with successful redemption revoking old sessions. Passkeys require verified WebAuthn origins,
   RP ID, challenges and credential ownership; do not approximate these with home-grown signatures.

## Required evidence before activation

- All applicable checks from current `.github/workflows/ci.yml`, full coverage, real Firestore
  emulator drills, frontend/server/benchmark typechecks, production build, boot and security gates.
- Exact commit and source tree for all results. Focused tests are not a release gate.
- Owner staging login and recovery verified; independent security review; explicit approval for
  production security-setting/credential changes. No secrets in commit, test fixture, log or report.
- Live rollback must preserve the new authorization boundary. Do not restore password-only token
  signing as emergency recovery. Trusted operator recovery is separately controlled and audited.
- User chat/provider calls, paid image generation and project builds remain unchanged throughout.

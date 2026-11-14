# Custom-token authentication freshness correction

Offline source finding, not evidence of production abuse. Checked current main
`authMiddleware.ts` blob 08d422f0c10bd61fb3d52187797c377f2a205b12.

The phone exchange requires a verified, recent phone sign-in and stamps its
original `auth_time` into `session_auth_time`. Firebase Admin's installed token
generator sets custom-token expiry one hour after minting. A custom token redeemed
later has a newer session `auth_time`, which does not represent a repeated phone
OTP. The previous verifyFreshAuth returned redemption time, potentially extending
the 15-minute phone-only app-lock PIN-reset freshness window.

Prerequisites: possession of a valid unexpired phone-exchange custom token, delayed
redemption accepted by Firebase, and a phone-only account using the fresh-sign-in
PIN-reset path. This is not a token-signature bypass or arbitrary account takeover.
No real account/token/provider request was used for reproduction.

The helper now requires a positive safe-integer original epoch for custom-session
step-up, not later than the signed redemption epoch. Missing/malformed original
proof denies only step-up; ordinary session verification is unchanged. A genuine
native phone reauthentication uses its new auth_time. PIN-reset route checks the
proof's UID and no longer synthesizes always-fresh auth during tests.

Validation: synthetic verified-token regression failed on prior helper (4000
instead of original1000), then passed after correction.103 tests across session,
app-lock route and PIN rules pass on Node22.23.4. Full CI and independent review
remain required before release. No publication/deployment performed.

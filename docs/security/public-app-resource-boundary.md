# Public app resource boundary (2026-11-13)

This limited mitigation rejects internal storage keys at the existing brand apply,
ZIP commit and app-AI owner endpoints. It does not activate the staged v2 ownership
system, reassign a legacy project, alter source data or resolve ambiguous legacy
UID prefixes.

Previously `ownedByVerifiedUid` accepted any string beginning with the caller's
legacy prefix. This included `::green`, `::attempt`, `::greenmeta`, and slash-shaped
targets. A public app mutation must not address backup or metadata records. These
routes now additionally require the legacy public app character set. Canonical
issuance uses `SESSION_ID_RE` in `src/server/lib/identityPolicy.ts` and the numeric
fallback in `deriveWorkspaceId` in `src/server/routes/agentv3.ts`. No new session
length limit or stricter UID splitting is introduced. Normal UUID, underscore,
hyphen, short legacy and numeric IDs remain accepted. The old ownership check
still runs; shape alone is not authority.

ZIP rejects a malformed target before looking up, assembling or discarding its
upload. The caller can correct the target without losing the uploaded archive.
Internal GreenGuard storage functions and their derived keys are unchanged.

Tests invoke the registered route handlers to prove refusal precedes source and
settings effects. The ZIP HTTP regression begins an owned upload, writes a real
archive, tries internal targets, verifies the archive and zero actuator/writer
calls, then confirms the existing legitimate-target lease refusal still works.
A regression explicitly demonstrates that `owner`/`long-session` and
`owner-long`/`session` still collide: this patch must not be described as the
complete ownership fix.

Remaining: full integrated CI and independent review, followed by the separate
trusted ownership migration and full writer propagation. No production collision
or exploitation was observed; no private production data was accessed.

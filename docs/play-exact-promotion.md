# Exact-version Android promotion

`android-promote.yml` uses the existing `PLAY_SERVICE_ACCOUNT_JSON` only. It does
not create credentials or increase account permissions. Internal upload success
does not prove that this account has permission to release to production.

Default mode is **offline**: a synthetic plan with no network or credential use.
Run `node --experimental-strip-types scripts/playPromotion.mjs` locally or the workflow's default input.
Tests: `npx vitest run tests/playExactPromotion.test.ts` (mocked API only).

Before remote `inspect`, confirm that no other Console/API edits or pending
changes are open. Creating an API edit can invalidate an existing edit by the
same account. Inspection creates an edit, reads internal and production tracks,
then deletes it without updating or committing. It prints a SHA-256 fingerprint
and version codes; this is not permission to publish.

Before `promote`, independently verify current production, legal/compliance state
and Data safety declarations, including enabled Meta app events. Do not tick the
review inputs without doing that review. The API cannot supply or accept legal
consents for you. Use the exact inspected version code and fingerprint. Source
version, release notes, retained production versions, review-deferral choice and track state are bound to
that fingerprint. A changed plan stops before any track update.

Only one completed internal release containing exactly that version and one
completed production release are supported. First production publication, active
rollouts, country-targeted releases, newer production versions and unknown fields
require manual Console review; the script never strips them to force a promotion.
Existing production versions are retained for devices incompatible with the new
bundle. Release name, notes and update priority come from the selected internal
release. No store listing, country availability, Data safety declaration, content
rating, price, signing credential or artifact is changed.

Promotion updates only the production track, validates, and commits once. Google
may send other pending Console changes for review on commit, which is why a clear
Console must be verified beforehand. The existing review-deferral choice is
explicit and never toggled automatically after an error. Permission, legal or
validation failures stop the operation. A lost commit response is **unknown**:
inspect Play Console before any further action; never rerun automatically.
Commit success is not proof of review approval or availability to users.

The workflow and internal uploader share a non-cancelling concurrency group.
This coordinates these workflows only, not other publishers or manual Console
edits. No production workflow has been dispatched as part of implementation.

References: [Google edits lifecycle](https://developers.google.com/android-publisher/edits),
[concurrent Console/API changes](https://developers.google.com/android-publisher/concurrency-considerations),
[track/release fields](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks).

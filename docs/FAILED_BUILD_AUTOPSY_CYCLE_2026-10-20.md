# Retained failed-report autopsy cycle

Status: **IN PROGRESS. No whole report is closed by this infrastructure change.**

## Verified archive enumeration

The authenticated retained feed was traversed through **109 pages** to `nextCursor = null`.
Both empty pages were retained; the intermediate empty page was followed. Every input cursor,
raw response and checkpoint was persisted before continuing. The resulting private evidence set
was independently checked for repeated cursors, broken chains, duplicates and invalid timestamps.

- 598 unique retained reports across 410 workspaces.
- Zero duplicate workspace/history identities, repeated cursors, chain anomalies or invalid times.
- Global `startedAt` range: 2026-07-13 04:34:43.923 UTC through 2026-10-20 16:13:54.030 UTC.
- Enumeration completed at 2026-10-20 16:40:02 UTC. This is an exhausted moving collection,
  **not a transactionally frozen snapshot**. New reports require a fresh traversal.
- The [safe chronological index](failed-build-autopsy-cycle-2026-10-20.csv) contains only report IDs,
  timestamps, prior queue references and explicit unknown completion evidence. Private user prompts,
  account/workspace identifiers, full reports and raw response previews are not included.

Compared with the previous 551-row index: **549 IDs overlap, 49 are additional, and two are absent
from this traversal**. The absent IDs are `b6283d2d-88ab-46b8-b5d0-a8f3222c5cd7` (Q-1307) and
`12514b7f-fa45-4867-852c-79d6125ffe33` (Q-1309). Their absence does not establish deletion cause,
resolution or a successful later build; the historical index remains unchanged.

## Chronological checkpoint

The first report is `ac25befd-d8e8-474c-92ab-ebb325bbed2b`, existing Q-1851 OPEN.
Its complete returned saved JSON has been read: 225 issue records, 28 problem records,
40 retained model-call records and three commands. This is **not** a complete original transcript:
the saved record itself contains truncated prompt and response previews. Mirrored symptoms and
`autoResolved` flags are not accepted as proof that a root cause was fixed.

The oldest-report item ledger and current-source investigation are in progress. No item is silently
skipped because it is inconvenient; missing evidence is recorded with what is blocked, why,
required action and attempts. A field labeled billed amount is not independent proof of a durable
wallet debit. No financial action or paid historical build rerun is authorized or performed here.

The next two retained reports are `ebb1bf7b-8d3b-4b20-9193-419f19430020` (Q-1850) and
`c4940217-1a70-4921-9d70-4ac771d22343` (Q-1849). Their complete returned responses are retained for
later sequential work, not claimed as completed autopsies. The second report declares 515 issues
but contains only 500 saved issue rows; that evidence limit must not be hidden.

## Completion and ownership

- A prior terminal-cause review, source regression test or a reporter's estimated percentage is not a
  whole-report completion signal. Reconcile each report with its actual item ledger and merged proof.
- Existing open PR #3860 owns direct-server lifecycle, interrupted ETA scoring and seven newer
  report ledgers. Those changes are not duplicated here. Queue/hosting work remains with its owners.
- The limited-write feature changes only separate review metadata. Original reports are immutable.
  See [scope and evidence contract](FAILED_BUILD_REPORTS.md#limited-edits-separate-autopsy-review-metadata).
- A new OAuth registration and explicit paired-scope consent are needed before an AI client can
  write metadata. Existing read-only grants do not widen. Client tool refresh must be verified.
- A `done` marker requires all item counts resolved, no blockers, a pinned ledger and verified
  merged/source/CI evidence. The endpoint records reviewer attestations; it does not independently
  inspect GitHub or replay an old app. Source-and-test proof and historical-runtime proof are distinct.
- Publishing a PR is not deployment, and green CI is not permission to merge. The admin must name
  the exact PR for merge under the repository's single-merger rule. Until deployment and a real
  consent/read/write/revoke check, live scoped-write compatibility remains unverified.

No historical statuses have been backfilled, no reports deleted, no paid builds started, and no
production credentials, billing, routing or security settings changed by this work.

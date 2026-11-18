# Forge preservation hardening

Reconciled with main on 2026-11-18. The owner requested fixing open PR errors before merging; the earlier request to publish an untested draft is superseded. Final integration CI remains required before merge.

The upstream Forge remains canonical. The Dispatcher no longer shares description-only model results between projects. Generated identities hash the full NFC description, and the retained self-author helper cache requires both project scope and object identity and clones stored and returned values.

New kit and object source requires atomic exclusive creation, now implemented on main through #4225. Existing customized, unreadable or identity-mismatched source is preserved. A different spec reusing an existing ID cannot authorize replacement. Identical source retries report only that the source matches; they do not certify the kit, scene integration or gameplay. A changed runtime kit must be reconciled explicitly.

Existing-object customization requires a genuine atomic expected-content replacement capability. The production E2B actuator does not currently provide it, so these edits are honestly refused before any write. The optional interface is guarded and durably recorded when implemented, but neither this PR nor a read-then-write fallback supplies the missing capability. Explicit customization from a person base can create a new target through exclusive creation. A concurrent creation or replacement is never silently overwritten.

Describe-only extra provider calls are held until admitted budget/accounting/cancellation is integrated. The existing admitted architect can still design and submit a JSON spec; no extra model call is made by that path. The tool catalogue, guide, usage instructions and system prompt describe these limits. The independently tested self-authoring helper and its subject checklist remain dormant for a future admitted integration; their dead-code guard exemptions name this reason and must be removed when wired.

Tests cover both supported capabilities and honest refusal when one is unavailable, source preservation, embedded identity mismatch, concurrent writes, cancellation, write guards, durable recording, Unicode identity and project/object cache isolation. No live E2B or browser/mobile acceptance is claimed. Exclusive creation may leave successfully recorded kit additions if a later write fails; these are not rolled back over user edits. Scene integration and visual/gameplay acceptance remain the caller's responsibility.

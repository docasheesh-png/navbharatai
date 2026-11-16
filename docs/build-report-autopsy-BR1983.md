# Reconnect refusal classification

This document describes synthetic regression coverage, not a customer report. Customer requests, identifiers, timestamps, usage, billing and timing telemetry are excluded.

## Scope

- Reuse the existing concurrent-capacity matcher at reconnect boundaries. A recognized capacity refusal must not cause replacement of the recorded machine.
- Preserve the existing uncertain-reconnect refusal for other non-404 failures and existing typed-404 recovery behavior.
- Preserve bounded admission handling; do not raise capacity or add a retry loop.
- Preserve diagnostic reason classifications across the setup-error wrapper. User-facing messages and result shape remain unchanged.

## Independent review repair

The setup wrapper previously dropped the new diagnostic reason when converting a recovery error into a setup refusal. Forward the reason to the wrapper and assert the caught wrapper's detail before checking user-event redaction. This covers the actual route reporting path rather than only the original error object.

## Validation limits

Focused synthetic tests do not establish full integrated CI, provider acceptance, browser acceptance or deployment. Required exact-tree checks and independent review remain necessary before merge. No historical customer build is replayed or declared repaired by these fixtures.

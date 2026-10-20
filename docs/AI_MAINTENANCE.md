# AI Maintenance

Open **Admin console → Monitor → Maintenance**. **Turn on Maintenance** pauses
service; **Resume AI service** reopens it. Both actions require the existing admin
session. Auto-on protection is a separate switch and is enabled by default.

Users receive exactly:

> navbharatai now in Maintenance, please try after some time

The pause is stored in `platform_settings/ai_maintenance`, survives restarts and
is shared by server instances through Firestore snapshots, with a 2-second read
cache. A setting that cannot be read refuses work; an admin save that fails is
reported as a failure. No settings are writable by browser Firestore clients.

Three Kimi account quota/balance failures in a rolling two-minute window activate
the pause. Temporary rate limits, slow replies, context limits, malformed prompts,
and failures from other providers do not. This is a latched pause: it never
silently reopens and spends money. Resuming resets the failure window. Disabling
auto-on does not turn an existing pause off.

The HTTP guard runs before parsers, quota reservations and route handlers, including
versioned APIs and outside API clients. It pauses API work by default, so a new AI
endpoint cannot miss the control. Sign-in, admin recovery, health probes, wallet,
payment settlement and the authenticated internal scheduler are exempt. Existing
pages can still load. New requests receive HTTP 503, no-store and Retry-After.
Model turn, retry and fallback boundaries also check; voice checks before starting
and closes an active session when the setting changes. A call already sent can
still incur cost; this control does not undo work or charges already incurred.

Tests exercise persistence, cross-instance concurrent strikes, ignored failures,
manual recovery, storage outages, a stale read racing a write, actual provider
fallback stopping on the third Kimi refusal, API bypass attempts and the admin
card's unknown/loading state. No production account calls are needed to test it.

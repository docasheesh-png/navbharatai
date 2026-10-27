# Account-session logout

At the bottom of Settings, **Logout** now separates **Log out of this device** from **Log out of all devices**.
Both require confirmation; Cancel/Escape do nothing. Existing Profile/header/pre-login logout
callers retain current-device semantics. The historical client function `signOutEverywhere`
clears this device's web/native SDK layers; it does not revoke other devices.

## Authority and scope

The new JSON POST `/api/v1/auth/sessions/revoke` accepts exactly `{ "confirm": true }`.
It derives the account exclusively from the verified, non-revoked Bearer token, never a body,
query, route UID or administrator override. No password, credential, IAM, billing or provider
configuration changes. No user enumeration. Existing unversioned API compatibility remains.

The endpoint reserves a durable five-per-hour account rate bucket, waits across a full second
(the provider cutoff has second precision), revokes the account's refresh tokens using the
existing Admin SDK, and verifies the returned cutoff is newer than both the initiating
session and the request-start second. Only then does it advance the rules' durable cutoff.
Concurrent or delayed writes use an atomic maximum, never last-writer-wins.

**Success requires both provider revocation and the durable cutoff acknowledgement.**
Only the exact, idempotent cutoff write is retried once after a lost acknowledgement; the
provider mutation is never automatically repeated. Partial failure returns503, not success.
Some sessions may already be invalid then: sign in again and retry to complete the mirror.
A network/client timeout is also an unconfirmed outcome, not proof nothing happened.

Bearer credentials are explicitly attached, not ambient cookies. JSON+Authorization requires
browser preflight and uses the existing exact-origin CORS policy, including bundled native
origins. A new password/OTP step is not imposed: this action ends sessions but does not alter
credentials, permissions or account data, and must also work for existing social/phone providers.
Confirmation and account-scoped rate limiting reduce accidental/abusive repeat actions.

## Invalidation coverage

- All platform ID-token verification uses provider revocation checking **and** the fresh,
  monotonic Firestore cutoff. Existing ID tokens, not just refresh tokens, lose authority.
  Several helpers within one HTTP request share one result; the next request rechecks.
- Sonic voice WebSocket handshakes use the same verifier. Reconnects cannot reuse old authority.
- Phone custom-token handover checks both authorities. Its signed `session_auth_time` claim
  preserves the original phone login epoch. After a positive cutoff, legacy custom credentials
  without that claim are refused too; redeeming an old handover cannot create a new valid epoch.
- Firestore rules apply the same cutoff to every existing signed-in private collection and
  collaboration access path, including own-membership read/delete alternatives. No client can
  read/write the marker. Storage already denies all client access and is unchanged.
- Push registration stamps the verified original session epoch. Account notifications and
  broadcast eligibility filter old/legacy device registrations against the same cutoff;
  unreadable authority fails closed. Fresh login registrations work; late old registrations
  cannot overwrite a newer epoch for that device.

No cross-request positive cache means no application-created revocation TTL window. On a
successful check there is one provider Auth lookup plus one Firestore cutoff read per HTTP
request/voice handshake, independent of the number of helpers that inspect that request.
Transient checks can retry once. The foreground monitor additionally checks once per minute
and on auth/foreground/reconnect events. Broadcast scans deduplicate by UID for that scan only,
with at most eight concurrent cutoff reads. These are tested call counts, **not measured
production latency, throughput or cost neutrality**. Auth and Firestore availability are now
both required for protected-session access; their outages are not reported as a definite logout.

`session_revocations` keeps only a UID-keyed cutoff and bounded rate counter, no tokens or contact
information. It is an explicitly retained security tombstone, not ordinary user content: deleting
it, including during a partial account deletion, could revive otherwise-revoked credentials.
No TTL or broad deletion is introduced without proof that those credentials can no longer work.

## Honest timing and exclusions

Updated clients check at startup/auth change, online, focus/visibility, native app resume, and
every 60 seconds while visible. A definitive own-session401 or revoked SDK credential triggers
bounded web/native cleanup. Offline/network/503 failures do not falsely sign users out. A hung
native token fetch is bounded. Late responses are fenced by both User identity and refresh-token generation, so even a same-UID cross-tab replacement inside the same SDK User object cannot be signed out by an old response. The device
initiating global logout waits for its mutation outcome rather than its monitor hiding a partial
failure. Global/remote account cleanup preserves the independent administrator-console login.

- A suspended/offline screen cannot be remotely erased. It clears after reconnect/foreground
  and a definitive check. Cached/local data is not a remotely erasable storage guarantee.
- A request, stream or push already authorized/dispatched may finish; it cannot be recalled.
- Fresh sign-ins during/after the operation are new sessions. Two external services do not
  offer an atomic “freeze all sign-ins” operation.
- Developer API keys, separate administrator-password/TOTP sessions, external provider grants,
  public/guest resources and published-app capabilities are not Firebase user-device sessions.
  They are not revoked or repurposed here.
- Bundled Android/iOS builds need a separately requested store release for the new controls and
  proactive cleanup. Old installed builds still lose protected server/data access after logout.

## Release and proof

CI runs `scripts/session-revocation-rules.check.mjs` against the locked loopback Firestore
emulator after queue/autopsy drills. Fixtures are synthetic; the script refuses non-loopback
hosts and non-demo projects. Unit/handler tests cover spoofing, same-second boundaries, provider
rollback simulation, partial/uncertain writes, races, UI confirmation/cancellation, bounded
native hangs, all lifecycle triggers, custom-token origins and push privacy.

`cloudbuild.yaml` already deploys Firestore rules as a **mandatory** `deploy-security-rules`
step before moving Cloud Run traffic. Storage publication is separate and optional. Before
calling this feature live, verify the exact commit's rules-step success and Cloud Run revision;
health-SHA alone is insufficient. Newly published rules can take up to a minute for new queries
and up to ten minutes for active listeners to propagate. Allow that rollout observation window;
do not interpret source/emulator success as a live rules receipt. If the pipeline cannot publish
rules with existing permissions, deployment is blocked rather than bypassed with new IAM.

References: [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions),
[Firestore rule deployment and propagation](https://firebase.google.com/docs/firestore/security/get-started),
[dependent-rule document/listener evaluation](https://firebase.google.com/docs/firestore/pricing).

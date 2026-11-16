# Pro Chain V2: contained, not activated

The experimental per-agent chain is retained for isolated mocked development, but production eligibility is disabled for every profile and tier. `PRO_CHAIN_V2`, `PRO_CHAIN_V2_PUBLIC` and `PRO_CHAIN_V2_USERS` cannot enable it. Explicit kill-switch and non-Weak reasons remain; otherwise the policy returns `admission-unavailable`.

The existing App Builder route continues unchanged. Existing AI chat, Qubax chat and Mitrify chat transports are not disabled or modified. This is a code containment change, not evidence of deployment or production configuration.

Before activation, implement and review builder-specific payload/data authorization, destination and credential binding, durable spend admission, immutable supplier price snapshots, exact usage validation and unresolved-accounting handling. Missing usage must not be converted to measured tokens or silently settled as zero. Estimated prices must not be charged as actual supplier cost. Unknown outcomes must not authorize replay or release pending liabilities.

The retained experimental adapters still have known accounting/capability limitations and are not approved for production use. Qubax/Mitrify tool calling has not been verified through live paid calls. Environment flags are not a substitute for these prerequisites. Activation requires a subsequent reviewed code change with exact-tree tests and acceptance evidence.

Validation for this containment: isolated policy tests only. Full repository CI and routing integration checks must be reported separately; no deployment is implied.

This containment applies when a new build context is constructed. It does not cancel already-created V2 contexts or in-flight provider requests. Deployment and handling of any in-flight work are separate operational steps.

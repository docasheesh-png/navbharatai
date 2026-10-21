# Root-local upload success proof

This is a current-code, synthetic regression, not a reconstruction of a retained
build or proof of historical upload delivery.

## Defect and bounded remedy

The legacy upload scanner stands down when any project source contains a storage
marker, including a comment or unused `new FormData()`. That remains the correct
conservative fallback for unknown provider/delegated code, but cannot erase a
separately proved root-local success claim.

`localUploadPath.ts` adds one finite supported case, under standard browser,
React `useState`, and `react-dom/client` semantics:

1. An inert `index.html` contains one empty root div and one module script. The
   optional head contains only simple title/charset/viewport metadata. No CSS,
   import maps, hidden ancestors, extra scripts, or inline event handlers.
2. The entry contains exactly two imports and one direct
   `createRoot(document.getElementById('root')!).render(<Photos />)` call. Imports
   are the real named `createRoot` and the default component in one uniquely
   resolved sibling `.tsx`/`.jsx` file. The component binding starts with an ASCII
   uppercase letter, so JSX invokes it rather than rendering an intrinsic tag.
   No wrappers, props, aliases, or effects.
3. The zero-parameter default-exported function component imports only the real
   named `useState`. It has one initially empty string state, one synchronous
   zero-parameter arrow handler, and one final intrinsic JSX return.
   Strict-module-forbidden bindings stand down even when TypeScript's syntactic
   parser reports no parse diagnostic.
4. The handler consists of exactly one call to that state setter with an anchored
   positive cloud/server success literal. The enabled native upload button binds
   directly to it. The changed state is the entire content of a visible text
   container, not an attribute or a negated/demo-decorated message.
5. Every other supplied file must fit a closed inert source grammar (comments,
   types, static primitive constants, or an unused native `new FormData()`) or
   the small static default-toolchain package/TypeScript metadata grammar.
   Unknown sources/configs, CSS, import rewrites, JSX pragmas, state observers,
   callback props, transport, and delegated events return unknown.

This intentionally does not handle arbitrary application/module graphs, file
readers/previews, custom hooks, real storage clients, or callbacks. A bare or
unused component is unknown, not a proof positive. A real upload, a generic
local-gallery “Upload complete,” and a requested demo retain their existing
stand-downs. Package/dependency replacement and host-injected runtime behavior
are outside the stated standard-runtime assumptions; no live app is executed.

Bounds apply across all supplied files, not the legacy source slice: 32 files,
131,072 characters, 24,000 lexical tokens, 16,000 AST nodes, nesting 64, and an
80 ms cooperative elapsed-time budget. Original supplied characters, including
the canonical generated banner, count before normalization. Parse errors and
budget exhaustion return unknown. The synchronous parser is not preemptible. TypeScript was already a
production dependency; the helper stays server-only and performs no I/O.

## Evidence and disclosure

Only the storage-marker-present branch adds `local-upload-path` evidence. The
legacy missing-provider rule and all other scanner kinds are unchanged. This
finding asks for real upload wiring and confirmation of the result. It neither
claims that no provider exists nor implies that adding keys connects the handler.
Chat, red in-app banner, admin report, implied requirements, and summary-claim
correction preserve that distinction. The file-only write note cannot establish
the root proof and remains unchanged.

The generated red banner is an expected extra script on rescans. For this proof,
only its exact canonical bytes may be removed: bounded string-array JSON and a
supported language are parsed, the single private generator regenerates the
complete block, and the complete block must compare equal in its ordinary final
body position, never inside an attribute, tag name, or text context. No `eval`,
arbitrary script stripping, marker trust, or general HTML sanitization is involved. Mixed
notices remain stable across locales. Public legacy stripping/emission contracts
remain unchanged.

## Sibling census and validation boundary

The one `fakeFeatureScan.ts` owns project marker guards for login, OAuth, payment,
OTP, email, SMS, and upload. Login already has its independent bounded proof;
this change adds only upload. The other five kinds retain their project-wide
stand-downs. `claimAudit.ts` is the sole separate evidence type/consumer; the
production route already forwards the full findings. Tests preserve that route,
legacy guard, dependency boundary, key distinction, and banner bytes.

`aStorageMarkerDoesNotWireLocalUpload.test.ts` covers reachable-root positives,
transport/opaque/alias/shadowing/observer/delegation/visibility/config controls,
source budgets, localized mixed-banner rescans, and canonical-block forgeries.
Existing login and no-fake suites remain required. Offline targeted validation
and reversion demonstrate this finite prevention only, not a hosted release,
historical repair, universal scanner completeness, or a live upload.

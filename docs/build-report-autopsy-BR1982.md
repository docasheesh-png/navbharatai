# Configuration write safety

This document describes synthetic regression coverage, not a customer report. Customer requests, transaction amounts, provider usage totals, identifiers and event chronology are intentionally excluded.

## Scope

- Reject syntactically active conflict markers in supported source/configuration files without rejecting valid strings, comments or documentation.
- Salvage a corrupt configuration tail only when its prefix parses. Preserve valid JSONC comments.
- Restore an absent JSX option only for an explicitly selected Vite React starter. Preserve inherited configurations, custom JSX providers/factories and other frameworks.
- Use the TypeScript JSONC parser so comments and trailing commas do not corrupt quoted strings.

Existing syntax checks, repair handling and compiler validation remain required. Unknown languages are not classified as corrupt merely because they contain marker-looking text. This change does not alter billing, provider routing, sandbox capacity or customer data.

## Validation limits

Focused synthetic tests are not full integrated CI, browser acceptance or deployment evidence. Required exact-tree checks and independent review must pass before merge. No historical customer build is replayed or declared repaired by these fixtures.

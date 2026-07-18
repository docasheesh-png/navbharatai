# NavBharatAI Build Engine — Constitution

## Volume 7 — Semantic Editing Constitution

> **Status:** Binding philosophy for safe software modification — the principles that
> govern *how* an edit is made, above the mechanism used to make it. Inherits Volumes
> 0–6; may never contradict them. Implementation-agnostic and timeless: valid whether a
> future engine edits via text, AST, symbol graph, language server, IR, or a technology
> that does not yet exist.
>
> **Scope discipline (one-fact-one-home, Vol 1 DOC-03).** Most of "semantic editing"
> already lives as **law** in Vol 1 Ch 6 (Editing Laws, EDIT-01…15) and as **capability**
> in Vol 6 (Repository Intelligence). This volume does **not** restate them; it is the
> **philosophy layer** that binds them, adding only the genuinely-new principles
> (meaning-before-text, semantic identity, explainability, reversibility, technology-
> independence) and cross-referencing the rest. A volume that duplicated Ch 6 would be
> the drift this library exists to prevent.
>
> **Honest nuance.** NavBharatAI's edit *mechanism* today is often textual
> (`edit_file` by string match) with deterministic, partly-AST semantic analyzers around
> it. So the principle is not "we edit a pure semantic representation" (we do not, fully)
> — it is: **text is the medium; meaning is the law.** Every textual edit is *governed*
> by meaning — grounded in the whole repository, validated for semantic integrity, and
> reversible. Where deeper pure-semantic editing is not yet built, it is `[ASPIRATIONAL]`.

---

# Part I — The Semantic Editing Philosophy (the genuinely-new framing)

## §1 — Meaning Before Text
> **Software is a semantic system, not a collection of strings. An edit changes
> *meaning*; the text is only its medium. Therefore an edit is judged by what it does to
> the system's meaning — imports, symbols, types, features, contracts — not by whether a
> string was replaced.**

*Why.* A textually-successful edit can be semantically catastrophic (a replaced string
that dangles an import, breaks a type, or removes a feature). Correctness is a property
of meaning, not of the diff.

*How (honest).* Our textual edits are *wrapped* in meaning-preserving guards: grounded in
the full map (VERIFY-10), reconciled for imports/symbols (EDIT-06/07/08), integrity-
checked (Vol 6 C15), and verified downstream (Vol 5 F5). The text changes; the guards
enforce that the *meaning* stays coherent. A pure meaning-level edit representation is
`[ASPIRATIONAL]`; the governing principle is `[LIVE]`.

## §2 — Semantic Identity (new principle)
> **A symbol's identity is its *role in the system* (what it exports, what depends on it,
> what contract it fulfils) — not its name or its file location. An edit must preserve a
> symbol's identity across a rename or a move, or update every dependant in the same
> change.**

*Why.* Treating identity as "the string of the name" is what breaks references on a
rename/move. Treating it as *role* is what keeps the system resolvable.

*Status.* `[LIVE]` for structural identity (a moved/renamed symbol's imports are
reconciled — EDIT-06, wrong-source/mispath fixers); `[ASPIRATIONAL]` for full
role-level identity tracking across a large repo.

## §3 — Two new binding laws for every edit

- **SEM-EXPLAIN — Every edit must be explainable.** An edit carries the *reason* it was
  made (what meaning it changes and why), recorded where the next session can read it.
  *Why:* an unexplainable edit cannot be reviewed, learned from, or safely reverted.
  Extends PLAN-11 to the edit granularity. `[LIVE]` via narration + diagnostics;
  `[ASPIRATIONAL]` for a formal per-edit rationale record.
- **SEM-REVERSIBLE — Every edit must be reversible.** No edit destroys the ability to
  return to the prior meaning: the durable store + history + git checkpoints preserve the
  pre-edit state. *Why:* reversibility is what makes bold editing safe (Vol 5 P1).
  `[LIVE]` (durable undo, guardian, git history). Binds ARCH-05, §24, MEM-13.

## §4 — Technology Independence (timeless clause)
> **These principles bind regardless of the editing technology.** Whether meaning is
> reasoned via string analysis, ASTs, a symbol graph, a language server, an IR, or a
> future technique, the laws (meaning before text, integrity preserved, explainable,
> reversible) hold unchanged. The Constitution governs the *what* and *why* of a safe
> edit; the *how* is free to evolve.

---

# Part II — The 20 Chapters (new = defined here; the rest cross-referenced)

| # | Chapter | Where it lives |
|---|---|---|
| 1 | Semantic Editing Philosophy | **NEW** — §1 |
| 2 | Meaning Before Text | **NEW** — §1 |
| 3 | Repository Context Before Modification | Vol 6 Core Philosophy; EDIT-04, VERIFY-10 (ground in the full map before editing) |
| 4 | Semantic Identity | **NEW** — §2 |
| 5 | Feature-Level Editing | Vol 5 X.2 Traceability + feature-presence (VERIFY-07/08): an edit preserves every requested feature |
| 6 | Symbol-Level Editing | Vol 6 C5 + EDIT-06: a symbol edit keeps every reference resolvable |
| 7 | Cross-File Semantic Integrity | Vol 6 C9 + VERIFY-10: analyze the whole map, never one file |
| 8 | Change Impact Analysis | Vol 6 C12 (`[LIVE]` structural via import reconcile; `[ASPIRATIONAL]` predictive) |
| 9 | Safe Refactoring Principles | Vol 6 C13 + ARCH-05 + §25: additive, behavior-preserving, reversible |
| 10 | Public API Preservation | Vol 6 C12 (`[ASPIRATIONAL]` formal API-diff): an exported contract is not broken silently |
| 11 | Backward Compatibility | §25 non-regression + ARCH-07: an edit never breaks what worked |
| 12 | Semantic Validation | Vol 5 F5 verification net + tsc/integrity gates (`[ASPIRATIONAL]` deep semantic validation) |
| 13 | Edit Safety Guarantees | Vol 1 Ch 6 (EDIT-01/02/05/10/12) + Vol 6 C13 — the safety discipline in full |
| 14 | Rollback Principles | **NEW** — SEM-REVERSIBLE §3; durable undo + history + git |
| 15 | Merge Safety | git flow + union reconcile + shrink-guard (`[ASPIRATIONAL]` semantic merge) |
| 16 | Conflict Resolution | union-not-subtract reconcile + shrink-guard (MEM-02/05); loud stale-match (EDIT-10) (`[ASPIRATIONAL]` semantic conflict resolution) |
| 17 | Semantic Regression Prevention | TEST-05 full-suite + analyzer suite green + §25 |
| 18 | Refactoring Safety | = Chapter 9 (consolidated — one home) |
| 19 | Repository Integrity Preservation | Vol 6 + EDIT-01: an edit never corrupts the repository |
| 20 | Constitutional Anti-Patterns | **NEW** — Part V |

---

# Part III — Constitutional Laws (the semantic-editing binding set)

The ten required guarantees, each bound to its law (new laws defined above; the rest
cross-referenced, not restated):

| Guarantee | Law |
|---|---|
| Meaning before text | §1 (SEM philosophy) |
| Repository understanding before editing | EDIT-04, VERIFY-10, Vol 6 Core |
| No isolated edits | VERIFY-10, Vol 6 C9 |
| Preserve architectural intent | PLAN-02, ARCH-02, Vol 6 C10 |
| Preserve feature integrity | VERIFY-07, Vol 5 X.2 |
| Preserve public contracts | Vol 6 C12 (`[ASPIRATIONAL]` formal), ARCH-02 |
| Preserve semantic consistency | EDIT-06/07/08, §2 semantic identity |
| Preserve repository coherence | ARCH-02, EDIT-01, Vol 6 |
| Every edit explainable | **SEM-EXPLAIN** §3 |
| Every edit reversible | **SEM-REVERSIBLE** §3 |

---

# Part IV — Failure Prevention (mapped to mechanisms)

| Failure | Prevention | Status |
|---|---|---|
| **old_string_not_found** | a stale-match edit fails **loudly** with the current file content — never a silent no-op (EDIT-10) | `[LIVE]`; anchor/unique-line re-match on failure `[ASPIRATIONAL]` |
| **Wrong-file edits** | full-map grounding + content retrieval before editing (Vol 6 C2/C5) | `[LIVE]` |
| **Duplicate implementations** | duplicate-entry + duplicate/orphan-stylesheet checks; centralize one-source-of-truth (ARCH-02, Vol 6 C15) | `[LIVE]` (entry/stylesheet); general `[ASPIRATIONAL]` |
| **Broken imports** | deterministic import reconcile / wrong-source / mispath fixers (EDIT-06/08) | `[LIVE]` |
| **Broken symbols** | reference reconcile on move/rename (§2, EDIT-06) | `[LIVE]` structural |
| **Broken types** | incremental tsc gate + endgame fixers (C6) | `[LIVE]` |
| **Merge conflicts** | union reconcile + shrink-guard (MEM-02/05) | `[LIVE]` structural; semantic merge `[ASPIRATIONAL]` |
| **Repository corruption** | never destroy source; single-flight checkpoints; idempotent writes (EDIT-02, REL-11) | `[LIVE]` |
| **Context drift** | durable truth as shared memory; union reconcile (MEM-01/05) | `[LIVE]` |
| **Cross-file regressions** | full-map analysis + full test/analyzer suite green (VERIFY-10, TEST-05) | `[LIVE]` |
| **Hidden semantic side effects** | orphan-stylesheet + integrity checks catch some; general side-effect analysis | `[LIVE]` partial; general `[ASPIRATIONAL]` |

---

# Part V — Constitutional Anti-Patterns (forbidden by principle)

- **The blind string replace** — editing a string without grounding in the whole map or
  validating the meaning it changed (violates §1, VERIFY-10).
- **The silent no-op edit** — an edit that "succeeded" but changed nothing because the
  match was stale (forbidden by EDIT-10 — it must fail loudly).
- **The rename that dangles references** — changing a name without updating its
  dependants (violates §2).
- **The isolated edit** — reasoning about one file as if the repository did not exist
  (violates "no isolated edits").
- **The irreversible edit** — a change that destroys the path back to the prior meaning
  (violates SEM-REVERSIBLE; the destructive-source-delete block enforces it).
- **The unexplainable edit** — a change with no recorded reason (violates SEM-EXPLAIN).
- **The silent contract break** — changing a public/exported contract without preserving
  or announcing it (violates Public-API preservation).
- **The behavior-changing "refactor"** — a refactor that alters behavior untested
  (violates §25 non-regression).

---

# Part VI — Complexity Gating (reuses the Planning Budget)

Semantic reasoning depth scales with complexity, using the **same objective signals** as
the Planning Budget (Vol 5 Framework 2) and repository-analysis tiers (Vol 6 Part V) —
not a new taxonomy:

- **Simple change** → lightweight semantic reasoning (the deterministic guards + tsc are
  enough). `[LIVE]`
- **Complex repository** → deeper reasoning (full-map analysis, symbol graph, integrity
  suite). `[LIVE]` partial.
- **Enterprise** → a repository-wide semantic model with continuous updates.
  `[ASPIRATIONAL]`

**Binding rule (Least-Power, PLAN-06):** *avoid unnecessary semantic analysis for a
simple change.* Deep semantic reasoning on a one-line edit is over-analysis — a defect,
exactly like over-planning. Depth is earned by the signals, never applied by default.

---

# Closing

NavBharatAI edits **meaning, governed through text**: it grounds every change in the
whole repository, preserves import/symbol/type/feature/contract integrity, makes each
edit explainable and reversible, and scales its semantic reasoning to the change's real
complexity. Text is the medium the engine happens to use today; the *law* it obeys is
meaning — and that law holds regardless of whether tomorrow's engine edits via AST,
symbol graph, language server, IR, or something not yet invented.

Where a capability is `[ASPIRATIONAL]` (a pure meaning-level edit representation, formal
predictive impact analysis, public-API diffing, semantic merge/conflict resolution, deep
semantic validation, an enterprise repository-wide semantic model), it is named honestly
as a target, and its absence is compensated by the downstream verification net (Vol 5
Framework 5) until it is `[LIVE]`. The engine never claims a semantic guarantee it has
not built.

When an edit's safety is unclear, resolve by the one editing invariant — meaning before
text, the whole before the part, reversible always; when a modification is genuinely
destructive or irreversible, the human admin decides; and in every tie, the Prime Law
governs — **truth is the product, trust is the treasure.**

---

*Volume 7 of the NavBharatAI Build Engine Constitution. Implementation-agnostic;
descriptive-first and code-anchored where marked `[LIVE]`; inherits Volumes 0–6;
amendments follow the engine's own discipline (branch → PR → CI green → merge).*

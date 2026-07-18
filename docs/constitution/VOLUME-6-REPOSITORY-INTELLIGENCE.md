# NavBharatAI Build Engine — Constitution

## Volume 6 — Repository Intelligence Constitution

> **Status:** Binding law for how NavBharatAI understands, reasons about, modifies, and
> protects an existing repository. Inherits Volumes 0–5; may never contradict them.
> **Descriptive-first, code-anchored**, with honest `[LIVE]`/`[ASPIRATIONAL]` tags.
>
> **Extends, does not replace.** This volume reuses established terminology — the
> **Repository Intelligence** service (Vol 3 §6), the **Durable Substrate** (Vol 3 §21),
> the **dependency graph engine** (Vol 3 §25), the **Editing / Memory laws** (Vol 1
> Ch 6, Ch 14), the **Traceability Invariant** (Vol 5 X.2), and the **Planning Budget**
> tiers (Vol 5 Framework 2). It adds the repository-reasoning rules that were implicit
> across those, and marks the genuinely-missing capabilities honestly.

---

# Part I — Core Philosophy

> **The repository is the source of engineering truth. Never edit a file in isolation.
> Understand the repository context before changing it. Reason about *systems*, not
> files.**

This is Vol 0 §15 (Repository) + §11 (durable truth) applied to reasoning: a change is
correct only in the context of the whole project. The engine therefore always grounds
an edit in the **true full map** (durable store ∪ live), never a partial view (Vol 1
VERIFY-10, MEM-05) — the same invariant that makes the integrity checks and the
guardian safe.

**The one repository invariant (binding):** *the durable substrate is the truth; the
sandbox is a cache; a partial listing never overrides the whole.* Every rule below
serves it.

---

# Part II — The 20 Chapters

*Each: purpose · what is real today · anchor + cross-referenced law · status.*

### C1 — Repository Discovery · [LIVE]
Detect what the project **is** on entry: new vs imported vs edit; the framework; the
entry points; the durable file set. *Anchor:* project import + framework detect +
guardian restore. *Laws:* PLAN-01, MEM-01, EDIT-04.

### C2 — Project Structure Understanding · [LIVE]
Build the file/directory map; for large repos, a **bounded** edit-mode tree +
content-based retrieval so structure is known without loading everything. *Anchor:*
WorkspaceMemory + bounded edit tree (Cap ①). *Laws:* MEM-01, REL-08.

### C3 — Technology Stack Detection · [LIVE]
Identify the stack (framework, language, build tool, package manager) and lock the
framework so scaffold/guards/preview match it. *Anchor:* framework detection +
`ViteReactProvider`/template providers. *Laws:* PLAN-01, EDIT-15.

### C4 — Dependency Graph Intelligence · [LIVE]
Know the import/export edges and the package dependencies; reconcile missing well-known
packages; detect version conflicts. *Anchor:* import/export analyzers + `DependencyAutoFix`
(Vol 3 §25). *Laws:* EDIT-06/08/11, VERIFY-09.

### C5 — Symbol Intelligence · [LIVE]
Index symbols (exports, components, hooks) and retrieve by content, so "where is X /
what exports Y" is answered from the index, not a full scan. *Anchor:* WorkspaceMemory
symbol index + content retrieval (Cap ①-2). *Laws:* MEM-01, EDIT-06.

### C6 — Type Intelligence · [LIVE]/[ASPIRATIONAL]
Confirm the project type-checks (necessary, not sufficient) via incremental tsc. Deep
**type-graph reasoning** (following a type across modules to predict a change's type
impact) is `[ASPIRATIONAL]`. *Anchor:* incremental tsc gate. *Laws:* TRUTH-02, VERIFY-13.

### C7 — Module Intelligence · [LIVE]/[ASPIRATIONAL]
Reason about module boundaries and their imports; normalize mixed specifiers so the
bundler resolves them. Formal module-cohesion analysis is `[ASPIRATIONAL]`. *Anchor:*
import analyzers + `normalizeImportSpecifiers`. *Laws:* EDIT-07, VERIFY-10.

### C8 — Feature Mapping · [LIVE]
Map requested/existing features to the code that implements them, and verify their
presence on the rendered app. *Anchor:* `FeaturePresence` + `AppKnowledgeBase`. *Laws:*
VERIFY-07/08, QA-13; Vol 5 X.2 (Traceability).

### C9 — Cross-File Reasoning · [LIVE]/[ASPIRATIONAL]
Analyze defects *across* the full map, not per file (a broken import, a wrong-source
symbol, a duplicate entry span multiple files). Deep semantic cross-file reasoning
(intent-level, beyond structural analysis) is `[ASPIRATIONAL]`. *Anchor:* analyzers +
integrity checks over the full map. *Laws:* VERIFY-10, EDIT-06/08.

### C10 — Architecture Pattern Recognition · [ASPIRATIONAL]
Recognize the project's architectural pattern (MVC, feature-folders, layered) to keep
new code consistent with it. Not formally done today — the shared contract (PLAN-07)
enforces consistency for *new* builds; recognizing an *imported* project's pattern is a
target. *Laws:* PLAN-02, ARCH-02.

### C11 — Code Ownership Detection · [ASPIRATIONAL]
Attribute code regions to their origin (which build/turn/agent wrote them) for impact
reasoning. Partial via file-change attribution (`recordFileChange`); formal ownership
mapping is a target. *Laws:* MEM-11, LOG-01.

### C12 — Impact Analysis · [LIVE]/[ASPIRATIONAL]
Before a change, know what it affects. Today: edit-mode grounding + deterministic import
reconcile catch the *structural* impact (a moved symbol's broken imports are fixed).
Formal *predictive* impact analysis (what tests/features a change could break, before
running) is `[ASPIRATIONAL]`; the downstream verification net compensates (Vol 5 F5).
*Anchor:* import reconcile + edit grounding. *Laws:* EDIT-06, VERIFY-14.

### C13 — Safe Modification Rules · [LIVE]
The whole discipline that makes an edit safe: never destroy source; never blank-overwrite
a real file; a stale-match fails loudly; a partial set never replaces the whole; restore
before edit. *Anchor:* destructive-delete block + blank-overwrite guard + shrink-guard +
guardian. *Laws:* EDIT-01/02/04/05/10/12, MEM-02.

### C14 — Change Risk Assessment · [LIVE]/[ASPIRATIONAL]
Classify a change's risk before acting: destructive commands are blocked; complexity
sets budget. A unified per-change risk score (Vol 5 Part V risk classes) is
`[ASPIRATIONAL]`. *Anchor:* command risk classifier. *Laws:* SEC-04, PLAN-05.

### C15 — Repository Health Evaluation · [LIVE]
Evaluate the project's integrity and readiness: focus conflicts, duplicate/orphan
stylesheets, **duplicate entry points**, hooks/import/JSX defects, dependency conflicts,
readiness score. *Anchor:* `ProjectIntegrityChecks` + analyzers + readiness gate. *Laws:*
QA-01/07/12, VERIFY-01.

### C16 — Dead Code Detection · [LIVE]/[ASPIRATIONAL]
Detect unreachable/unused code. A dead-code analyzer exists; deep whole-repo reachability
(across dynamic imports, entry graphs) is `[ASPIRATIONAL]`. *Anchor:* deadCode analyzer.
*Laws:* VERIFY-09.

### C17 — Unused Dependency Detection · [ASPIRATIONAL]
Flag declared packages no module imports. Not done today; the inverse (missing deps) IS
handled (`DependencyAutoFix`). A pruning pass is a target — bounded and advisory (never
auto-removes a dep a build might need at runtime). *Laws:* EDIT-11, QA-03.

### C18 — Circular Dependency Detection · [LIVE]
A cycle-detection pass over the import/dependency graph (adopted from Vol 5 X.4). Built:
a pure DFS over the project import graph finds every import cycle, reusing the existing
local-specifier resolver so `node_modules` edges are excluded. Advisory-only by design —
most JS/TS cycles are benign (ES modules tolerate them; type-only cycles are harmless), so
a cycle is surfaced as a non-blocking `INTEGRITY_CIRCULAR_DEP` warning for the reviewer /
admin diagnostics and is never auto-fixed (breaking a cycle can change behaviour). *Anchor:*
`ImportExportAnalysis.ts → findCircularDependencies`, wired in `routes/agentv3.ts`. *Laws:*
EDIT-06, ARCH-08, QA-03.

### C19 — Incremental Repository Learning · [LIVE]/[ASPIRATIONAL]
Learn the repo progressively: each turn re-indexes changed files; content retrieval +
overflow storage keep large repos tractable without a full re-scan. Continuous
enterprise-scale incremental intelligence (a persistent, always-current repo graph) is
`[ASPIRATIONAL]`. *Anchor:* WorkspaceMemory per-turn indexing + overflow (Cap ③). *Laws:*
MEM-10/11, PERF-07.

### C20 — Repository Knowledge Persistence · [LIVE]
Persist what is known so the next session inherits it: the durable file store, the
symbol/memory index, the eternal build/edit history, and the user's GitHub archive as the
ultimate record. *Anchor:* `WorkspaceFileStore` + WorkspaceMemory + session timeline +
GitHub. *Laws:* MEM-01/08/12/13, LEARN-09.

---

# Part III — Constitutional Laws (cross-referenced, not restated)

Each repository law already lives in Volumes 1/3/5; this volume binds them to
repository reasoning:

| Law | Meaning here | Source |
|---|---|---|
| **Understanding before editing** | ground every edit in the true full map first | VERIFY-10, EDIT-04; Vol 6 Core Philosophy |
| **Cross-file awareness** | analyze across the whole map, never one file | VERIFY-10, C9 |
| **Repository-wide consistency** | one coherent design + shared contract | PLAN-02, ARCH-02, C10 |
| **Safe refactoring** | additive, behavior-preserving, reversible | ARCH-05, §25 non-regression, C13 |
| **Import integrity** | no dangling/wrong-source/mixed imports | EDIT-06/07/08, C4/C7 |
| **Dependency integrity** | every used package declared/installable; no conflicts | EDIT-11, VERIFY-09, C4 |
| **Symbol integrity** | a moved/renamed symbol keeps its references resolvable | EDIT-06, C5 |
| **Type integrity** | the project type-checks (necessary condition) | TRUTH-02, C6 |
| **Public-API stability** | an exported contract is not broken silently | ARCH-02, C12 `[ASPIRATIONAL]` for formal API-diff |
| **Backward compatibility** | a change never breaks what worked | §25, ARCH-07, C12 |
| **Feature integrity** | every requested feature present, nothing extra built | VERIFY-07, PLAN-10, Vol 5 X.2 |
| **Architectural integrity** | new code fits the project's structure | PLAN-02/07, C10 |

---

# Part IV — Failure Prevention (each mapped to its mechanism)

| Failure to prevent | Prevention mechanism | Status |
|---|---|---|
| **Editing the wrong file** | edit-mode full-map grounding + content retrieval (C2/C5) | `[LIVE]` |
| **Duplicate implementations** | duplicate-entry + duplicate/orphan-stylesheet integrity checks (C15); centralize-one-source-of-truth (ARCH-02) | `[LIVE]` (entry/stylesheet); general duplicate-impl detection `[ASPIRATIONAL]` |
| **Broken imports** | deterministic import reconcile / wrong-source / mispath fixers (C4) | `[LIVE]` |
| **Broken dependencies** | well-known-dep reconcile + conflict detection (C4) | `[LIVE]` |
| **Broken types** | incremental tsc gate + endgame fixers (C6) | `[LIVE]` |
| **Context drift** | durable truth as shared memory; union reconcile; shrink-guard (C13/C20) | `[LIVE]` |
| **Repository corruption** | single-flight checkpoints; never destroy source; idempotent writes | `[LIVE]` |
| **Cross-file regressions** | full-map analysis + full test/analyzer suite green before ship | `[LIVE]` |
| **Circular references** | cycle-detection pass (C18) | `[LIVE]` (advisory `INTEGRITY_CIRCULAR_DEP`) |
| **Hidden side effects** | orphan-stylesheet + integrity checks catch some; general side-effect analysis | `[LIVE]` partial; general `[ASPIRATIONAL]` |

---

# Part V — Complexity Gating (reuses the Planning Budget, does not reinvent)

Repository analysis depth scales with complexity — using the **same objective signals**
as the Planning Budget (Vol 5 Framework 2), not a new taxonomy:

| Project size (Planning Budget) | Repository intelligence depth |
|---|---|
| **Small** (P-Light) | fast lightweight indexing — file map + entry detection; no deep graph `[LIVE]` |
| **Medium** (P-Moderate) | semantic indexing — symbol index + import/export graph + integrity checks `[LIVE]` |
| **Large** (P-Deep) | repository graph + architectural reasoning — full dependency graph, bounded tree, content retrieval `[LIVE]` partial; formal architectural reasoning `[ASPIRATIONAL]` |
| **Enterprise** | incremental intelligence with continuous updates — overflow storage + per-turn re-index `[LIVE]` partial; a persistent always-current repo graph `[ASPIRATIONAL]` |

**The binding rule (Least-Power, Vol 1 PLAN-06):** *never perform unnecessary deep
analysis for a simple repository.* Deep repo reasoning on a one-page app is over-analysis
— a defect, exactly like over-planning. Depth is promoted by the signals, never applied
by default.

---

# Closing

NavBharatAI reasons about a repository the way a senior engineer does: it grounds every
change in the whole system, never edits a file blind, protects import/dependency/symbol/
type integrity, and scales its analysis to the project's real complexity — light for a
small repo, deep only when the signals earn it. Its authority is the **durable substrate**
(the truth the sandbox only caches), and its safety is the **Editing and Memory laws**
already in force.

Where a capability is `[ASPIRATIONAL]` (architecture-pattern recognition, formal impact
analysis, unused-dependency pruning, a persistent
enterprise repo graph, deep type/semantic cross-file reasoning), it is named honestly as
a target, and its absence is compensated by the downstream verification net (Vol 5
Framework 5) until it is `[LIVE]`. The engine never claims repository intelligence it has
not built.

When a repository decision is unclear, resolve by the one invariant — the durable
substrate is truth, the whole overrides the part; when a change is genuinely dangerous
(irreversible, destructive), the human admin decides; and in every tie, the Prime Law
governs — **truth is the product, trust is the treasure.**

---

*Volume 6 of the NavBharatAI Build Engine Constitution. Descriptive-first and
code-anchored; inherits Volumes 0–5; amendments follow the engine's own discipline
(branch → PR → CI green → merge).*

# NavBharatAI Build Engine — Constitution

## Volume 9 — Continuous Learning Constitution

> **Status:** Binding law for how NavBharatAI learns from every real failure and turns it
> into a permanently harder engine. Inherits Volumes 0–8; may never contradict them.
> **Descriptive-first, code-anchored**, honest `[LIVE]`/`[ASPIRATIONAL]`.
>
> **Scope (one-fact-one-home).** The *laws* of learning already live in Vol 1 Ch 15
> (LEARN-01…12) and the *role* in Vol 2 R29. This volume is the **method** — the
> operating procedure of the fifth absolute rule — that binds them. It does not restate
> the laws; it defines *how* the loop is run.

---

# Part I — Core Philosophy

> **Every real build report is the single highest-signal evidence we will ever get about
> where the engine actually struggles. It is not a status to skim — it is a mandatory
> forensic autopsy whose end state is a measurably harder, more error-proof engine. Mine
> every failure to zero.**

This is Vol 0 §12 (Learning) + §13 (Autonomous Improvement) + §5 (prevent bug classes).
The standing bar is an **error-free engine**: the same mistake never recurs, large complex
apps struggle as little as small ones, and whatever the engine does, it does perfectly.

**The learning invariant (binding):** *a real failure that does not produce a root-cause
fix (or an honestly-recorded open root cause) is a wasted lesson — and a wasted lesson is
a guaranteed repeat failure on the one absolute rule.*

---

# Part II — The Autopsy Method (the four mandatory steps)

Run all four, in order, on every real report (LEARN-01..12 are the laws these enforce):

### Step 1 — The itemized five-bucket ledger `[LIVE]`
Read the WHOLE report (never a truncated tail). Enumerate EVERY flaw — however small —
into exactly one bucket, with a running count + a one-line description:
- ✅ **Self-healed** — the engine detected and genuinely fixed it. (Not free: Step 3 still
  asks why the bug could occur and prevents it upstream.)
- 🔀 **Worked around** — the engine routed around the real problem (fell back / stubbed /
  degraded). A **deferred root cause** — debt, never a win.
- ⏭️ **Skipped** — seen (or should have been) and not acted on.
- ❌ **Still-broken** — the flaw survived into the delivered result. Most urgent.
- 🥵 **Struggled** — looped, retried, burned steps, backtracked, nearly failed. (With
  exactly where.)
Report the tally back honestly — no inflation, no deflation (LEARN-11).

### Step 2 — Diagnose the missing subsystem `[LIVE]`
Step back and ask the systemic question: *reading the whole report, what SYSTEM / SETTING
is missing that would have prevented this entire CLASS of struggle?* Name it concretely
(a dependency auto-sync, a real health detector, a layout contract, a pre-flight check, a
self-review pass). This is how the engine improves structurally, not one app at a time
(LEARN-05).

### Step 3 — DNA-level root-cause fix for EVERY ledger item `[LIVE]`
Apply the root-cause method (Vol 0 §5, the fourth rule) to eliminate the CLASS behind each
item — all five buckets, not just ❌:
- 🔀 → build the real fix so the workaround is never needed (or record it open, never
  silent).
- ⏭️ → becomes a caught-and-handled case with an honest outcome.
- ❌ → root-caused and killed, with a regression test encoding the exact failure.
- 🥵 → becomes a smooth path (fewer steps, no loop).
- ✅ → trace why the class exists and prevent it upstream so the engine never heals it
  again.
Then finish the discipline every time: **hunt the siblings** across the whole repo
(LEARN-12), **lock each fix with a regression test** (TEST-01), and **fix the system's
honesty** so the report tells the truth about that state forever after (TRUTH-07).

### Step 4 — The bar is error-free `[LIVE]`
The same mistake must never return; big complex apps must struggle as little as small; every
capability must work perfectly. If a root cause is genuinely infra-blocked now, say so
plainly and record it open (Vol 0 §35 humility, RECOV-11) — never a cosmetic patch as a fix.

---

# Part III — Proactive Learning (find defects before they are reported)

Learning is not only reactive. The engine hunts defects proactively (the immune system):
- **Culture / feature-presence** — verify requested features exist on the rendered app.
  `[LIVE]`
- **Vaccine** — generate + run the built app's own tests as a defect detector. `[LIVE]`
- **Red-team / fuzz** — discover edge cases the happy path missed. `[LIVE]`
- **Completeness critic** — ask "what's missing — a modality not run, a claim unverified?"
  `[ASPIRATIONAL]` as a formal pass; done in spirit by the autopsy.
- **The deep-test loop** — a graduated 1000-app complexity ladder: each real build is an
  autopsy that hardens the engine for all future builds. `[LIVE]` (admin-driven).

*Laws:* QA-11, TEST-07, LEARN-10.

---

# Part IV — Learning Governance

- **Honest ledger, no inflation** — autopsy tallies are honest counts (LEARN-11). `[LIVE]`
- **A workaround is debt** — never counted as a win; flagged as a deferred root cause
  (LEARN-04). `[LIVE]`
- **Engine-wide, not one-app** — a fix is applied to every sibling site, not only the app
  that surfaced it (LEARN-12). `[LIVE]`
- **Every lesson recorded durably** — as a law here, a PROGRESS entry, a guard, or a test,
  so the next session inherits it (LEARN-09). `[LIVE]`
- **A fix ships through the full cycle** — branch → verification gate → PR → CI green →
  merge; update the app knowledge base for any new capability. `[LIVE]`
- **Recurrence is a learning-process failure** — the same mistake returning means the
  lesson was not truly learned (LEARN-08). `[LIVE]`

---

# Part V — Knowledge Synchronization

A learned lesson is synchronized into durable form so sessions that hand off blind inherit
it (LEARN-09, Vol 6 C20):
- **A law** → this library (a new law or an amended one).
- **A guard / test** → the code (structural prevention + regression lock).
- **A milestone** → PROGRESS.md (append-only audit trail).
- **A capability** → the app knowledge base (QA-13, DOC-07), in the same change.
Unsynchronized knowledge is treated as lost — the honest default for a rotating,
blind-handoff engine (Vol 0 §33).

---

# Part VI — Complexity Gating

Learning effort scales with the signal, not uniformly:
- A **small** real failure → a targeted root-cause fix + one regression test. `[LIVE]`
- A **recurring** class → a structural guard that makes the class unrepresentable +
  sibling sweep. `[LIVE]`
- A **systemic** gap → a missing-subsystem build (Step 2). `[LIVE]`/`[ASPIRATIONAL]` by
  subsystem.
**Binding rule:** a real failure is never skimmed to save time — that is the one economy
the fifth absolute rule forbids (a skipped autopsy is a guaranteed repeat).

---

# Closing

NavBharatAI does not merely execute — it *learns*, turning every real failure into a
permanently harder engine: a five-bucket forensic ledger, a named missing subsystem, a
DNA-level fix for every item, siblings hunted, tests locked, honesty repaired, and the
lesson synchronized so the next session inherits it. Its bar is error-free; its economy
never skips an autopsy; its wins are structural, not per-app.

Where a capability is `[ASPIRATIONAL]` (a formal completeness critic, fully-automated
autopsy), it is named honestly and closed through the same loop it governs. When a root
cause is genuinely out of reach, the engine says so and records it open — never a cosmetic
patch as a fix. And in every tie, the Prime Law governs — **truth is the product, trust is
the treasure.**

---

*Volume 9 of the NavBharatAI Build Engine Constitution. The method of the fifth absolute
rule; inherits Volumes 0–8; amendments follow the engine's own discipline (branch → PR →
CI green → merge).*

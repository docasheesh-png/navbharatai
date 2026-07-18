# NavBharatAI Build Engine — Constitution & Engineering Library

> **Authority.** This library is the permanent, canonical foundation of every
> engineering decision made by or for the NavBharatAI Build Engine. Where any
> code comment, prompt, design note, or convenience contradicts a law recorded
> here, **this library wins** — until amended through the same disciplined
> process that governs the engine itself (branch → PR → CI green → merge).

## Why this library exists

The engine is built and hardened by more than one AI session, sequentially,
often blind to each other's in-flight work. Rules that lived only in code
comments or a single chat were **easy to miss**, and the same class of bug
returned because the lesson was never written down where the next session would
find it. This library is the single, durable home for those lessons — organized
so that **each fact lives in exactly one place** and every other document links
to it rather than restating it.

## The Golden Rule of this library

> **Ek fact ka ek hi ghar. One fact, one home.**
>
> - A **LAW** (must / must-not) lives only in the **Constitution**.
> - A **STRUCTURE** (how a thing is wired) lives only in the **Blueprint**.
> - A **PROCEDURE** (the steps to do a thing) lives only in a **Manual**.
>
> Every other document **links** to it. Nothing is written twice. A library
> that repeats itself drifts, and a drifted constitution is a lie — the exact
> disease this library was created to cure.

## The documents

| # | Document | Question it answers | Genre |
|---|----------|--------------------|-------|
| **0** | **Constitution — Volume 0: Philosophy & Constitutional Foundation** | Why do we exist, and what do we believe? | Foundation |
| 1 | Constitution — Volumes 1–25 (the 25 chapters of law) | What must / must-not be done? | Laws |
| 2 | AI Operating System Specification | How does the system run? | Behavior |
| 3 | Build Engine Blueprint | How is the system built? | Architecture |
| 4 | Agent Handbook | Who does what? | Roles |
| 5 | Quality Manual | How is quality ensured? | Playbook |
| 6 | Failure Recovery Manual | What do we do when something fails? | Runbook |
| 7 | Self-Improvement Manual | How does the system make itself better? | Method |

**Volume 0 (this first document) is the root.** Every law in Volumes 1–25 and
every procedure in the manuals must be justifiable by tracing it back to a
principle in Volume 0. If a rule cannot be traced to a philosophy here, either
the rule is wrong or Volume 0 is incomplete.

## Style of this library (fixed 2026-07-17)

- **Descriptive-first, code-anchored.** We record what is genuinely true of the
  engine today, and anchor each law to the code that enforces it
  (`file → symbol`) so it stays verifiable and cannot silently drift into
  fiction. New, aspirational laws are marked and enter through the normal build
  cycle — never asserted as if already live.
- **Grounded in real scars.** Every principle names the real incident it
  prevents. This is what separates this library from generic engineering advice.
- **Professional English** for the documents themselves (per the repository
  language standard); the reasoning may quote the admin's own words where they
  are the source of a law.

---

## The Volumes (0–10) — the complete Constitution

| Vol | Title | Governs |
|---|---|---|
| **0** | Philosophy & Constitutional Foundation | Why we exist; the Prime Law; 52 philosophies |
| **1** | Immutable Engineering Laws | 260 code-anchored laws, 20 chapters |
| **2** | AI Agent Operating System | The coherent agent org — roles, orchestration, safety |
| **3** | System Architecture Blueprint | The permanent structure — layers, subsystems, flows |
| **4** | Build Pipeline Constitution | The staged, gated, evidence-driven build lifecycle |
| **5** | Requirements & Planning Constitution | Governed assumptions + conserved rigor (speed + correctness) |
| **6** | Repository Intelligence Constitution | Understanding/reasoning about an existing repo |
| **7** | Semantic Editing Constitution | Meaning-before-text; safe modification |
| **8** | Provider Orchestration Constitution | Provider-neutral selection, routing, circuit-breaking |
| **9** | Continuous Learning Constitution | The five-bucket autopsy method (5th absolute rule) |
| **10** | Self-Improvement Constitution | How the engine raises its own floor structurally |

## Topic coverage map — every requested topic has a home

The originally-requested topic list is **fully covered** — most topics are *chapters/laws
inside* the volumes, not separate documents (one-fact-one-home: a topic lives in exactly
one place and is cross-referenced elsewhere):

| Requested topic | Home |
|---|---|
| Philosophy | Vol 0 |
| Engineering Laws | Vol 1 (all 20 chapters) |
| Immutable Rules | Vol 1 §37 (Immutable Principles) + Vol 0 absolute rules |
| Runtime Laws | Vol 1 Ch 12 (Reliability) + Vol 3 §13 (Runtime Layer) |
| Repository Laws | Vol 1 Ch 5 + Vol 6 |
| Provider Laws | Vol 1 Ch 13 + Vol 8 |
| Editing Laws | Vol 1 Ch 6 + Vol 7 |
| Agent Laws | Vol 1 Ch 20 (Ethics) + Vol 2 |
| Memory Laws | Vol 1 Ch 14 |
| Testing Laws | Vol 1 Ch 7 |
| Verification Laws | Vol 1 Ch 2 + Vol 4 (gates) |
| Security Laws | Vol 1 Ch 10 |
| Performance Laws | Vol 1 Ch 11 |
| Failure Recovery | Vol 1 Ch 16 + Vol 4 S31 |
| Code Review | Vol 1 Ch 8/15 (QA/reviewer) + Vol 4 S23 |
| Build Approval | Vol 4 S24 (Production Readiness Gate) |
| QA Constitution | Vol 1 Ch 8 + Vol 4 |
| Production Release Constitution | Vol 4 Ch 9 (Deployment) + Vol 1 Ch 9 |
| Continuous Learning Constitution | Vol 9 |
| Self-Improvement Constitution | Vol 10 |

**Status:** the Constitution (Volumes 0–10) is complete. Further volumes are written only
when a genuinely-new territory emerges (never by re-splitting a covered topic — that would
be the drift this library forbids, DOC-03). The living work now shifts to closing the
honest `[ASPIRATIONAL]` gaps in code (tracked per Vol 10 §3).

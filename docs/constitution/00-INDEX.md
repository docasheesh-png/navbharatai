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

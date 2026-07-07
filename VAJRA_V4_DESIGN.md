# VAJRA — NavBharatAI v4.0 Engine Design (वज्र: अटूट)

**Mandate (admin, 2026-07-07):** "Sabki acchi cheez lekar apna new system banao — in sab se inspire,
in sab se accha." This document is the blueprint. Every pillar names its inspiration, what we take,
and what we do BETTER. Supersedes nothing in v3.0 — VAJRA is v3.0's proven core re-housed on
unbreakable foundations. The 24 root-cause fixes of 2026-07-06/07 (PROGRESS.md) are its birth
certificate: each pillar kills one of the classes we bled from.

## The five pillars

### 1. NIRMAN WORKERS (निर्माण) — builds that nothing can kill
*Inspired by: Replit's persistent workspaces + every serious platform's job-queue architecture.*
- Builds move OUT of the web-serving process into detached workers (Cloud Run Jobs, or a second
  min-instances service consuming a Firestore `build_jobs` queue).
- The worker streams every event into Firestore (`build_events/{buildId}`); the web tier and every
  client just SUBSCRIBE. A deploy, a network cut, a closed phone — the build never notices; any
  client reattaches to the event stream at any time.
- Kills forever: deploy-kills-build, network-cut "sab gayab", stall-watchdog false deaths.
- Better than them: the event stream doubles as the build-diagnostics report (we already have the
  richest forensic record in the industry — it becomes the transport, not an afterthought).
- Migration: Phase A = graceful drain + client auto-resume (already the recorded next task);
  Phase B = the queue + worker split.

### 2. BROWSERBOX (ब्राउज़र-बॉक्स) — the preview that cannot die
*Inspired by: Bolt/StackBlitz WebContainers (Node in the browser).*
- Phase A (no licensing, ship first): esbuild-wasm in-browser bundler behind a Service Worker —
  real npm-package resolution (CDN-backed), real multi-file bundling, HMR-ish reload — replacing
  the babel-iframe compiler. MIT-licensed, zero server dependency.
- Phase B (evaluate): WebContainers/Nodebox commercial license for full Node-in-browser (real
  servers/SSR in the tab) — decision gate: only if Phase A leaves real gaps.
- E2B remains the FULL-FIDELITY tier (real backends, databases, deploys) — optional, never load-bearing
  for frontend apps (admin: "e2b ke bina kaam chal jaye").
- Kills forever: Closed-Port idle-death as a user-facing failure; preview-empty-state classes.

### 3. SMRITI INDEX (स्मृति) — surgical context at any repo size
*Inspired by: Cursor's embeddings retrieval; Replit's repo-maps; Aider's tree-sitter maps.*
- Embed every durable file (Vertex text-embeddings, stored beside workspace_files_v3); retrieval
  replaces ranked-grep grounding for repos over N files. The model NEVER sees the repo — only the
  top-k slices for THIS request (the admin's "VS Code jaisa — bina provider ko bheje").
- Sub-agent transcripts get the same discipline: hard token budget + rolling compaction (the 2.2M
  reviewer blowup becomes impossible, not just aborted).
- Better than them: retrieval works over the DURABLE store, so it works even with a dead sandbox.

### 4. SATYA GATES (सत्य) — nothing ships unverified, nothing lies
*Our own invention — none of them have this as a system.*
- Already live and stays law: verify gate on EVERY lane (manifest/one-shot/agentic), preview-is-
  earned, honest outcome classification, fatal-vs-transient provider classes, PLATFORM-ISSUE honesty,
  forensic build reports, reviewer only on built code.
- v4 additions: score never rendered on an errored review; every gate emits a machine-readable
  verdict into the build_events stream (Nirman) so the client UI can show a live "truth panel".

### 5. KAVACH (कवच) — user data that cannot be lost
*Inspired by: Lovable's git-first religion; hardened by our own scars.*
- Already live: GitHub auto-push, durable file store with shrink-guard (a partial save can never
  wipe an index), ≤6s mid-build flush, asset store, append-only PROGRESS discipline.
- v4 additions: per-build git tags (instant restore points surfaced in UI), and the durable store
  becomes the single source Nirman workers read/write (no sandbox-only state, ever).

## Sequencing (each phase ships via the normal cycle, no big-bang)
1. **V4-1** Auto-resume + graceful drain (Nirman Phase A) — kills the two "sab gayab" UX deaths now.
2. **V4-2** Sub-agent transcript bounding + errored-review honesty (Smriti discipline, cheap).
3. **V4-3** esbuild-wasm BrowserBox (replaces babel-iframe; biggest UX jump per rupee).
4. **V4-4** Nirman queue + workers (the architectural core).
5. **V4-5** Smriti embeddings retrieval.
6. **V4-6** WebContainers evaluation gate (license vs Phase-A gaps).

## The one-line promise
Replit की अमरता + Bolt की browser-आज़ादी + Lovable का git-धर्म + Cursor की सटीक नज़र —
हमारे अपने सत्य-gates और कवच के साथ. **VAJRA: कभी मरे नहीं, कभी झूठ न बोले, कभी कुछ खोए नहीं.**

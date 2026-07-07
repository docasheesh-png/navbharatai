# VAJRA — NavBharatAI v4.0 Engine Design (वज्र: अटूट)

**Mandate (admin, 2026-07-07):** "Sabki acchi cheez lekar apna new system banao — in sab se inspire,
in sab se accha." This document is the blueprint — **admin-APPROVED 2026-07-07** ("yeh sab bhi add karo, v3.0 me"): every pillar ships INSIDE NavBharatAI Pro v3.0 progressively via the normal phase cycle (branch → CI green → merge) — VAJRA is v3.0's upgrade track, not a separate product. Every pillar names its inspiration, what we take,
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
1. **V4-1** Auto-resume + graceful drain (Nirman Phase A) — kills the two "sab gayab" UX deaths now. ✅ **SHIPPED** (V4-1a client auto-continue #1087 + V4-1c server graceful drain #1088).
2. **V4-2** Sub-agent transcript bounding + errored-review honesty (Smriti discipline, cheap). ✅ **SHIPPED** (#1087).
3. **V4-3** esbuild-wasm BrowserBox (replaces babel-iframe). ⏸️ **HELD — goal already met by the current preview.**
   Honest finding (2026-07-07, code-verified): the stated V4-3 goal — "real npm-package resolution
   (CDN-backed) + real multi-file bundling in-browser" — is **already delivered** by
   `src/server/runtime/ReactPreview.ts`. It resolves EVERY `package.json` dependency via an `esm.sh`
   importmap (with `react`/`react-dom` externalized to a single shared copy and a jsdelivr fallback
   CDN), transforms JSX/TS via babel-standalone, resolves relative + CSS + `@/`-alias imports locally,
   and self-heals (previewAutoReboot/Reload). Swapping this working, lighter mechanism for a ~10 MB
   esbuild-wasm payload + Service Worker on the single most breakage-prone surface is a large rule-1
   (never-break) risk for a marginal gain (local bundling vs CDN). **Do NOT build blind.** Re-open only
   if a real build report shows babel/esm.sh actually failing on a real app that esbuild-wasm would
   fix — evidence first (rule 5), not a speculative rewrite.
4. **V4-4** Nirman queue + workers (the architectural core). 🔒 **INFRA-GATED.** Needs Cloud Run Jobs (or a
   second min-instances service) + a Firestore `build_jobs` queue provisioned — no `gcloud` access from
   the Claude session, so it cannot be code-completed AND verified here. Its core UX value (a build
   survives an interruption) is already delivered **in-process** by V4-1a/V4-1c for the common
   deploy/network-cut case. Unblock: admin provisions the worker infra.
5. **V4-5** Smriti embeddings retrieval. 🔒 **INFRA-GATED.** `EmbeddingSearch` needs an embeddings key
   (`OPENAI_API_KEY`/Vertex), absent in prod. The **lexical** retriever (BM25 + structural anchors +
   import-graph centrality) already ships real, zero-infra grounding and is wired into the edit turn
   (`ContextReranker.ts` → `agentv3.ts`). Embeddings is a marginal upgrade blocked on the key. Unblock:
   admin sets the embeddings key.
6. **V4-6** WebContainers evaluation gate (license vs Phase-A gaps). 🔒 **LICENSE-GATED.** StackBlitz
   WebContainers requires a commercial license for our use — a business/legal decision, not code.

### Honest status roll-up (2026-07-07)
Everything in VAJRA that is code-completable and verifiable WITHOUT new infra or a license is **shipped**
(V4-1, V4-2, the Smriti lexical core, Satya gates, Kavach shrink-guard/durable store). The four remaining
sequence items are either **redundant with a working system** (V4-3) or **infra/license-gated**
(V4-4/V4-5/V4-6). Per the absolute rules (never break, real features only, honesty), these are NOT
force-built as speculative or half-wired code. The correct next lever is evidence-driven: a fresh v3.0
build report → forensic autopsy → targeted root-cause fix (rule 5), or the admin unblocking the specific
infra/decision above.

## The one-line promise
Replit की अमरता + Bolt की browser-आज़ादी + Lovable का git-धर्म + Cursor की सटीक नज़र —
हमारे अपने सत्य-gates और कवच के साथ. **VAJRA: कभी मरे नहीं, कभी झूठ न बोले, कभी कुछ खोए नहीं.**

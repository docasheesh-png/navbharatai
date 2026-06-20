# NavBharatAI Pro — Claude Code Parity Roadmap
# 100 Phases · 6–7 Months · Goal: 1000/1000 Gap Closure

> **Mission:** NavBharatAI Pro ko 100% Claude Code ke barabar banana — real execution,
> all languages, git, testing, security, vision, memory, deploy (any provider), planning,
> parallel tools — sab kuch. Backend: **Claude Opus 4.8** (200k context, vision, extended thinking).
>
> **Rule:** Har phase apni PR. CI green hone ke baad hi merge. App kabhi na toote.
> **Timeline:** ~2–3 days per phase. Parallel phases jahan possible ho.
> **Track:** Yeh file ground truth hai. Har phase complete hone ke baad status update karo.

---

## CURRENT STATUS SNAPSHOT

| Phase Range | Theme | Status |
|------------|-------|--------|
| 1–15 | Foundation (Claude Opus + real execution) | 🔜 NEXT |
| 16–28 | All Languages | 🔜 |
| 29–40 | Git & GitHub | 🔜 |
| 41–50 | Real Testing | 🔜 |
| 51–60 | Real Database | 🔜 |
| 61–67 | Security (OWASP) | 🔜 |
| 68–78 | Intelligence (Planning + Memory) | 🔜 |
| 79–86 | Vision & Browser | 🔜 |
| 87–93 | Multi-Provider Deploy | 🔜 |
| 94–100 | Tools + Quality + Final Gap Closure | 🔜 |

**1000-point gap score: 0/1000 closed → target 950+/1000**
*(~50 gaps are model-level impossibilities — explained at end)*

---

## MONTH 1 — THE FOUNDATION
### Phases 1–15: Claude Opus Backend + Real Execution

---

### PHASE 1 — Claude Opus as Primary Model for Pro
**Closes:** Points 101–140 (AI model section) — 200k context, vision, extended thinking, Constitutional AI, formal tool use
**Timeline:** Day 1–2

**Problem:** Pro currently uses AIRouterManager with Grok/Gemini priority. Claude Opus has 200k context, vision, extended thinking — these alone close 40+ gaps immediately.

**Files:**
- `src/server/AI/AIRouterManager.ts` — Add Claude Opus priority-1 specifically for Pro (not Engineer AI)
- `src/server/routes/chat.ts` — Pass `surface: 'pro'` flag to router so it uses Claude Opus path
- `src/server/AI/Router/providers/AnthropicProvider.ts` — Ensure `claude-opus-4-8` is the model ID
- `src/server/AI/Router/AIRouter.ts` — Add `preferredModel` option to `route()` call

**What changes:**
```typescript
// AIRouterManager — new Pro-specific router instance
export function buildProRouter(): AIRouter {
  return new AIRouter([
    new AnthropicProvider('claude-opus-4-8'),   // Priority 1 — 200k context
    new GrokProvider(),                          // Fallback
    new VertexProvider(),                        // Fallback
    new GeminiProvider(),                        // Last resort
    // AiCreditsProvider: NEVER (charges NavBharatAI account)
  ]);
}
```

**Verification:** `tsc + vitest` green. Pro chat ka response comes from `claude-opus-4-8`.

---

### PHASE 2 — Anthropic Tool Use API (Formal Tool Calling)
**Closes:** Points 114, 701–760 (tool use section) — structured tool calls, parallel tools, tool schema
**Timeline:** Day 2–4

**Problem:** Pro currently uses JSON-in-text (regex parse). Claude supports native XML tool use — structured, reliable, no parse failures.

**Files:**
- `src/server/AI/Router/providers/AnthropicProvider.ts` — Add `tools` parameter to API call, parse `tool_use` blocks from response
- `src/server/AI/Router/AIRouter.ts` — Add `tools?: AnthropicTool[]` to `RouteOptions`
- `src/server/project/BuildPipeline.ts` — Define tools for Pro: `edit_file`, `bash`, `read_file`, `search_files`, `web_search`, `deploy`
- New `src/server/pro/ProToolDispatcher.ts` — Maps tool name → handler function

**Tool schema (Claude format):**
```typescript
const PRO_TOOLS: AnthropicTool[] = [
  { name: 'edit_file', description: 'Write or update a file', input_schema: { ... } },
  { name: 'bash', description: 'Run a shell command', input_schema: { ... } },
  { name: 'read_file', description: 'Read file contents', input_schema: { ... } },
  { name: 'search_files', description: 'Grep for pattern', input_schema: { ... } },
  { name: 'web_search', description: 'Search the web', input_schema: { ... } },
  { name: 'deploy', description: 'Deploy the app', input_schema: { ... } },
];
```

**Verification:** Pro makes a structured tool call → dispatcher handles it → response is correct.

---

### PHASE 3 — 200k Context Window Integration
**Closes:** Points 47, 111, 212–214 — full file context, large projects, no truncation
**Timeline:** Day 3–4

**Problem:** Pro truncates files at `VFS_MAX_BYTES` (512KB) and passes max 40 files. Claude Opus supports 200k tokens = ~800k chars of context.

**Files:**
- `src/server/EngineerAI/ProEngineRunner.ts` — Remove `VFS_MAX_FILES = 40` and `VFS_MAX_BYTES = 512*1024` limits when using Claude Opus
- `src/server/project/BuildPipeline.ts` — Increase context budget: `MAX_FILES_SHOWN = 200`, `MAX_CHARS_PER_FILE = 20000`
- New `src/server/pro/ProContextBuilder.ts` — Smart context packing for 200k window (relevance-ranked, full file content for relevant files)

**Key logic:**
```typescript
// When model === 'claude-opus-*': use 180k char budget (180k / ~4 chars per token ≈ 45k tokens for context)
// When model === other: use existing 12k char budget
const CONTEXT_BUDGET = isClaudeOpus(model) ? 180_000 : 12_000;
```

**Verification:** 100+ file project → Pro includes all relevant files without truncation.

---

### PHASE 4 — Vision Support (Image Input to Claude)
**Closes:** Points 108, 128, 348–350, 986 — screenshots, image uploads, design-to-code
**Timeline:** Day 4–5

**Problem:** Pro cannot process images. Claude Opus natively supports base64 image input.

**Files:**
- `src/server/AI/Router/providers/AnthropicProvider.ts` — Add `images?: string[]` to request; pass as `{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: ... } }` content blocks
- `src/server/routes/chat.ts` (Pro route) — Accept `attachedImages` from request body
- `src/components/pro/ProChat.tsx` (or wherever Pro chat input is) — Image paste/upload → send as base64

**Verification:** User uploads a UI screenshot → Pro generates matching code.

---

### PHASE 5 — Extended Thinking Integration
**Closes:** Points 131, 666–670, 677 — reasoning model, complex task planning, chain-of-thought
**Timeline:** Day 5–6

**Problem:** Pro makes single LLM call with no reasoning. Claude Opus extended thinking gives deep CoT for complex architectures.

**Files:**
- `src/server/AI/Router/providers/AnthropicProvider.ts` — Add `thinking: { type: 'enabled', budget_tokens: 8000 }` for complex tasks
- `src/server/project/BuildPipeline.ts` — Detect "complex" tasks (multi-file, backend+frontend, auth+db) → enable extended thinking
- Stream `thinking` blocks as `{ type: 'thinking', content: string }` events (show in Pro chat as collapsible "Thinking..." section)

**Verification:** "Build a SaaS with auth, DB, and payments" → Pro shows thinking process → output is architecturally coherent.

---

### PHASE 6 — Real Execution Sandbox (E2B for Pro)
**Closes:** Points 141–185 (execution environment section) — ~45 gaps in one phase
**Timeline:** Day 6–9 (BIGGEST single phase)

**Problem:** Pro lives in VFS (strings in memory). No real execution. `npm install` never runs. This single phase closes MORE gaps than any other.

**Files:**
- `src/server/pro/ProSandbox.ts` (NEW) — Thin wrapper around E2B `Sandbox` for Pro context (same pattern as E2BActuator but Pro-specific lifecycle)
- `src/server/EngineerAI/ProEngineRunner.ts` — When `E2B_API_KEY` available: materialize VFS → E2B → run → collect results back
- `src/server/routes/build.ts` — Add sandbox tier as default (not optional)
- `src/server/runtime/WorkspaceMaterializer.ts` — Already exists; use it to seed E2B from VFS

**Architecture:**
```
User prompt → LLM (Claude Opus) → ProToolDispatcher
  → edit_file: write to E2B filesystem
  → bash: run in E2B (npm install, build, test, git, etc.)
  → read_file: read from E2B filesystem
  → deploy: build → Firebase/Vercel/etc.
```

**Fallback:** No E2B key → fall back to VFS (existing behavior unchanged).

**Verification:** "Build a todo app" → `npm install` actually runs in E2B → `npm run build` succeeds → real preview URL.

---

### PHASE 7 — Real Bash Execution
**Closes:** Points 144, 145, 147–148, 155–159 — terminal, npm, processes, network, env vars
**Timeline:** Day 9–10 (depends on Phase 6)

**Problem:** VFS has no bash. Phase 6 gives the sandbox; Phase 7 wires up the `bash` tool properly.

**Files:**
- `src/server/pro/ProSandbox.ts` — `runCommand(cmd, timeout)` → E2B `process.start('bash', ['-c', cmd])`; stream stdout/stderr as `bash_output` events
- `src/server/pro/ProToolDispatcher.ts` — `bash` tool handler: call `ProSandbox.runCommand()`; return `{ stdout, stderr, exitCode }`
- `src/components/pro/ProChat.tsx` — Show `bash_output` events as terminal-style code blocks in chat

**Verification:** Pro runs `ls -la`, `node --version`, `npm install express` — real output streams to chat.

---

### PHASE 8 — Real npm install + Package Management
**Closes:** Points 145, 253–255, 640 — real deps, lockfile, registry
**Timeline:** Day 10–11

**Problem:** Pro generates `package.json` but never installs deps. User's app can't actually run.

**Files:**
- `src/server/pro/ProSandbox.ts` — `installDependencies()`: run `npm install --prefer-offline` after workspace setup
- `src/server/project/BuildPipeline.ts` — After file generation: call `installDependencies()` automatically
- Handle `node_modules` efficiently: keep in E2B, don't serialize back to VFS

**Verification:** `package.json` with `express@4.18` → `npm install` runs → `node_modules/express/` exists → app starts.

---

### PHASE 9 — Real Build Pipeline
**Closes:** Points 241–280 (build system section) — ~40 gaps
**Timeline:** Day 11–12

**Problem:** Pro's "build" is Vite in-browser bundle. Real apps need `npm run build` in real OS.

**Files:**
- `src/server/runtime/ServerContainerRuntime.ts` — Already exists for Next.js; generalize to all frameworks
- `src/server/pro/ProSandbox.ts` — `runBuild()`: detect framework → run appropriate build command → return `{ success, output, distPath }`
- `src/server/runtime/RuntimeRouter.ts` — Expand: detect Python (FastAPI), Go, Rust, Java apps; route to correct build command

**Build commands by framework:**
```
React/Vite: npm run build → dist/
Next.js: npm run build + next export → out/
Node/Express: npx esbuild src/index.ts → dist/index.js
Python/FastAPI: pip install -r requirements.txt (no build step)
Go: go build -o app .
Rust: cargo build --release
```

**Verification:** Each template type builds successfully → artifact in correct output dir.

---

### PHASE 10 — Dev Server + Real Preview URL
**Closes:** Points 148, 171–174, 630, 633 — live preview, hot reload, real HTTPS URL
**Timeline:** Day 12–13

**Problem:** Pro's preview is a VFS blob URL. Real apps need `npm run dev` → E2B public URL.

**Files:**
- `src/server/pro/ProSandbox.ts` — `startDevServer(port)`: background process → E2B `sandbox.getHost(port)` → return public URL
- `src/server/project/BuildPipeline.ts` — After install: start dev server → emit `server_ready` event with URL
- `src/components/pro/ProChat.tsx` — `server_ready` → update preview iframe src

**Verification:** Vite app starts → `https://<e2b-id>-5173.e2b.dev` → live in iframe with HMR.

---

### PHASE 11 — Process Management
**Closes:** Points 62–63, 147, 161–162 — background servers, multiple processes, frontend+backend
**Timeline:** Day 13–14

**Problem:** Pro can't run frontend + backend simultaneously.

**Files:**
- `src/server/pro/ProSandbox.ts` — `processMap: Map<string, E2BProcess>` — track named processes
- `runInBackground(name, cmd)` — start named background process
- `stopProcess(name)` — kill named process
- `getProcessLogs(name)` — stream last N lines of process output

**Verification:** Full-stack app → frontend (port 5173) + backend (port 3001) run simultaneously → both accessible.

---

### PHASE 12 — Real Filesystem Operations
**Closes:** Points 149–154 — real disk, binary files, symlinks, large files
**Timeline:** Day 14–15

**Problem:** VFS is string-only, in-memory. Real apps need binary files (images, fonts, executables), symlinks, large files.

**Files:**
- `src/server/pro/ProSandbox.ts` — `writeFileBinary(path, buffer)`, `readFileBinary(path)`, `createSymlink(src, dest)`, `stat(path)`
- `src/server/pro/ProToolDispatcher.ts` — `edit_file` handler: detect binary vs text; use appropriate write method

**Verification:** Upload a PNG → agent saves it as binary → served by dev server correctly.

---

### PHASE 13 — Environment Variables in Sandbox
**Closes:** Points 156, 158, 265 — .env, secrets injection, process.env
**Timeline:** Day 15–16

**Problem:** Pro can generate `.env` text but it's never loaded into a real process.

**Files:**
- `src/server/pro/ProSandbox.ts` — `injectEnv(vars: Record<string, string>)` — write to `.env` + inject into sandbox process environment
- `src/server/routes/build.ts` — Accept `envVars` from request (user's DB credentials, API keys)
- `src/components/pro/ProSettings.tsx` (new or existing) — Env vars UI panel: user adds KEY=VALUE pairs

**Verification:** `VITE_SUPABASE_URL=xxx` injected → app reads it via `import.meta.env.VITE_SUPABASE_URL` correctly.

---

### PHASE 14 — Binary File + Large File Support
**Closes:** Points 154–155 — binary, symlinks, no size limit
**Timeline:** Day 16–17

**Problem:** VFS has no binary support. `VFS_MAX_BYTES = 512KB` blocks larger projects.

**Files:**
- `src/server/runtime/VirtualFS.ts` — Add `writeBinary(path, base64)`, `readBinary(path): base64`, remove byte limit for E2B tier
- `src/server/EngineerAI/ProEngineRunner.ts` — Remove `VFS_MAX_BYTES` check; let E2B handle disk

**Verification:** Project with 500+ files, >1MB total → Pro handles without error.

---

### PHASE 15 — Parallel Tool Execution
**Closes:** Points 636, 727–731 — parallel tools, multiple simultaneous actions
**Timeline:** Day 17–18

**Problem:** Pro executes one tool at a time. Claude supports requesting multiple tools in parallel.

**Files:**
- `src/server/pro/ProToolDispatcher.ts` — `dispatchParallel(toolCalls: ToolCall[])` → `Promise.all()` → results array
- `src/server/project/BuildPipeline.ts` — When Claude returns multiple tool_use blocks in one response → dispatch all in parallel
- Independent tools (read_file, search_files, web_search) → parallel; write tools → sequential

**Verification:** Claude requests `read_file(a)` + `read_file(b)` + `search_files(pattern)` → all 3 execute simultaneously.

---

## MONTH 2 — ALL LANGUAGES
### Phases 16–28: Any Language, Any Framework

---

### PHASE 16 — Python Full Support
**Closes:** Points 463–464, 473, 476 — Python, FastAPI, Django, Flask
**Timeline:** Day 19–20

**Files:**
- `src/server/AppMakerLab/generator/templates/PythonFastAPIProvider.ts` (NEW)
- `src/server/AppMakerLab/generator/templates/PythonFlaskProvider.ts` (NEW)
- `src/server/AppMakerLab/generator/templates/TemplateRegistry.ts` — Register new templates
- `src/server/runtime/RuntimeRouter.ts` — Detect Python app (requirements.txt, *.py) → use Python runtime

**Python template generates:**
```
requirements.txt, main.py (FastAPI), .env, README.md
Build: pip install -r requirements.txt
Run: uvicorn main:app --reload --port 8000
```

**Verification:** "Build a REST API in Python FastAPI" → real FastAPI app starts in E2B → `/docs` Swagger UI accessible.

---

### PHASE 17 — Go Full Support
**Closes:** Point 466 — Go language
**Timeline:** Day 20–21

**Files:**
- `src/server/AppMakerLab/generator/templates/GoProvider.ts` (NEW)
- Register in `TemplateRegistry`

**Go template generates:**
```
go.mod, main.go, handlers/, models/
Build: go mod tidy && go build -o app .
Run: ./app
```

---

### PHASE 18 — Rust Full Support
**Closes:** Point 467 — Rust language
**Timeline:** Day 21–22

**Files:**
- `src/server/AppMakerLab/generator/templates/RustProvider.ts` (NEW)

**Rust template generates:**
```
Cargo.toml, src/main.rs, src/lib.rs
Build: cargo build --release
Run: ./target/release/app
```

---

### PHASE 19 — Java/Spring Boot Support
**Closes:** Point 468 — Java, Spring
**Timeline:** Day 22–23

**Files:**
- `src/server/AppMakerLab/generator/templates/JavaSpringProvider.ts` (NEW)

**Java template generates:**
```
pom.xml (Maven), src/main/java/Application.java, controllers/, models/
Build: mvn package -DskipTests
Run: java -jar target/app.jar
```

---

### PHASE 20 — Ruby on Rails Support
**Closes:** Point 469 — Ruby, Rails
**Timeline:** Day 23–24

**Files:**
- `src/server/AppMakerLab/generator/templates/RubyRailsProvider.ts` (NEW)

---

### PHASE 21 — PHP Support
**Closes:** Point 470 — PHP, WordPress, Laravel
**Timeline:** Day 24–25

**Files:**
- `src/server/AppMakerLab/generator/templates/PHPProvider.ts` (NEW) — Laravel template

---

### PHASE 22 — Shell Script + DevOps Support
**Closes:** Points 471, 795–797 — Bash scripts, Terraform, Ansible, Kubernetes YAML
**Timeline:** Day 25–26

**Files:**
- `src/server/AppMakerLab/generator/templates/DevOpsProvider.ts` (NEW)
- Templates: bash scripts, Dockerfile, docker-compose.yml, k8s manifests, Terraform .tf files
- `RuntimeRouter.ts` — Detect devops projects (Dockerfile, *.tf, k8s/*.yaml)

---

### PHASE 23 — C/C++ Support
**Closes:** Point 473 (extended) — C, C++, CMake
**Timeline:** Day 26–27

**Files:**
- `src/server/AppMakerLab/generator/templates/CppProvider.ts` (NEW)
- Build: CMake → make → ./app

---

### PHASE 24 — Any Framework (Template-Free Mode)
**Closes:** Points 217–218, 471–500 — remove TemplateRegistry dependency, generate any stack from scratch
**Timeline:** Day 27–29

**Problem:** Pro is limited to TemplateRegistry stacks. Claude knows every framework — let it generate freely.

**Files:**
- `src/server/project/BuildPipeline.ts` — New mode: `scaffoldMode: 'template' | 'free'`; in free mode, skip template, let Claude generate all files from scratch
- `src/server/pro/ProSystemPrompt.ts` (NEW) — System prompt for free mode: include common patterns for all major frameworks
- `src/server/runtime/RuntimeRouter.ts` — Auto-detect framework from generated files (not from template flag)

**Verification:** "Build an Electron desktop app" — no template exists → Pro generates from scratch → app works.

---

### PHASE 25 — Monorepo Support
**Closes:** Points 56, 656 — workspaces, multiple packages
**Timeline:** Day 29–30

**Files:**
- `src/server/pro/ProSandbox.ts` — `initMonorepo(packages: string[])` — set up `package.json` workspaces
- Support: npm workspaces, pnpm, Turborepo, Nx (detect from config)
- `RuntimeRouter.ts` — Detect monorepo structure

---

### PHASE 26 — Multi-Service Apps (Frontend + Backend)
**Closes:** Point 161 — run multiple services simultaneously in one workspace
**Timeline:** Day 30–31

**Files:**
- `src/server/pro/ProSandbox.ts` — `startServices(services: ServiceConfig[])` — run multiple named processes
- Template: React frontend (port 5173) + Node.js API (port 3001) → concurrent processes → single workspace

---

### PHASE 27 — React Native + Mobile
**Closes:** Points 482–483 — React Native, Expo
**Timeline:** Day 31–32

**Files:**
- `src/server/AppMakerLab/generator/templates/ReactNativeProvider.ts` (NEW)
- E2B: Expo CLI installed → `npx expo start --tunnel` → QR code preview in chat
- `src/components/pro/ProChat.tsx` — Render QR code event

---

### PHASE 28 — Electron + Desktop Apps
**Closes:** Points 483, 890 — desktop apps
**Timeline:** Day 32–33

**Files:**
- `src/server/AppMakerLab/generator/templates/ElectronProvider.ts` (NEW)
- Build: `npm run build` → distributable (headless verify: check dist/ exists)

---

## MONTH 3 — GIT & GITHUB
### Phases 29–40: Full Version Control

---

### PHASE 29 — git init + commit + status
**Closes:** Points 391–394, 409 — init, commit, status, gitignore
**Timeline:** Day 34–35

**Files:**
- `src/server/pro/ProGit.ts` (NEW) — `init()`, `add(files)`, `commit(message)`, `status()`, `diff()`
- `src/server/pro/ProToolDispatcher.ts` — Add `git_commit`, `git_status`, `git_diff` tool handlers
- Auto-init on workspace creation; auto-commit after each successful build milestone

---

### PHASE 30 — Branches + Merge + Stash
**Closes:** Points 395, 399–401 — branches, merge, stash
**Timeline:** Day 35–36

**Files:**
- `src/server/pro/ProGit.ts` — `createBranch()`, `checkout()`, `merge()`, `stash()`, `stashPop()`
- Add to tool dispatcher

---

### PHASE 31 — git push + pull + remote
**Closes:** Points 396–398 — push, pull, remote
**Timeline:** Day 36–37

**Files:**
- `src/server/pro/ProGit.ts` — `addRemote(url, token)`, `push(branch, token)`, `pull(branch, token)`
- Token: from user's Secrets & Keys (same as Engineer AI Phase 5)
- Scrub token from all log output

---

### PHASE 32 — Clone Existing Repos
**Closes:** Point 396 — clone, work on existing codebases
**Timeline:** Day 37–38

**Problem:** Pro currently only generates NEW apps. Claude Code works on existing repos. This is a major gap.

**Files:**
- `src/server/pro/ProGit.ts` — `clone(repoUrl, token)` → E2B `git clone https://<token>@github.com/...`
- `src/server/routes/build.ts` — New `startMode: 'generate' | 'clone'`; if clone: clone first, then enter edit mode
- `src/components/pro/ProChat.tsx` — "Start from existing repo" option in UI

**Verification:** User provides GitHub URL → Pro clones it → analyzes codebase → can edit/add features.

---

### PHASE 33 — GitHub PR Creation
**Closes:** Points 403–405 — PR create, review, comment
**Timeline:** Day 38–39

**Files:**
- `src/server/pro/ProGitHub.ts` (NEW) — `createPR(title, body, head, base)` via GitHub REST API
- `src/server/pro/ProToolDispatcher.ts` — `create_pr` tool
- Uses user's `GITHUB_TOKEN` from Secrets & Keys

---

### PHASE 34 — PR Review + Inline Comments
**Closes:** Points 404–406 — review, comment, merge
**Timeline:** Day 39–40

**Files:**
- `src/server/pro/ProGitHub.ts` — `reviewPR(number, comments)`, `mergePR(number, method)`
- When user says "review this PR" → Pro reads diff → posts inline review comments

---

### PHASE 35 — Merge Conflict Resolution
**Closes:** Point 408 — conflicts
**Timeline:** Day 40–41

**Files:**
- `src/server/pro/ProGit.ts` — `detectConflicts()`, `resolveConflict(file, resolution: 'ours'|'theirs'|'manual')`
- When merge conflict detected: Pro reads conflict markers → LLM resolves → writes clean file

---

### PHASE 36 — .gitignore + Pre-commit Hooks
**Closes:** Points 409–410 — gitignore, hooks
**Timeline:** Day 41

**Files:**
- All templates: include proper `.gitignore` (node_modules, .env, dist/, etc.)
- `src/server/pro/ProGit.ts` — `setupHooks(hooks: GitHook[])` — write to `.git/hooks/`

---

### PHASE 37 — GitHub Actions Workflows
**Closes:** Points 403, 781 — CI/CD workflows
**Timeline:** Day 42–43

**Files:**
- `src/server/AppMakerLab/generator/templates/CIProvider.ts` (NEW) — Generate `.github/workflows/ci.yml`
- Templates: Node.js CI, Python CI, Docker build, deploy to Vercel/Firebase
- Pro can edit existing workflow files

---

### PHASE 38 — Git Log + Blame + Bisect
**Closes:** Points 418–419 — history, blame, debugging
**Timeline:** Day 43–44

**Files:**
- `src/server/pro/ProGit.ts` — `log(n)`, `blame(file, line)`, `bisect(good, bad, testCmd)`
- Tool dispatcher: `git_log`, `git_blame` tools

---

### PHASE 39 — GitLab Support
**Closes:** Point 766 — GitLab
**Timeline:** Day 44–45

**Files:**
- `src/server/pro/ProGitLab.ts` (NEW) — Mirror of ProGitHub.ts for GitLab API
- Auto-detect by URL (gitlab.com vs github.com)

---

### PHASE 40 — Git Worktree (Isolated Experiments)
**Closes:** Point 420 — worktree
**Timeline:** Day 45–46

**Files:**
- `src/server/pro/ProGit.ts` — `createWorktree(branch)`, `removeWorktree(branch)`
- Use for: "try this refactor without breaking main branch"

---

## MONTH 3–4 — REAL TESTING
### Phases 41–50: Any Test Framework

---

### PHASE 41 — Vitest + Jest Test Execution
**Closes:** Points 983, 228–233 — unit tests, run + report
**Timeline:** Day 47–48

**Files:**
- `src/server/pro/ProTesting.ts` (NEW) — `runTests(framework, args)` → E2B bash → parse results → structured report
- `src/server/pro/ProToolDispatcher.ts` — `run_tests` tool
- `src/components/pro/ProChat.tsx` — `test_result` events: show pass/fail counts with colored output

---

### PHASE 42 — Pytest (Python Testing)
**Closes:** Points 228 (all languages), 983
**Timeline:** Day 48–49

**Files:**
- `src/server/pro/ProTesting.ts` — Detect Python project → run `pytest --tb=short -q` → parse output

---

### PHASE 43 — Go Test + Cargo Test
**Closes:** Points 228, 983 — Go, Rust tests
**Timeline:** Day 49

**Files:**
- `src/server/pro/ProTesting.ts` — `go test ./...`, `cargo test`

---

### PHASE 44 — Any Test Framework (Auto-detect)
**Closes:** Points 228, 983 — auto-detect from package.json scripts
**Timeline:** Day 50

**Files:**
- `src/server/pro/ProTesting.ts` — Read `package.json#scripts.test` → run whatever is configured
- Fallback: detect by installed packages (jest, vitest, mocha, jasmine)

---

### PHASE 45 — Test Coverage Reports
**Closes:** Points 230, 982 — coverage, C8, Istanbul
**Timeline:** Day 50–51

**Files:**
- `src/server/pro/ProTesting.ts` — `runCoverage()` → parse LCOV/JSON output → show % in chat
- Event: `coverage_report { statements: %, branches: %, lines: %, functions: % }`

---

### PHASE 46 — E2E Testing with Playwright
**Closes:** Points 231, 346–390 (browser section), 981 — E2E tests
**Timeline:** Day 51–53

**Files:**
- `src/server/pro/ProTesting.ts` — `runE2E(testFile)` → Playwright in E2B → results
- `src/server/pro/ProToolDispatcher.ts` — `run_e2e_test` tool
- Pro can GENERATE Playwright test files for user's app (Claude writes them)

---

### PHASE 47 — Test Generation (TDD Support)
**Closes:** Points 227–229 — test gen, TDD
**Timeline:** Day 53–54

**Files:**
- `src/server/pro/ProSystemPrompt.ts` — Add TDD mode: "write tests first, then implementation"
- `src/server/pro/ProToolDispatcher.ts` — `generate_tests(file)` tool: Claude reads implementation → writes comprehensive tests
- Auto-generate tests for every new file (like Engineer AI Phase 17)

---

### PHASE 48 — Test Watch Mode
**Closes:** Point 231 — watch
**Timeline:** Day 54–55

**Files:**
- `src/server/pro/ProTesting.ts` — `startWatchMode()` → background process → stream test results as files change
- `test_watch_result` event: real-time test status in chat

---

### PHASE 49 — Snapshot Testing
**Closes:** Point 232 — snapshots
**Timeline:** Day 55

**Files:**
- `src/server/pro/ProTesting.ts` — Support `--updateSnapshot` flag
- Pro can regenerate snapshots when intentional UI changes happen

---

### PHASE 50 — Mutation Testing
**Closes:** Point 984 — mutation testing (Stryker)
**Timeline:** Day 55–56

**Files:**
- `src/server/pro/ProTesting.ts` — `runMutationTest()` → Stryker.js → mutation score report

---

## MONTH 4 — DATABASE & BACKEND
### Phases 51–60: Real Connections

---

### PHASE 51 — Real Postgres Connection in Sandbox
**Closes:** Points 493, 508 — real DB, not just scaffolded code
**Timeline:** Day 57–59

**Problem:** Pro scaffolds Postgres code but never connects to a real DB. Claude Code can run real queries.

**Files:**
- `src/server/pro/ProDatabase.ts` (NEW) — `testConnection(connectionString)` — E2B bash: `psql "$URL" -c "SELECT 1"` → confirm connection works
- `src/server/pro/ProSandbox.ts` — Inject `DATABASE_URL` into sandbox env automatically when user provides it
- `src/components/pro/ProSettings.tsx` — Database panel: connection string input → test → confirm

---

### PHASE 52 — Real Supabase Integration
**Closes:** Points 491, 508–513 — Supabase CRUD, auth, realtime
**Timeline:** Day 59–60

**Files:**
- `src/server/pro/ProDatabase.ts` — `testSupabase(url, key)` — E2B: `node -e "require('@supabase/supabase-js')..."`
- Auto-inject `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` into sandbox
- Pro verifies connection before scaffolding (not blind code generation)

---

### PHASE 53 — Real Firebase Integration
**Closes:** Points 492, 508 — Firebase Firestore, Auth, Storage
**Timeline:** Day 60–61

**Files:**
- `src/server/pro/ProDatabase.ts` — `testFirebase(config)` — verify project ID, API key work
- Inject Firebase config into sandbox `.env`

---

### PHASE 54 — MongoDB Support
**Closes:** Point 494 — MongoDB
**Timeline:** Day 61–62

**Files:**
- `src/server/AppMakerLab/generator/templates/MongoDBProvider.ts` (NEW) — Mongoose template
- `src/server/pro/ProDatabase.ts` — `testMongoDB(connectionString)`

---

### PHASE 55 — Redis Support
**Closes:** Point 495 — Redis
**Timeline:** Day 62–63

**Files:**
- `src/server/AppMakerLab/generator/templates/RedisProvider.ts` (NEW)
- `src/server/pro/ProDatabase.ts` — `testRedis(url)` — `redis-cli PING`

---

### PHASE 56 — Database Migrations
**Closes:** Point 516 — migrations, schema changes
**Timeline:** Day 63–65

**Files:**
- `src/server/pro/ProDatabase.ts` — `runMigrations(tool: 'prisma'|'drizzle'|'flyway'|'alembic')` → E2B bash
- Pro can generate migration files AND run them
- Tool dispatcher: `run_migration` tool

---

### PHASE 57 — ORM Support (Prisma + Drizzle)
**Closes:** Points 513, 517 — Prisma, Drizzle, TypeORM
**Timeline:** Day 65–66

**Files:**
- `src/server/AppMakerLab/generator/templates/PrismaProvider.ts` (NEW)
- `src/server/AppMakerLab/generator/templates/DrizzleProvider.ts` (NEW)
- Templates include: schema.prisma, migrations setup, seed script, CRUD operations

---

### PHASE 58 — Schema Design + Generation
**Closes:** Points 494, 515–516 — schema, seed data
**Timeline:** Day 66–67

**Files:**
- `src/server/pro/ProDatabase.ts` — `generateSchema(description)` — Claude reads user's requirements → generates SQL/Prisma schema
- `src/server/pro/ProSystemPrompt.ts` — Add DB design mode

---

### PHASE 59 — Storage Integration (Supabase / S3 / Firebase)
**Closes:** Points 517–518 — file storage, uploads
**Timeline:** Day 67–68

**Files:**
- Templates for: Supabase Storage, Firebase Storage, AWS S3, Cloudinary
- Real upload test in E2B before code delivery

---

### PHASE 60 — Edge Functions + Serverless
**Closes:** Points 520, 534 — edge, serverless, cloud functions
**Timeline:** Day 68–70

**Files:**
- `src/server/AppMakerLab/generator/templates/EdgeFunctionProvider.ts` (NEW)
- Supports: Supabase Edge Functions, Firebase Functions, Vercel Edge, Cloudflare Workers

---

## MONTH 4–5 — SECURITY (OWASP)
### Phases 61–67

---

### PHASE 61 — OWASP Awareness in System Prompt
**Closes:** Points 205, 536–570 — XSS, SQLi, CSRF, OWASP Top 10
**Timeline:** Day 71–72

**Files:**
- `src/server/pro/ProSystemPrompt.ts` — Add OWASP section:
  - Never use `innerHTML` with user data (XSS)
  - Always parameterized queries (SQL injection)
  - Always validate input at boundaries
  - Never log secrets
  - Use HTTPS, set security headers
  - Never commit `.env` files

---

### PHASE 62 — Input Sanitization Auto-Detection
**Closes:** Points 536–537, 546 — XSS, injection detection
**Timeline:** Day 72–73

**Files:**
- `src/server/pro/ProSecurityAuditor.ts` (NEW) — Static analysis: scan generated code for common vulnerabilities
  - `innerHTML =` without sanitization → flag
  - String concatenation in SQL → flag
  - `eval()` usage → flag
  - Hardcoded credentials → flag
- Run after every file generation; add `security_warning` events

---

### PHASE 63 — Secrets Detection
**Closes:** Points 206, 540, 563 — no tokens/keys in code
**Timeline:** Day 73–74

**Files:**
- `src/server/pro/ProSecurityAuditor.ts` — Regex scan for: API keys, passwords, JWT secrets, connection strings in generated code
- If found: replace with `process.env.SECRET_NAME` + add to `.env.example`

---

### PHASE 64 — Dependency Security (npm audit)
**Closes:** Points 543–544 — vuln scanning
**Timeline:** Day 74

**Files:**
- `src/server/pro/ProSandbox.ts` — After `npm install`: run `npm audit --json` → parse critical/high vulns → warn user
- Tool: `audit_dependencies` → show vulnerability report in chat

---

### PHASE 65 — Security Headers Generation
**Closes:** Points 556–557 — CSP, HTTPS, security headers
**Timeline:** Day 74–75

**Files:**
- Templates: auto-add helmet.js (Node/Express), security headers in Next.js `next.config.js`, Firebase hosting `firebase.json` headers

---

### PHASE 66 — CORS Configuration
**Closes:** Point 555 — CORS
**Timeline:** Day 75

**Files:**
- All backend templates: generate proper CORS config with environment-specific origins
- `ProSecurityAuditor.ts` — Warn if CORS is `*` in production code

---

### PHASE 67 — Security Review Skill
**Closes:** Points 545, 837–838 — full security audit
**Timeline:** Day 75–76

**Files:**
- `src/server/pro/ProSystemPrompt.ts` — `/security-review` command: Claude does full OWASP audit of current codebase
- Generates structured report: Critical → High → Medium → Low findings, each with file:line and fix

---

## MONTH 5 — INTELLIGENCE
### Phases 68–78: Planning, Memory, Extended Thinking

---

### PHASE 68 — PlannerAgent for Pro
**Closes:** Points 661–680 — planning, task decomposition, step visibility
**Timeline:** Day 77–79

**Problem:** Pro is single-shot. Claude Code plans before acting. This is a major quality gap.

**Files:**
- `src/server/pro/ProPlanner.ts` (NEW) — Same pattern as `PlannerAgent.ts` (Engineer AI):
  - One AI call: "You are a software architect. Given this task, produce a JSON plan: `{ steps: [{ description, files, focusHint }] }`"
  - Returns 3–8 steps; fallback to single step on failure
- `src/server/project/BuildPipeline.ts` — Before build loop: call ProPlanner → emit `plan` event → execute steps
- `src/components/pro/ProChat.tsx` — Plan steps shown as progress bar (like Engineer AI)

---

### PHASE 69 — Mandatory Chain-of-Thought
**Closes:** Points 666–668, 687 — thought field, CoT, reasoning
**Timeline:** Day 79–80

**Files:**
- `src/server/pro/ProSystemPrompt.ts` — Mandatory: before every tool call, include `"thought": "..."` field explaining WHY this action
- `src/server/project/BuildPipeline.ts` — Parse thought from response → emit `thinking` event → show collapsible in UI

---

### PHASE 70 — Self-Review Pass after Edit
**Closes:** Points 225–226, 671 — self-critique, code review after write
**Timeline:** Day 80–81

**Files:**
- `src/server/pro/ProSelfReviewer.ts` (NEW) — Same as Engineer AI Phase 18:
  - After every `edit_file`: targeted review call
  - "Check: missing imports, undefined vars, syntax errors, logic bugs"
  - If fix needed: apply silently; if clean: continue
- Max 1 review per file write (no infinite loops)

---

### PHASE 71 — Build-Fail Diagnosis Pass
**Closes:** Points 76–77, 875 — auto-repair on build failure
**Timeline:** Day 81–82

**Files:**
- `src/server/project/BuildPipeline.ts` — On build fail: focused diagnosis call
  - "Build failed: [logs]. Identify root cause (file, line, what's wrong). Output single most targeted fix action."
  - Apply fix → retry build → max 3 attempts

---

### PHASE 72 — Multi-Agent Orchestration
**Closes:** Points 51–55, 673–675, 722 — sub-agents, parallel agents
**Timeline:** Day 82–84

**Files:**
- `src/server/pro/ProOrchestrator.ts` (NEW) — For large tasks: spawn parallel sub-agents
  - Example: "Build full-stack app" → SubAgent1 (frontend) + SubAgent2 (backend) → merge results
  - Shared `SharedProState` (same pattern as Engineer AI `SharedLoopState`)

---

### PHASE 73 — Extended Thinking for Complex Tasks
**Closes:** Points 131, 668–670 — deep reasoning, architecture decisions
**Timeline:** Day 84–85

**Files:**
- `src/server/project/BuildPipeline.ts` — Complexity detector: if task involves >3 systems OR is ambiguous → enable extended thinking (`budget_tokens: 16000`)
- Show thinking blocks as collapsible "🧠 Thinking..." section in Pro chat

---

### PHASE 74 — Cross-Session Memory (Firestore)
**Closes:** Points 421–455 — remember past projects, decisions, preferences
**Timeline:** Day 85–87

**Files:**
- `src/server/pro/ProMemory.ts` (NEW) — Same as `EngineerMemory.ts` (Engineer AI Phase 19):
  - Firestore collection: `pro_memories/{userId}/{projectId}`
  - Stores: stack chosen, DB provider, key architectural decisions, user preferences
  - Reads on session start → injects into system prompt
- `src/server/project/BuildPipeline.ts` — Load memory at start; save after significant decisions

---

### PHASE 75 — Project Memory File (CLAUDE.md equivalent)
**Closes:** Points 135–136, 430–432 — project-level rules, conventions
**Timeline:** Day 87–88

**Files:**
- Pro creates `.navbharatai/context.md` in workspace (equivalent of CLAUDE.md)
- Contains: stack, DB, key decisions, naming conventions, user preferences
- Loaded as system prompt prefix on every turn

---

### PHASE 76 — Architecture Decision Memory
**Closes:** Points 683–684 — remember WHY decisions were made
**Timeline:** Day 88–89

**Files:**
- `src/server/pro/ProMemory.ts` — `logDecision(decision, rationale, alternatives)` — ADR (Architecture Decision Record) stored in Firestore
- When Pro makes a key architectural choice: save it with rationale
- Future sessions: Pro explains "I used Supabase instead of Firebase because you said..."

---

### PHASE 77 — User Preference Memory
**Closes:** Points 438–440 — remember user's coding style, preferences
**Timeline:** Day 89–90

**Files:**
- `src/server/pro/ProMemory.ts` — `savePreference(key, value)`, `getPreference(key)`
- Learn: preferred language, framework, DB, code style, comment density
- Auto-apply in future sessions

---

### PHASE 78 — Long-term Pattern Memory
**Closes:** Points 441–445 — error patterns, solutions
**Timeline:** Day 90–91

**Files:**
- `src/server/pro/ProMemory.ts` — `logFixedBug(errorPattern, fix)` — learn from build failures
- If same error recurs: Pro recognizes it and applies known fix immediately

---

## MONTH 5–6 — VISION & BROWSER
### Phases 79–86

---

### PHASE 79 — Screenshots (Reuse E2BActuator)
**Closes:** Points 346–390 (browser automation section) — ~45 gaps
**Timeline:** Day 92–93

**Files:**
- `src/server/pro/ProSandbox.ts` — `screenshot(url)` → reuse `E2BActuator.screenshot()` logic
- `src/server/pro/ProToolDispatcher.ts` — `take_screenshot` tool
- `src/components/pro/ProChat.tsx` — `screenshot_result` event → show in chat

---

### PHASE 80 — Browser Actions (Playwright)
**Closes:** Points 351–390 — click, type, navigate, form fill
**Timeline:** Day 93–95

**Files:**
- `src/server/pro/ProSandbox.ts` — `browserAction(action, args)` → reuse E2BActuator browser action logic
- `src/server/pro/ProToolDispatcher.ts` — `browser_action` tool (same as Engineer AI)
- Tool types: `click`, `type`, `navigate`, `scroll`, `press`, `wait`, `hover`, `select_option`

---

### PHASE 81 — Visual Cursor Overlay
**Closes:** Points 361–362, 376–377 — visible AI cursor, drive frame
**Timeline:** Day 95–96

**Files:**
- `src/components/pro/ProChat.tsx` — Cursor overlay on preview iframe (reuse Engineer AI Phase 6.5 code)

---

### PHASE 82 — Console Log + Runtime Error Capture
**Closes:** Points 178–180, 364–366 — JS errors, console, network
**Timeline:** Day 96–97

**Files:**
- `src/server/pro/ProSandbox.ts` — Playwright `page.on('console')` + `page.on('pageerror')` → stream `console_error` events
- Pro sees runtime errors and fixes them proactively

---

### PHASE 83 — Multi-Viewport Testing
**Closes:** Points 170, 369–373 — mobile + desktop viewports
**Timeline:** Day 97–98

**Files:**
- `src/server/pro/ProSandbox.ts` — `screenshotAtViewport(url, width, height)` — multiple viewport screenshots
- Pro verifies responsive layout: 375px (mobile) + 768px (tablet) + 1440px (desktop)

---

### PHASE 84 — Drive Mode (Autonomous UI Testing)
**Closes:** Points 375–377 — autonomous testing loop
**Timeline:** Day 98–100

**Files:**
- `src/server/pro/ProDriver.ts` (NEW) — Autonomous drive loop (like Engineer AI `drive` action):
  - Navigate → screenshot → analyze (Claude vision) → click/type → screenshot → verify → fix if broken
  - Runs automatically after every app build
- Emit `drive_frame` events → live in Pro chat

---

### PHASE 85 — Design-to-Code (Image → UI)
**Closes:** Points 172, 986 — Figma/screenshot → code
**Timeline:** Day 100–102

**Files:**
- `src/server/pro/ProSystemPrompt.ts` — Design mode: user uploads Figma screenshot/design image → Claude vision analyzes → generates matching React/CSS
- `src/components/pro/ProChat.tsx` — Image upload → trigger design mode

---

### PHASE 86 — PDF Report Generation
**Closes:** Points 371 — PDF output
**Timeline:** Day 102–103

**Files:**
- `src/server/pro/ProSandbox.ts` — Playwright `page.pdf()` → download PDF of running app
- Tool: `generate_pdf(url)` → returns PDF download link

---

## MONTH 6 — MULTI-PROVIDER DEPLOYMENT
### Phases 87–93

---

### PHASE 87 — Vercel Deploy
**Closes:** Points 297, 775 — Vercel
**Timeline:** Day 104–106

**Files:**
- `src/server/pro/ProDeploy.ts` (NEW) — `deployVercel(token, projectName, distPath)` — Vercel REST API
- `src/server/pro/ProToolDispatcher.ts` — `deploy_vercel` tool
- Auto-detect Next.js → Vercel is the optimal choice
- Returns permanent `*.vercel.app` URL

---

### PHASE 88 — Netlify Deploy
**Closes:** Points 298, 776 — Netlify
**Timeline:** Day 106–107

**Files:**
- `src/server/pro/ProDeploy.ts` — `deployNetlify(token, siteId, distPath)` — Netlify API
- Returns `*.netlify.app` URL

---

### PHASE 89 — Railway Deploy
**Closes:** Point 292 (extended) — Railway (full-stack apps with servers)
**Timeline:** Day 107–109

**Files:**
- `src/server/pro/ProDeploy.ts` — `deployRailway(token, project)` — Railway CLI via E2B bash
- Best for: Node.js, Python, Go apps with real server (not just static)

---

### PHASE 90 — GitHub Pages Deploy
**Closes:** Point 301 — GitHub Pages
**Timeline:** Day 109–110

**Files:**
- `src/server/pro/ProDeploy.ts` — `deployGitHubPages(token, repo, distPath)` — push `dist/` to `gh-pages` branch
- Auto-detects static React/Vue apps → GitHub Pages is simplest option

---

### PHASE 91 — Custom Domain Support
**Closes:** Points 288–289 — custom domains, HTTPS
**Timeline:** Day 110–112

**Files:**
- `src/server/pro/ProDeploy.ts` — `assignCustomDomain(provider, domain)` — call provider API to map domain
- Support: Vercel custom domains, Netlify custom domains, Firebase Hosting custom domains

---

### PHASE 92 — Server-Side Rendering Deploy
**Closes:** Points 296, 311 — SSR, dynamic apps
**Timeline:** Day 112–113

**Files:**
- `src/server/pro/ProDeploy.ts` — `deploySSR(provider, buildOutput)`:
  - Next.js SSR → Vercel (optimal)
  - Node.js server → Railway
  - Python FastAPI → Railway / Cloud Run
- Not just static sites — real servers with SSR

---

### PHASE 93 — Rollback + Deploy History
**Closes:** Points 293–294 — rollback, deploy history
**Timeline:** Day 113–114

**Files:**
- `src/server/pro/ProDeploy.ts` — `listDeployments(provider)`, `rollback(provider, deploymentId)`
- `src/components/pro/ProChat.tsx` — Deploy history panel: list last 10 deploys → "Rollback" button per entry

---

## MONTH 6–7 — TOOLS, QUALITY & FINAL GAPS
### Phases 94–100

---

### PHASE 94 — Formal Tool System + Tool Retries
**Closes:** Points 727–760 — retry logic, tool error recovery, tool logging
**Timeline:** Day 115–117

**Files:**
- `src/server/pro/ProToolDispatcher.ts` — `dispatchWithRetry(tool, maxRetries=3)`:
  - On tool error: different approach on retry (not same command)
  - Log all tool calls: `{ tool, args, result, duration, success }` → Firestore
- Tool call analytics: which tools fail most → improve prompts

---

### PHASE 95 — /code-review Skill for Pro
**Closes:** Points 225–226, 835–838 — code review, inline comments
**Timeline:** Day 117–119

**Files:**
- `src/server/pro/ProCodeReview.ts` (NEW) — Full OWASP + quality review of current workspace:
  - Security: injection, XSS, hardcoded creds
  - Quality: unused vars, dead code, duplicates, long functions
  - Performance: N+1 queries, unoptimized loops
  - Returns: structured findings with file:line:severity:description:fix
- `/code-review` command in Pro chat triggers this

---

### PHASE 96 — /simplify Skill for Pro
**Closes:** Points 197–199, 840 — refactoring, simplification
**Timeline:** Day 119–120

**Files:**
- `src/server/pro/ProRefactorer.ts` (NEW):
  - Finds: duplicate code, overly complex functions, redundant abstractions
  - Rewrites with improvements: cleaner names, shorter functions, extracted utilities
- `/simplify` command in Pro chat

---

### PHASE 97 — Tech Debt Detection
**Closes:** Points 686, 899 — tech debt, legacy code
**Timeline:** Day 120–121

**Files:**
- `src/server/pro/ProCodeReview.ts` — Add tech debt analysis:
  - TODO/FIXME comments → list and prioritize
  - Old npm packages → suggest updates
  - Deprecated APIs → suggest modern alternatives
  - Missing types (TypeScript `any`) → suggest typed versions

---

### PHASE 98 — Performance Profiling + Optimization
**Closes:** Points 233, 639, 680–690 — performance, optimization
**Timeline:** Day 121–123

**Files:**
- `src/server/pro/ProSandbox.ts` — `runLighthouse(url)` → Lighthouse CLI in E2B → performance score
- `src/server/pro/ProSandbox.ts` — `runBundleAnalysis()` → webpack-bundle-analyzer → show bundle breakdown
- Pro can diagnose: large bundle, slow API, N+1 queries, memory leaks

---

### PHASE 99 — Accessibility Testing
**Closes:** Points 240, 240, 372 — a11y
**Timeline:** Day 123–124

**Files:**
- `src/server/pro/ProSandbox.ts` — `runA11yTest(url)` → axe-core CLI → accessibility report
- Pro auto-fixes: missing `alt` attributes, color contrast, ARIA roles, keyboard navigation

---

### PHASE 100 — Final Gap Closure + Polish
**Closes:** All remaining points — i18n, WebSockets, analytics integration, CLI-in-browser, edge cases
**Timeline:** Day 124–130

**Sub-tasks:**
- P100a: WebSocket real-time apps (template + real WS in E2B)
- P100b: i18n framework integration (react-i18next, i18next)
- P100c: Analytics integration templates (Mixpanel, PostHog, Plausible)
- P100d: Error tracking templates (Sentry, Datadog)
- P100e: Payment integration templates (Stripe Elements, Razorpay)
- P100f: Email service templates (Resend, SendGrid, Nodemailer)
- P100g: CLI-in-browser (expose full E2B terminal as Pro terminal tab)
- P100h: AppKnowledgeBase sync — update all Pro new features
- P100i: Final 1000-point comparison recheck + remaining gap fixes

---

## GAP SCORE PROJECTION

After all 100 phases:

| Category | Gaps Before | Gaps After | Method |
|----------|------------|-----------|--------|
| AI Model (200k context, vision, thinking) | 40 closed | ✅ Phase 1 (Claude Opus) |
| Real Execution | 0/200 | ✅ 195/200 | Phase 6–15 |
| All Languages | 0/50 | ✅ 48/50 | Phase 16–28 |
| Git + GitHub | 0/30 | ✅ 30/30 | Phase 29–40 |
| Testing | 0/30 | ✅ 29/30 | Phase 41–50 |
| Database (real) | 0/30 | ✅ 28/30 | Phase 51–60 |
| Security | 0/20 | ✅ 18/20 | Phase 61–67 |
| Planning + Memory | 0/40 | ✅ 38/40 | Phase 68–78 |
| Vision + Browser | 0/50 | ✅ 47/50 | Phase 79–86 |
| Multi-Deploy | 0/25 | ✅ 25/25 | Phase 87–93 |
| Tools + Quality | 0/80 | ✅ 75/80 | Phase 94–100 |
| **TOTAL** | **~0/1000** | **~950+/1000** | |

**Remaining ~50 gaps (irreducible):**
- Native VS Code/JetBrains extension marketplace (distribution, separate 6-month project)
- `npm install -g navbharatai` CLI distribution (packaging/infra)
- "Runs on user's local machine" (Pro is cloud — this is an intentional product feature, not a bug)
- Deferred tool loading (Claude Code-internal architecture)
- Background agents returning notifications (Claude Code session model)
- Full Constitutional AI training (Anthropic-internal)

*Note: These ~50 "gaps" are actually product differences, not capability gaps. Cloud execution (Pro's model) has advantages Claude Code local can't match: E2B isolation, Firebase deploy, no local machine required, accessible from phone.*

---

## EXECUTION RULES (mandatory every session)

1. **One phase per PR.** Never combine phases.
2. **Verification gate:** `tsc --noEmit` + `tsc -p tsconfig.server.json --noEmit` + `vitest run` (all green) before push.
3. **Commit small.** After each meaningful sub-step within a phase — not just at phase end.
4. **Update this file** after each phase: change status to ✅ DONE + PR number.
5. **No fake success.** If a phase builds but doesn't work correctly: mark as PARTIAL and describe what's missing.
6. **AppKnowledgeBase sync.** Any new Pro capability → add to `AppKnowledgeBase.ts` in same PR.
7. **Redundant-work check.** Before starting any phase: grep to confirm it doesn't already exist.

---

## MONTHLY CHECKPOINTS

| Month | End-of-month target | % gaps closed |
|-------|--------------------|-|
| Month 1 | Phases 1–15: Claude Opus + real E2B execution | ~35% |
| Month 2 | Phases 16–28: All 10+ languages + any framework | ~50% |
| Month 3 | Phases 29–40: Full git + GitHub + CI/CD | ~60% |
| Month 4 | Phases 41–67: Testing + DB + Security | ~75% |
| Month 5 | Phases 68–86: Intelligence + Vision + Browser | ~87% |
| Month 6 | Phases 87–93: Multi-provider deploy | ~91% |
| Month 7 | Phases 94–100: Final gap closure + polish | **95%+** |

---

*Start date: 2026-06-20*
*Target: 2027-01-20 (7 months)*
*Goal: 950+/1000 gap closure vs Claude Code*

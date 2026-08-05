import { dedupeToolsByName, type ClaudeToolDef } from './ClaudeClient';
import type { ToolName } from './types';
import { WORKER_ROLES } from './AgentRegistry';

/**
 * ToolCatalog — the native Anthropic tool definitions the v5.0 agent team can
 * call (RC-1). These are the Claude-Code-class file/exec/search tools. The
 * `task` sub-agent tool is added in P3.5 (multi-agent). Each definition's
 * `input_schema` is what Claude validates its `tool_use` input against.
 */
export function defaultToolCatalog(): ClaudeToolDef[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file in the workspace. IMPORTANT: a very large file is shown with its MIDDLE trimmed from the view — the file on disk is ALWAYS complete. To see a hidden section, call read_file again with start_line/end_line. Never conclude a file is truncated/corrupted from a trimmed view.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          start_line: { type: 'number', description: 'Optional 1-based first line to read (for slicing a large file).' },
          end_line: { type: 'number', description: 'Optional 1-based last line to read (inclusive).' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with the given full contents.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'The complete file contents.' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace an exact, unique string in a file with a new string. The ' +
        'old_string must appear exactly once; include surrounding context to ' +
        'make it unique.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          old_string: { type: 'string', description: 'The exact text to replace (must be unique).' },
          new_string: { type: 'string', description: 'The replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'bash',
      description: 'Run a shell command in the workspace and return its exit code, stdout and stderr.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'grep',
      description: 'Search file contents for a pattern (recursive). Returns matching lines with paths.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The text/regex to search for.' },
          path: { type: 'string', description: 'Optional path to search under (default: whole workspace).' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob',
      description: 'List workspace files whose path matches a glob pattern (e.g. "src/**/*.ts").',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'A glob pattern.' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'update_preview',
      description:
        'Publish the live preview URL after you start a dev server. Call this with ' +
        'the port your dev server is listening on so the user sees the app live as ' +
        'it builds. Call it again if the port changes.',
      input_schema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'The port the dev server is listening on (e.g. 3000, 5173).' },
        },
        required: ['port'],
      },
    },
    {
      name: 'recall',
      description:
        'Search the project memory — exported symbols, files, components, routes ' +
        'and past errors/fixes from this build — for a query. Use it to find where ' +
        'something is, what already exists, or what failed before, instead of ' +
        're-scanning the whole tree.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for (a symbol/file/component name, or a past error).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'evaluate',
      description:
        'Statically analyse the project for real defects from the indexed code: ' +
        'unresolved local imports (which break the build), import cycles, ' +
        'front-end→back-end layering violations, plus security issues (hardcoded ' +
        'secrets, eval, dangerouslySetInnerHTML, insecure http) and accessibility ' +
        'issues (images with no alt text, form controls with no accessible name, ' +
        'click handlers on non-interactive elements, positive tabindex, missing ' +
        'document language), and trust/privacy/compliance issues (DPDP/GDPR-oriented: ' +
        'personal data in logs, sensitive values in browser storage, cookies without ' +
        'SameSite, personal data over plain http, a tracker with no consent surface, ' +
        'or collecting personal data with no privacy policy) — ending with an honest ' +
        '"launch-safe" certificate. It also reports a calibrated "build confidence" ' +
        '(0–100% with High/Medium/Low and a plain-language "here\'s why") synthesized ' +
        'from all of the above, so you state honest confidence instead of guessing. ' +
        'Use it to check your work before declaring it done, then fix what it reports.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'update_todo',
      description: 'Update the ONE running build plan shown to the user. Send the full list with statuses updated and new items appended — never a fresh shorter plan (completed items always stay; the workspace keeps finished work even if you omit it).',
      input_schema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full todo list (replaces the previous one).',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] },
                owner: { type: 'string' },
              },
              required: ['id', 'title', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
    {
      name: 'generate_readme',
      description:
        'Generate a real README.md for the project from the actual code: detected ' +
        'tech stack, how to install and run, project structure (components/routes/files) ' +
        'and the available npm scripts. Everything is derived from the real project ' +
        'graph + package.json (never invented). Writes the result to README.md.',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Optional project title (defaults to package.json name).' },
          path: { type: 'string', description: 'Optional output path (defaults to README.md).' },
        },
      },
    },
    {
      name: 'generate_architecture_docs',
      description:
        'Generate a real ARCHITECTURE.md from the actual project graph: the module dependency ' +
        'map (the resolved import edges between the app\'s own files), the component and route ' +
        'inventory, and honest structural notes (import cycles, unresolved imports, layering ' +
        'violations, orphan components). Everything is derived from the real import graph (never ' +
        'invented). Useful on a larger app so its structure is documented. Writes to ARCHITECTURE.md.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional output path (defaults to ARCHITECTURE.md).' },
        },
      },
    },
    {
      name: 'generate_dev_guide',
      description:
        'Generate a human DEVELOPER_GUIDE.md — onboarding for developers working ON the app: how to run ' +
        'it locally, where code lives, framework-aware "how to add a page/route/component/endpoint" ' +
        'recipes, testing, build & deploy, conventions and a troubleshooting table. Derived from the ' +
        'app\'s real package.json (name, scripts, framework) and the env vars the code references. ' +
        'Distinct from generate_readme (what the app IS) and generate_architecture_docs (structure). ' +
        'Writes to DEVELOPER_GUIDE.md. No API key.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional output path (defaults to DEVELOPER_GUIDE.md).' },
          name: { type: 'string', description: 'App name (defaults to package.json name).' },
          framework: { type: 'string', description: 'Override framework detection (react/next/vue/svelte/solid/express/node/python).' },
          package_manager: { type: 'string', description: 'npm/pnpm/yarn/bun (defaults to npm).' },
        },
      },
    },
    {
      name: 'generate_env_example',
      description:
        'Generate or update .env.example listing every environment variable the code ' +
        'actually references (process.env.X / import.meta.env.X). Existing documented ' +
        'values are preserved. Use this so the app is runnable by others — the classic ' +
        '"works on my machine" gap. Writes the result to .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional output path (defaults to .env.example).' },
        },
      },
    },
    {
      name: 'write_files_batch',
      description:
        'Write multiple NEW files to the workspace in one operation — faster than ' +
        'calling write_file one-by-one when creating several independent files. ' +
        'Files are automatically ordered by import dependencies (dependencies written ' +
        'first), so this is safe when files import each other in one direction. ' +
        'Use this ONLY for creating new files. For editing existing files use edit_file.',
      input_schema: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            description: 'List of files to create.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Workspace-relative file path.' },
                content: { type: 'string', description: 'The complete file contents.' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['files'],
      },
    },
    {
      name: 'codemod_rename',
      description:
        'AST-safe cross-file symbol rename. Renames every usage of an exported ' +
        'identifier (function, variable, type, class, interface) across the whole ' +
        'workspace — import sites, call sites, and JSX tags — without touching ' +
        'string literals. Far safer than a global find-and-replace.',
      input_schema: {
        type: 'object',
        properties: {
          old_name: { type: 'string', description: 'The current symbol name to rename.' },
          new_name: { type: 'string', description: 'The new name to replace it with.' },
        },
        required: ['old_name', 'new_name'],
      },
    },
    {
      name: 'codemod_add_prop',
      description:
        'Add a new prop (with its type and optional default) to a React component: ' +
        'updates the Props interface/type and every JSX usage site in one atomic ' +
        'operation. Use instead of manually hunting every call site.',
      input_schema: {
        type: 'object',
        properties: {
          component_name: { type: 'string', description: 'The component to add the prop to (e.g. "Button").' },
          prop_name: { type: 'string', description: 'The new prop name (e.g. "disabled").' },
          prop_type: { type: 'string', description: 'The TypeScript type (e.g. "boolean", "string").' },
          default_value: { type: 'string', description: 'Optional default value for JSX usage sites (e.g. "false").' },
        },
        required: ['component_name', 'prop_name', 'prop_type'],
      },
    },
    {
      name: 'codemod_move_file',
      description:
        'Move or rename a file AND rewrite every import that points to it, in one surgical step — the ' +
        'safe way to relocate a module (e.g. src/components/Button.tsx → src/ui/Button.tsx). It rewrites ' +
        "each importer's specifier (relative or @/~ alias, keeping the style), recomputes the moved " +
        "file's own relative imports from its new location, writes the file at the new path, and removes " +
        'the old one. Use this instead of manually editing every caller after a move (which misses some ' +
        'and breaks the build).',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Current workspace path (e.g. src/components/Button.tsx).' },
          to: { type: 'string', description: 'New workspace path (e.g. src/ui/Button.tsx).' },
        },
        required: ['from', 'to'],
      },
    },
    {
      name: 'generate_gitignore',
      description:
        'Generate a correct, stack-aware .gitignore so node_modules, build output and ' +
        '.env secrets are never committed. Framework-specific entries are added from the ' +
        "project's real dependencies. Writes the result to .gitignore.",
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional output path (defaults to .gitignore).' },
        },
      },
    },
    {
      name: 'generate_app_defaults',
      description:
        'Give the app the production quality basics BY DEFAULT — SEO/OpenGraph meta tags, a mobile ' +
        'viewport, an html lang attribute, a web app manifest and robots.txt — adding ONLY what is ' +
        'missing (idempotent, never clobbers an existing manifest/robots). Patches a standard index.html ' +
        '(Vite/CRA/static); if there is none (e.g. Next.js) it writes the standalone files and says so. ' +
        'Run it once the app has an entry HTML so it ships search-friendly, shareable and installable.',
      input_schema: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'The app name for the title / manifest / OG tags (defaults to "App").' },
        },
      },
    },
    {
      name: 'generate_openapi',
      description:
        'Generate a real OpenAPI 3.0.3 contract for the backend API you built and write it to the ' +
        'workspace (default openapi.json). Pass the routes you actually created — paths are converted ' +
        'from Express style (/users/:id → /users/{id}) and path params are auto-derived. Use this for ' +
        'any app with an HTTP API so it ships with a real, machine-readable contract (nothing invented).',
      input_schema: {
        type: 'object',
        properties: {
          routes: {
            type: 'array',
            description: 'The API routes you built.',
            items: {
              type: 'object',
              properties: {
                method: { type: 'string', description: 'HTTP method, e.g. GET/POST/PUT/DELETE.' },
                path: { type: 'string', description: 'Route path, e.g. /users/:id.' },
                summary: { type: 'string', description: 'Optional one-line description of the route.' },
              },
              required: ['method', 'path'],
            },
          },
          title: { type: 'string', description: 'Optional API title (defaults to "Generated API").' },
          version: { type: 'string', description: 'Optional API version (defaults to 1.0.0).' },
          path: { type: 'string', description: 'Optional output path (defaults to openapi.json).' },
        },
        required: ['routes'],
      },
    },
    {
      name: 'generate_api_docs',
      description:
        'Generate a human-readable API reference (Markdown) for the backend you built and write it to ' +
        'the workspace (default API.md). Pass the routes you actually created; produces a sorted ' +
        'method/path/auth/description table. Use this alongside generate_openapi so the API has both a ' +
        'machine-readable contract and readable docs (nothing invented — only the routes you pass).',
      input_schema: {
        type: 'object',
        properties: {
          routes: {
            type: 'array',
            description: 'The API routes you built.',
            items: {
              type: 'object',
              properties: {
                method: { type: 'string', description: 'HTTP method, e.g. GET/POST.' },
                path: { type: 'string', description: 'Route path, e.g. /users/:id.' },
                description: { type: 'string', description: 'Optional description of what the route does.' },
                auth: { type: 'boolean', description: 'Whether the route requires authentication.' },
              },
              required: ['method', 'path'],
            },
          },
          path: { type: 'string', description: 'Optional output path (defaults to API.md).' },
        },
        required: ['routes'],
      },
    },
    {
      name: 'generate_tests',
      description:
        'Generate a runnable Vitest unit-test SKELETON for a module you built and write it to the ' +
        'workspace. Each function gets one assertion that is TRUE BY CONSTRUCTION (the export exists ' +
        'and is callable — which catches a renamed or dropped export) plus an `it.todo` for the real ' +
        'behaviour, which vitest reports as PENDING. It never invents arguments and never fakes a ' +
        'passing assertion, so a fresh app can never ship a red suite for correct code. ' +
        'Use this to seed real tests for services/hooks/utils after building them.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Output test file path, e.g. src/services/auth.test.ts.' },
          module_path: { type: 'string', description: 'Import specifier the test imports from, e.g. ./auth.' },
          functions: {
            type: 'array',
            description: 'The exported functions to scaffold tests for.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Function name (must be a real export).' },
                params: { type: 'array', items: { type: 'string' }, description: 'Parameter names (to scaffold the call).' },
                async: { type: 'boolean', description: 'Whether the function is async (the test will await it).' },
              },
              required: ['name'],
            },
          },
        },
        required: ['path', 'module_path', 'functions'],
      },
    },
    {
      name: 'generate_integration_tests',
      description:
        'Generate a REAL integration-test suite for a REST resource — a full create → read → update → ' +
        'delete → 404 lifecycle test (supertest) with real assertions on real response bodies (NOT the ' +
        'TODO skeletons generate_tests emits), PLUS a working in-memory reference app it runs against, so ' +
        'the suite is green out of the box. Swap the app import to test your real Express backend. Use this ' +
        'to verify a CRUD API end-to-end. Needs supertest + express (dev). No API key.',
      input_schema: {
        type: 'object',
        properties: {
          resource: { type: 'string', description: 'Singular resource name, e.g. "product" (default "item").' },
          base_path: { type: 'string', description: 'Base route, e.g. "/products" (default: "/" + resource + "s").' },
          fields: {
            type: 'array',
            description: 'Resource fields; the first is the required field validated on create.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name.' },
                type: { type: 'string', enum: ['string', 'number', 'boolean'], description: 'Field type (default string).' },
              },
              required: ['name'],
            },
          },
        },
      },
    },
    {
      name: 'generate_e2e',
      description:
        'Scaffold an end-to-end (Playwright) test setup for the running app: a playwright.config.ts that ' +
        'starts your dev server, plus an e2e/smoke.spec.ts that loads the app in a REAL browser and asserts ' +
        'it renders — failing on a blank screen, a build-error overlay, or a console/page error (render, not ' +
        'just compile). Adds one nav test per known route, and adds @playwright/test + the test:e2e scripts to ' +
        'package.json (never clobbering existing files). Use it to give a real app a runnable E2E smoke net.',
      input_schema: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'Optional app name for the test titles (defaults to "App").' },
        },
      },
    },
    {
      name: 'run_tests',
      description:
        "Detect and RUN the project's OWN test suite and report honest pass/fail — stronger proof the build " +
        'works than a typecheck. Auto-detects the runner from the workspace (a real npm "test" script, or ' +
        'vitest/jest/playwright config, or Python pytest, or Java/Kotlin Maven or Gradle, or Go tests) and runs it in ' +
        'the sandbox, then returns parsed counts (passed/failed/total) and the names of failing tests. Takes ' +
        'no arguments. If it reports failures, fix them and run it again; if it reports no suite, seed real ' +
        'tests with generate_tests first — never claim the build is verified without running its tests.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'find_dead_code',
      description:
        'Find built-but-unwired modules — files that NOTHING imports and that are not entry points, tests, ' +
        'configs or file-based routes. Catches the common "created a component/hook/util and forgot to wire ' +
        'it in" bug (it compiles, but the feature never appears). Read-only, no arguments. Results are ' +
        'candidates — verify each is truly unused (dynamic imports / string references are not visible) ' +
        'before removing or wiring it in.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'architecture_map',
      description:
        'Get a quick "how is this app structured / where do I start" orientation before editing an ' +
        'unfamiliar or imported codebase. Returns the entry points, the most-imported core modules, the ' +
        'structural areas (by directory), the key external dependencies, and a suggested reading order — ' +
        'derived from the real import graph, not guessed. Read-only, takes no arguments. Call it first ' +
        'when onboarding to a project you did not just build, so your edits are deliberate.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'api_graph',
      description:
        'Cross-check the backend routes the project DEFINES against the API calls its frontend MAKES, and ' +
        'flag every frontend call that has NO matching backend route (the classic silent full-stack bug: ' +
        'it compiles and the preview loads, but the feature is broken at runtime). Also lists routes with ' +
        'no caller. Detects Express/Fastify, FastAPI/Flask and Spring routes, and fetch/axios calls. ' +
        'Run it on a full-stack app before declaring it done, then fix any ' +
        'MISSING call by adding the route or correcting the path/method. ' +
        'Optional `endpoint="METHOD /path"` (or just "/path") drills into ONE route\'s change-propagation ' +
        'blast radius — the frontend call sites that depend on it — so you can review them before renaming, ' +
        'removing, or changing that route\'s method/path. Omit it for the whole-graph overview.',
      input_schema: {
        type: 'object',
        properties: {
          endpoint: {
            type: 'string',
            description: 'Optional "METHOD /path" (or bare "/path") to see that route\'s blast radius — the frontend call sites that depend on it. Omit for the whole graph.',
          },
        },
      },
    },
    {
      name: 'code_graph',
      description:
        "Query the project's structure from the indexed code graph instead of guessing or grepping. " +
        'Answers, for a file: who imports it ("who_imports"), what it imports locally ("depends_on"), and ' +
        'the full set of files a change to it would affect directly or transitively ("impact"); and for a ' +
        'symbol name: where it is defined ("defines") and every file that USES/CALLS it ("references"). Use ' +
        '"impact" BEFORE editing a shared file to see the blast radius, "who_imports" to find every call ' +
        'site to update, and "references" to find every place a function/component is used before renaming ' +
        'or changing its signature — safer than editing blind. Deterministic and read-only.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            enum: ['impact', 'who_imports', 'depends_on', 'defines', 'references'],
            description: 'impact/who_imports/depends_on take a FILE target; defines and references take a SYMBOL name. Default: impact.',
          },
          target: { type: 'string', description: 'A workspace file path (e.g. src/App.tsx) or, for "defines"/"references", a symbol name.' },
        },
        required: ['target'],
      },
    },
    {
      name: 'typecheck',
      description:
        'Find WHERE the app fails to compile — and type-check every language. It parses every frontend ' +
        'JS/TS/JSX/TSX file and reports the EXACT `file:line:column` of any SYNTAX error (an unbalanced ' +
        'or mismatched tag, a missing `)`/`}`, a duplicate declaration), then compiles the other ' +
        'languages present (Python, Java, Go). ALWAYS call this to locate a compile/syntax error — it gives ' +
        'you the precise location in one step. NEVER hand-count `<div>` tags or braces with grep/awk/' +
        'python; that wastes steps and misses the real spot. Takes no arguments. Run it before declaring ' +
        'a build verified and fix each reported location.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'check_toolchain',
      description:
        'Report the toolchain the project DECLARES it needs (Node from .nvmrc/engines, Python from ' +
        '.python-version/pyproject, Java from Maven pom.xml or Gradle build.gradle, Go from go.mod) and flag any INTERNAL contradiction ' +
        '(two files pinning different versions) — a silent cause of "works for them, breaks here" build ' +
        'drift on imported repos. Read-only, no arguments. Fix a flagged inconsistency by pinning one ' +
        'version across the files.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'check_package',
      description:
        'Health-check package.json for two common ship-blockers other checks miss: an npm SCRIPT that ' +
        'runs a build tool the project never installed (e.g. a "lint" script calling eslint with no ' +
        'eslint dependency — it dies with "command not found"), and a package declared in both ' +
        'dependencies and devDependencies. Read-only, no arguments. Run it before declaring the build ' +
        'done; fix any missing tool by adding its package.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'lint',
      description:
        "Run the project's OWN ESLint and Prettier and report real issues — catches a class of bugs a " +
        'typecheck does NOT (unused variables, react-hooks exhaustive-deps, no-undef, promise misuse) plus ' +
        'formatting drift. Auto-detects the config; ESLint errors fail the check (warnings are reported ' +
        'but do not), Prettier lists files that need formatting. Takes no arguments. Run it alongside ' +
        'typecheck and run_tests before declaring a build done; fix ESLint errors and run prettier --write.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_observability',
      description:
        'Add real, dependency-free observability to the app you built and write the files to the ' +
        'workspace: a client-side error handler (window error + unhandledrejection → structured logs), ' +
        'an Express request-logger middleware (method/path/status/duration), and a GET /health endpoint. ' +
        'Use "target" to pick frontend, backend, or both. After writing, wire each file in with edit_file ' +
        '(the tool result lists the exact one-line import/mount for each). Use this once the app has a ' +
        'backend and/or a frontend entry so the deployed app is not a black box.',
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['frontend', 'backend', 'both'],
            description: 'Which side to instrument. Defaults to "both".',
          },
        },
      },
    },
    {
      name: 'generate_bundle_optimization',
      description:
        'Add real, dependency-free bundle optimization to a Vite+React app: writes a `lazyWithRetry` ' +
        'helper (React.lazy route code-splitting with a one-time reload on a stale chunk) and a Rollup ' +
        '`manualChunks` config that splits node_modules into react-vendor/vendor chunks. If the app has ' +
        'no vite.config it writes a complete optimized one; otherwise the tool result returns the ' +
        'manualChunks snippet for you to merge with edit_file. After writing, wrap page-level components ' +
        'with lazyWithRetry inside <Suspense>. Use this for production-ready apps to shrink the initial bundle.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'generate_seed_data',
      description:
        'Generate realistic, deterministic SEED DATA for the app\'s entities and write it to ' +
        'fixtures/seed.json — so the app can be exercised with sample rows instead of an empty database. ' +
        'Pass the entities you built with their fields; values are derived from each field\'s name/type ' +
        '(name→names, email→emails, price→numbers, created_at→ISO dates, status→enum, etc.), seeded by row ' +
        'index so the data is varied but reproducible. Use after defining the data model.',
      input_schema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            description: 'The entities to seed.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Entity/table name (becomes a key in seed.json).' },
                fields: {
                  type: 'array',
                  description: 'The entity fields.',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Field name (drives the generated value).' },
                      type: { type: 'string', description: 'Optional type hint: string|number|integer|float|boolean|date|email.' },
                    },
                    required: ['name'],
                  },
                },
              },
              required: ['name', 'fields'],
            },
          },
          count: { type: 'number', description: 'Rows per entity (default 10, max 1000).' },
          path: { type: 'string', description: 'Output path (default fixtures/seed.json).' },
        },
        required: ['entities'],
      },
    },
    {
      name: 'generate_auth',
      description:
        'Generate REAL, working authentication code for the app and write it to the workspace. ' +
        'type "jwt" (default) writes a dependency-free HS256 JWT module (sign/verify via Node crypto, ' +
        'reads JWT_SECRET) plus an Express Bearer-token middleware — runs with no install. type ' +
        '"supabase" writes signup/login/logout/password-reset/session helpers against the user\'s OWN Supabase project (nothing to configure — the keys are already in the workspace); prefer it when a Supabase database is connected. ' +
        '"firebase" writes client auth helpers (signIn/signUp/signOut/onAuthChange) over the Firebase ' +
        'SDK (needs `firebase` installed). Use when the app needs login/protected routes — then wire ' +
        'signToken on login and the middleware onto protected routes with edit_file.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['jwt', 'firebase', 'supabase'], description: 'Auth strategy. Use "supabase" whenever the app has a Supabase database connected — it needs NO configuration from the user. Defaults to "jwt" (dependency-free).' },
        },
      },
    },
    {
      name: 'generate_migration',
      description:
        'Generate database migration artifacts from the app\'s entities and write them to the workspace: ' +
        'a Prisma schema (prisma/schema.prisma) and/or a SQL CREATE TABLE migration (migrations/001_init.sql). ' +
        'Pass the entities you built with their fields; column types are inferred from each field\'s name/type ' +
        '(id→PK, email→unique, *_at→timestamp, price→float, count→int, etc.). Use after defining the data model.',
      input_schema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            description: 'The entities to generate a schema for.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Entity/model name.' },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Field name.' },
                      type: { type: 'string', description: 'Optional type hint: string|int|float|boolean|date.' },
                    },
                    required: ['name'],
                  },
                },
              },
              required: ['name', 'fields'],
            },
          },
          dialect: { type: 'string', enum: ['prisma', 'sql', 'both'], description: 'Output dialect (default both).' },
          provider: { type: 'string', enum: ['postgresql', 'mysql', 'sqlite'], description: 'SQL provider (default postgresql).' },
        },
        required: ['entities'],
      },
    },
    {
      name: 'generate_deploy_config',
      description:
        'Add a platform deploy config for a git-push / container PaaS: target "render" (render.yaml Blueprint), ' +
        '"railway" (railway.json, Nixpacks + health check + restart policy), "fly" (fly.toml, http_service + ' +
        'health check), "aws" (apprunner.yaml — AWS App Runner source deploy), or "azure" (azure.yaml — Azure ' +
        'Developer CLI `azd up` → Azure Container Apps). Emits the ONE config file that target needs (references ' +
        '/health + PORT). HONEST: it generates config — the user deploys from their OWN account (BYO), it does ' +
        'not auto-deploy. Use when the user wants to deploy to Railway/Render/Fly/AWS/Azure. (One-click deploy ' +
        'exists for Firebase/Vercel/Netlify/Cloudflare; multi-service AWS/Azure IaC → generate_iac.) Pairs with ' +
        'generate_deploy_artifacts (Dockerfile).',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['railway', 'render', 'fly', 'aws', 'azure'], description: 'The PaaS / container target to emit config for.' },
        },
        required: ['target'],
      },
    },
    {
      name: 'generate_deploy_artifacts',
      description:
        'Generate deployment artifacts for the app and write them to the workspace: a production ' +
        'Dockerfile (alpine, multi-stage, non-root), a docker-compose.yml, and a GitHub Actions CI ' +
        'workflow (.github/workflows/ci.yml). By default all three are written; pass "include" to pick ' +
        'a subset. Build/start/lint/test commands and node version/port are configurable — only the ' +
        'commands you provide become steps (no placeholder steps). Use before shipping a real app.',
      input_schema: {
        type: 'object',
        properties: {
          include: {
            type: 'array',
            description: "Which artifacts to write. Any of 'docker', 'compose', 'ci'. Defaults to all three.",
            items: { type: 'string', enum: ['docker', 'compose', 'ci'] },
          },
          nodeVersion: { type: 'string', description: 'Node major version (default 20).' },
          port: { type: 'number', description: 'Exposed/app port (default 8080).' },
          installCmd: { type: 'string', description: 'Install command (default npm ci).' },
          buildCmd: { type: 'string', description: 'Build command (omitted if empty).' },
          startCmd: { type: 'string', description: 'Start command (default npm start).' },
          lintCmd: { type: 'string', description: 'Lint command for CI (omitted if empty).' },
          testCmd: { type: 'string', description: 'Test command for CI (omitted if empty).' },
          multiStage: { type: 'boolean', description: 'Multi-stage Dockerfile (default true).' },
        },
      },
    },
    {
      name: 'generate_iac',
      description:
        'Generate Infrastructure-as-Code to deploy the app to a cluster or cloud: Kubernetes manifests ' +
        '(k8s/manifests.yaml — a non-root Deployment with health probes + resource limits, a Service, an ' +
        'HPA, and an Ingress when a host is given), a Helm chart (values-parameterized), Terraform for ' +
        'Google Cloud Run (terraform/*.tf), and an Ansible playbook (ansible/ — deploys the container to ' +
        'your own SSH hosts via community.docker). By default all four are written; pass "include" to pick a ' +
        'subset. Deterministic; the operator runs `kubectl apply` / `helm install` / `terraform apply` / `ansible-playbook`.',
      input_schema: {
        type: 'object',
        properties: {
          include: {
            type: 'array',
            description: "Which IaC to write. Any of 'k8s', 'helm', 'terraform', 'ansible'. Defaults to all four.",
            items: { type: 'string', enum: ['k8s', 'helm', 'terraform', 'ansible'] },
          },
          appName: { type: 'string', description: 'Service name (sanitised to a DNS-1123 label; default "app").' },
          image: { type: 'string', description: 'Container image reference, e.g. ghcr.io/acme/app:1.2.3 (default app:latest).' },
          port: { type: 'number', description: 'Container port the app listens on (default 8080).' },
          replicas: { type: 'number', description: 'Desired replicas (default 2).' },
          env: { type: 'array', description: "Env vars as 'KEY=value' or 'KEY' strings.", items: { type: 'string' } },
          host: { type: 'string', description: 'Ingress host, e.g. app.example.com (omit to skip the Ingress).' },
          healthPath: { type: 'string', description: 'HTTP path for liveness/readiness probes (default /health).' },
        },
      },
    },
    {
      name: 'scan_vulnerabilities',
      description:
        'Scan the app\'s dependencies for known security vulnerabilities against the OSV.dev database ' +
        '(CVEs + GitHub advisories). Reads package.json (+ package-lock.json for exact versions) and reports ' +
        'each vulnerable package with its advisory IDs. HONEST: if OSV.dev is unreachable it says the scan ' +
        'could not run — it never reports a fake clean result. Run before shipping a real app. No arguments.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'check_licenses',
      description:
        'Check the app\'s dependency LICENSES for copyleft-compliance risk. Reads package-lock.json and ' +
        'classifies each dependency\'s SPDX license, flagging strong-copyleft (GPL/AGPL) packages that could ' +
        'require you to release your own source, plus weak-copyleft (LGPL/MPL) ones for awareness, and ' +
        'confirms "no copyleft risk" when clean. Pure/offline (no network); advisory only — it never blocks a ' +
        'build. Run before shipping a real app. No arguments.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'threat_model',
      description:
        'Threat-model the app\'s OWN code (complements scan_vulnerabilities, which covers dependencies). A ' +
        'high-precision scan for the most exploitable web-app defects: a secret hardcoded into client-side ' +
        'code (ships to the browser), a wildcard CORS with credentials, SQL built by string interpolation ' +
        '(injection), XSS via dangerouslySetInnerHTML from a non-constant, and eval()/new Function() on a ' +
        'non-literal. Each finding names the file, line and fix. Pure/offline; advisory only — never blocks a ' +
        'build. Run before shipping a real app. No arguments.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'run_migrations',
      description:
        'Apply the database schema before the app runs. Detects the migration tool the project uses ' +
        '(Prisma, Knex, Drizzle, TypeORM, Sequelize, Flyway, Alembic) from its config files + dependencies, ' +
        'then runs the migration command(s) in the sandbox and reports the REAL exit code + output — never a ' +
        'fake "migrated". Pass dryRun:true to see the detected plan without running it. Run for a fullstack ' +
        'app with a database, so it does not boot against an empty schema and crash.',
      input_schema: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean', description: 'Report the detected migration plan without executing it.' },
        },
      },
    },
    {
      name: 'generate_db_config',
      description:
        'Wire the app to connect to the user\'s OWN database (Bring-Your-Own): generates a real client module ' +
        '(src/lib/*) + the .env.example keys + the npm dependency for the chosen provider (supabase, neon, ' +
        'firebase, postgres). The user pastes their credentials into .env — NavBharatAI never stores them. ' +
        'This wires the connection; it does NOT auto-create the database (that needs the provider\'s console). ' +
        'It never overwrites an existing .env.example. Use for a fullstack app that needs a database.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['supabase', 'neon', 'firebase', 'postgres'], description: 'The database provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_payment',
      description:
        'Add a REAL payment checkout to the app (Bring-Your-Own keys): a server route (creates the order/' +
        'session AND verifies the payment signature — never trusts the client) + a client checkout helper, ' +
        'for razorpay (India-first) or stripe. The user pastes their provider keys into .env — NavBharatAI ' +
        'never stores them. Use when the app needs to accept payments. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['razorpay', 'stripe'], description: 'The payment provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_email',
      description:
        'Add real transactional email to the app (Bring-Your-Own key): a server-side sendEmail() helper for ' +
        'resend or sendgrid — for signup confirmation, password reset, receipts, notifications. The user pastes ' +
        'their API key + a verified sender into .env; NavBharatAI never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['resend', 'sendgrid'], description: 'The email provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_storage',
      description:
        'Add real file uploads to the app (Bring-Your-Own keys): a server route + a client uploadFile() helper ' +
        'that uploads DIRECTLY to storage (never proxied through the server). "s3" (AWS S3 / Cloudflare R2 / ' +
        'Supabase Storage / MinIO via a presigned URL) or "cloudinary" (image-focused, signed upload). The user ' +
        'pastes their keys into .env; NavBharatAI never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['s3', 'cloudinary'], description: 'The storage provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_realtime',
      description:
        'Add real realtime pub/sub to the app for live features (chat, notifications, presence, collaborative ' +
        'updates): a server publish() helper + a client subscribe() that returns an unsubscribe cleanup, for ' +
        '"pusher" or "ably". The user pastes their keys into .env (the secret stays server-side); NavBharatAI ' +
        'never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['pusher', 'ably'], description: 'The realtime provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_search',
      description:
        'Add real full-text search to the app (Bring-Your-Own keys): a server indexer (indexRecords, uses the ' +
        'admin/write key) + a client search() (uses a search-only key), for "algolia" or "meilisearch". The ' +
        'admin key stays server-side; the browser uses the search-only key. The user pastes their keys into ' +
        '.env; NavBharatAI never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['algolia', 'meilisearch'], description: 'The search provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_otp',
      description:
        'Add real phone-OTP verification/login to the app (Bring-Your-Own keys): a server route that SENDS an ' +
        'OTP and VERIFIES it server-side (a client-reported success is never trusted) + a client sendOtp/' +
        'verifyOtp helper, for "msg91" (India-first) or "twilio" (Verify API). The user pastes their provider ' +
        'credentials into .env (they stay server-side); NavBharatAI never stores them. Never overwrites an ' +
        'existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['msg91', 'twilio'], description: 'The OTP/SMS provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_totp',
      description:
        'Add real authenticator-app two-factor auth (TOTP, RFC 6238) to the app (server/lib/totp.ts): a ' +
        'dependency-free (node:crypto) base32 secret generator, an otpauth:// provisioning URI to show as a ' +
        'QR code (pair with generate_qr) for Google Authenticator / Authy / 1Password, and a constant-time ' +
        'verify with a ±1-step clock-drift window. This is app-based 2FA — distinct from generate_otp, which ' +
        'is SMS/phone one-time codes. No API key, no dependency. Use to add a second factor to login.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_indian_validators',
      description:
        'Add real Indian identity/format validators to the app (server/lib/indianValidators.ts): dependency-' +
        'free isValidPAN, isValidGSTIN, isValidAadhaar, isValidIFSC, isValidPincode, isValidUPI, ' +
        'isValidIndianMobile. GSTIN and Aadhaar verify the REAL government CHECKSUM (GSTIN mod-36, Aadhaar ' +
        'Verhoeff), so a single mistyped character is caught at the form instead of failing later in a payout ' +
        'or a tax filing — a bare regex would let it through. Use at signup/KYC/invoice/payout forms. No env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_analytics',
      description:
        'Add real product analytics to the app (Bring-Your-Own keys): a server capture helper (private key) + ' +
        'a client init/track/identify helper (public key, no-ops safely if no key is set), for "posthog" or ' +
        '"mixpanel". The user pastes their token into .env; NavBharatAI never stores it. Never overwrites an ' +
        'existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['posthog', 'mixpanel'], description: 'The analytics provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_map',
      description:
        'Add a real interactive map to the app (Bring-Your-Own key): a client createMap(container, {center, ' +
        'zoom}) + addMarker helper, for "googlemaps" or "mapbox". Useful for delivery tracking, store ' +
        'locators, real-estate and local-services apps. The user pastes their PUBLIC browser map key into ' +
        '.env (restricted by referrer); NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['googlemaps', 'mapbox'], description: 'The map provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_jobs',
      description:
        'Add real background-job processing / a task queue to the app (Bring-Your-Own infra): a server ' +
        'enqueueJob(queue, data) + processJobs(queue, handler) helper, for "bullmq" (Redis-backed) or ' +
        '"pgboss" (Postgres-backed). Moves slow work (email, image processing, webhooks, scheduled tasks) ' +
        'off the request path. The user points REDIS_URL / DATABASE_URL at their own infra in .env; ' +
        'NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['bullmq', 'pgboss'], description: 'The job-queue backend to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_scheduler',
      description:
        'Add a real recurring-job scheduler to the app (server/lib/scheduler.ts): dependency-free ' +
        'scheduleEvery(ms, fn) for fixed-interval work (hourly sync, cleanup) and scheduleDailyUtc(hour, ' +
        'minute, fn) for "run once a day at HH:MM UTC" (nightly purge, daily digest). The daily job recomputes ' +
        'its next run each day so it never drifts, a thrown run never stops the loop, and each returns stop(). ' +
        'Distinct from generate_jobs (a queue for off-request work). Honest scope: in-process (alive-only) — ' +
        'for a guaranteed run across restarts/scale-to-0, drive it from an external cron. No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_sms',
      description:
        'Add real transactional SMS to the app (Bring-Your-Own keys): a server sendSms(to, body) helper for ' +
        '"twilio" or "vonage" — for order confirmations, shipping/appointment alerts and notifications. Always ' +
        'server-side (credentials never reach the browser). For login/verification OTP use generate_otp ' +
        'instead. The user pastes their keys into .env; NavBharatAI never stores them. Never overwrites an ' +
        'existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['twilio', 'vonage'], description: 'The SMS provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_password',
      description:
        'Add real secure password hashing to the app (server/lib/password.ts, bcryptjs): hashPassword(plain) ' +
        '(bcrypt cost 12, per-password salt) to store at signup — NEVER plaintext or a fast MD5/SHA hash — ' +
        'verifyPassword(plain, hash) (constant-time, fails safe) to gate login, and needsRehash(hash) to ' +
        'transparently upgrade older hashes. Complements generate_auth (issue the JWT/session only AFTER ' +
        'verifyPassword). bcryptjs is pure JS (no native build). Adds the bcryptjs dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_ratelimit',
      description:
        'Add real API rate limiting to the app (express-rate-limit): an apiLimiter middleware you mount with ' +
        'app.use("/api", apiLimiter), to stop abuse/brute-force/request storms. Store = "memory" (single ' +
        'instance, no infra) or "redis" (a shared counter across all instances once horizontally scaled — ' +
        'Bring-Your-Own Redis via REDIS_URL). NavBharatAI never stores the URL. Never overwrites an existing ' +
        '.env.example.',
      input_schema: {
        type: 'object',
        properties: {
          store: { type: 'string', enum: ['memory', 'redis'], description: 'The counter store: in-memory (single instance) or Redis (distributed).' },
        },
        required: ['store'],
      },
    },
    {
      name: 'generate_api_versioning',
      description:
        'Add real API versioning to the app (server/lib/apiVersion.ts): a dependency-free Express middleware ' +
        'that resolves the client-requested version from the X-API-Version header (or the standard ' +
        'Accept-Version), accepts "v2" or "2", falls back to a default when none is sent, and rejects an ' +
        'unknown version with 406 + the supported list. The resolved version is on req.apiVersion (branch on ' +
        'it, or mount separate v1/v2 routers) and echoed on the response. Lets the app evolve its API without ' +
        'breaking existing clients. No dependency, no key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_graphql',
      description:
        'Add a real runnable GraphQL API to the app (server/graphql/schema.ts + yoga.ts, graphql + ' +
        'graphql-yoga). Emits a schema-first setup with a WORKING example (a Query health/items/item, a typed ' +
        'Item, and an addItem Mutation with input validation) plus a one-line-mountable yoga handler (Express: ' +
        'app.use(yoga.graphqlEndpoint, yoga)). GraphiQL explorer is on in dev. Use when the user wants a ' +
        'GraphQL (not REST) backend; extend the SDL + resolvers and swap the demo store for your DB. No env key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_crud',
      description:
        'Generate a COMPLETE REST CRUD resource for one entity on Prisma: a zod validation schema, plus an ' +
        'Express router with a paginated + filterable + sortable list (?page,?limit,?sort=field:asc|desc,' +
        '?field=value), get-by-id, validated create/update, and SOFT delete (sets deletedAt). Also emits a ' +
        "shared Prisma client and a central error handler. Pairs with generate_migration's schema. Set " +
        'protected:true to require an authenticated req.user on every mutation. Use after defining the entity.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Resource/model name (e.g. "Post").' },
          fields: {
            type: 'array',
            description: 'The resource fields (id + created_at/updated_at/deleted_at are managed automatically).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name.' },
                type: { type: 'string', description: 'Optional type hint: string|int|float|boolean|date.' },
              },
              required: ['name'],
            },
          },
          protected: { type: 'boolean', description: 'Require an authenticated req.user on create/update/delete (default false).' },
        },
        required: ['name', 'fields'],
      },
    },
    {
      name: 'generate_booking',
      description:
        'Add a real booking/appointment backend to the app (server/booking/) — a packaged domain vertical for ' +
        'clinics, salons, tutors, consultants. The real guarantee is correct DOUBLE-BOOKING PREVENTION: a slot ' +
        'holds at most one confirmed booking and cancelling frees it. Emits a dependency-free BookingService ' +
        '(book / cancel / isSlotAvailable / list) + an Express router (POST /bookings → 409 if the slot is ' +
        'taken, GET /bookings filterable, GET /slots/:id/available, DELETE /bookings/:id) + a README. In-memory ' +
        'by default — swap the store for your DB (same contracts). Slots are defined by your app; pairs with ' +
        'the OTP/payment/notification recipes for a full flow.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_inventory',
      description:
        'Add a real inventory/stock backend to the app (server/inventory/) — a packaged domain vertical for ' +
        'retail/e-commerce. The real guarantee is NO OVERSELLING: reserve() rejects when stock is insufficient ' +
        'and never lets on-hand go negative. Emits a dependency-free InventoryService (setStock / restock / ' +
        'reserve / release / isLowStock / list) + an Express router (GET /stock, GET/PUT /stock/:sku, POST ' +
        '/stock/:sku/reserve → 409 if insufficient, POST /stock/:sku/release) + a README. In-memory by default ' +
        '— swap the store for your DB (same contracts). Pairs with the payment/notification/audit recipes for a ' +
        'full order flow.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_crm',
      description:
        'Add a real CRM / lead-pipeline backend to the app (server/crm/) — a packaged domain vertical for any ' +
        'SMB with a sales motion. The real guarantee is a sales-stage STATE-MACHINE: a lead moves ' +
        'new → contacted → qualified → won/lost along allowed transitions only (won/lost terminal except a ' +
        'reopen to new), and an invalid jump is rejected. Emits a dependency-free CrmService (contacts, leads, ' +
        'moveStage, assign, notes, filtered list, openPipelineValue) + an Express router (GET/POST /contacts + ' +
        '/leads, PATCH /leads/:id/stage → 409 on invalid transition, PATCH /leads/:id/assign, POST ' +
        '/leads/:id/notes, GET /pipeline/value) + a README. In-memory by default — swap the store for your DB. ' +
        'Pairs with the auth/notification/audit recipes.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_hospital_erp',
      description:
        'Add a real Hospital-ERP / EMR backend to the app (server/hospital/) — a packaged domain vertical for a ' +
        'clinic or hospital. THREE real guarantees: (1) NO DOUBLE-BOOKING — bookAppointment() rejects any ' +
        'appointment overlapping an existing non-cancelled one for the same doctor (router → 409); (2) RBAC — a ' +
        'role→permission matrix gates patient-record writes (admin/doctor/nurse write, receptionist read-only; ' +
        '403 on a blocked write); (3) AUDIT — every record write appends an immutable audit entry. Emits a ' +
        'dependency-free HospitalService (patients, encounter notes, appointments, audit trail) + an Express ' +
        'router (GET/POST /patients, GET /patients/:id, GET/POST /patients/:id/notes, GET/POST /appointments → ' +
        '409 on double-book, PATCH /appointments/:id/status, GET /audit) + a README. In-memory by default — swap ' +
        'the Maps for your DB. Pairs with the auth/RBAC/audit recipes. Use for hospital / clinic / EMR prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_school_erp',
      description:
        'Add a real School / Education-ERP backend to the app (server/school/) — a packaged domain vertical ' +
        'for schools, coaching institutes and LMS apps. THREE real guarantees: (1) IDEMPOTENT ATTENDANCE — ' +
        'marking a (student, class, date) is idempotent (a repeat mark updates the same record, never a ' +
        'duplicate; 404 if the student is not enrolled in the class); (2) VALID GRADES — a score must be within ' +
        '0..maxMarks (409 otherwise) and a student percentage is computed exactly; (3) EXACT FEE LEDGER — a ' +
        'balance = invoiced − paid, a payment over the balance is rejected (409, never negative), append-only. ' +
        'Emits a dependency-free SchoolService (classes, enrollment, attendance, assessments, grades, fee ledger) ' +
        '+ an Express router (POST /classes, /students, /attendance, /assessments, /grades, /fees/invoice, ' +
        '/fees/pay; GET rosters/attendance/percentage/fees) + a README. In-memory by default — swap the Maps for ' +
        'your DB. Pairs with the auth/notification/payment recipes. Use for school / coaching / LMS prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_courier',
      description:
        'Add a real Courier / Logistics backend to the app (server/courier/) — a packaged domain vertical for ' +
        'delivery, courier and last-mile apps. THREE real guarantees: (1) SHIPMENT STATE-MACHINE — status moves ' +
        'created → picked_up → in_transit → out_for_delivery → delivered along allowed transitions only (a ' +
        'failed_attempt loops back; delivered/returned/cancelled are terminal), an invalid jump rejected (409); ' +
        '(2) APPEND-ONLY tracking history — every status change appends an immutable event; (3) UNIQUE tracking ' +
        'numbers with exact lookup. Emits a dependency-free CourierService (createShipment, advanceStatus, ' +
        'assignDriver, getByTracking, history, list) + an Express router (POST/GET /shipments, GET ' +
        '/shipments/:id, PATCH /shipments/:id/status → 409 on invalid, PATCH /shipments/:id/driver, GET ' +
        '/shipments/:id/history, GET /track/:trackingNo public) + a README. In-memory by default — swap the Maps ' +
        'for your DB. Pairs with the auth/notification/maps recipes. Use for courier / delivery / logistics prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_restaurant_pos',
      description:
        'Add a real Restaurant / POS backend to the app (server/restaurant/) — a packaged domain vertical for ' +
        'restaurants, cafés and cloud kitchens. THREE real guarantees: (1) TABLE STATE-MACHINE — a table moves ' +
        'free → occupied → billing → free along allowed transitions only (seating an occupied table is rejected, ' +
        '409); (2) KOT ORDER LIFECYCLE — an order moves placed → preparing → served → closed and items can be ' +
        'added only while it is open (409 otherwise); (3) EXACT GST BILL — subtotal + CGST + SGST (split from the ' +
        'per-item or default GST rate) + grand total, computed exactly. Emits a dependency-free RestaurantService ' +
        '(menu, tables, openOrder, addLine, setOrderStatus, bill, closeOrder) + an Express router (GET/POST /menu ' +
        '+ /tables, POST /orders, POST /orders/:id/lines, PATCH /orders/:id/status, GET /orders/:id/bill, POST ' +
        '/orders/:id/close) + a README. In-memory by default — swap the Maps for your DB. Pairs with the ' +
        'auth/payment/notification recipes. Use for restaurant / café / menu / KOT / POS prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_real_estate',
      description:
        'Add a real Real-estate / property-portal backend to the app (server/realestate/) — a packaged domain ' +
        'vertical for property listing sites and brokerages. THREE real guarantees: (1) LISTING STATE-MACHINE — ' +
        'a property moves draft → available → under_offer → sold|rented along allowed transitions only (withdraw ' +
        'from market; sold/rented/withdrawn terminal), an invalid jump rejected (409); (2) APPEND-ONLY price ' +
        'history — every price change logs {from,to,at}; (3) INQUIRY CAPTURE — inquiries + price changes are ' +
        'accepted only while the listing is on the market (409 otherwise). Emits a dependency-free ' +
        'RealEstateService (createListing, setStatus, changePrice, addInquiry, priceHistory, search) + an Express ' +
        'router (GET/POST /listings, GET /listings/:id, PATCH /listings/:id/status, PATCH /listings/:id/price, ' +
        'GET /listings/:id/price-history, POST/GET /listings/:id/inquiries) + a README. In-memory by default — ' +
        'swap the Maps for your DB. Pairs with the auth/notification/maps recipes. Use for real-estate / property ' +
        '/ listing / broker prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_fitness',
      description:
        'Add a real Fitness / gym backend to the app (server/fitness/) — a packaged domain vertical for gyms, ' +
        'studios and fitness apps. THREE real guarantees: (1) MEMBERSHIP VALIDITY GATE — a check-in is accepted ' +
        'only with an ACTIVE membership (an expired or frozen membership is rejected, 409); (2) DETERMINISTIC ' +
        'renew/freeze date-math — renew() extends by the plan days from max(now, currentEnd) so an early renewal ' +
        'loses no days, and freeze()/unfreeze() shift the end date by the exact frozen duration so no paid day ' +
        'is lost; (3) IDEMPOTENT check-in — at most one per member per day. Emits a dependency-free ' +
        'FitnessService (addPlan, join, isActive/statusOf, renew, freeze, unfreeze, checkIn, checkInsFor, ' +
        'listMembers) + an Express router (POST /plans, POST/GET /members(/:id), POST /members/:id/renew, ' +
        '/freeze, /unfreeze, /checkin, GET /members/:id/checkins) + a README. In-memory by default — swap the ' +
        'Maps for your DB. Pairs with the auth/payment/notification recipes. Use for gym / fitness / membership prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_pharmacy',
      description:
        'Add a real Pharmacy backend to the app (server/pharmacy/) — a packaged domain vertical for pharmacies ' +
        'and medical stores. THREE real guarantees (distinct from the inventory recipe): (1) EXPIRY GATE — an ' +
        'expired batch can never be dispensed (409 if all stock is expired); (2) FEFO DISPENSING — draws from ' +
        'the earliest-expiry non-expired batch first (First-Expiry-First-Out) and never oversells (409 on ' +
        'insufficient non-expired stock); (3) CONTROLLED-SUBSTANCE — a prescription-only (Schedule-H) drug needs ' +
        'a prescription id to dispense (403 otherwise). Emits a dependency-free PharmacyService (addDrug, ' +
        'addBatch, availableStock, dispense, expiringBefore, dispenseHistory) + an Express router (GET/POST ' +
        '/drugs, POST /batches, GET /drugs/:id/stock, POST /dispense, GET /dispense/history) + a README. ' +
        'In-memory by default — swap the Maps for your DB. Pairs with the auth/inventory/notification recipes. ' +
        'Use for pharmacy / chemist / medical-store / drug-inventory prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_recruitment',
      description:
        'Add a real Recruitment / job-board (ATS) backend to the app (server/recruitment/) — a packaged domain ' +
        'vertical for job portals and hiring apps. THREE real guarantees (a HIRING pipeline, distinct from the ' +
        'CRM sales pipeline): (1) APPLICATION STATE-MACHINE — applied → screening → interview → offer → hired ' +
        'along allowed transitions only (reject/withdraw from any non-terminal stage; hired/rejected/withdrawn ' +
        'terminal), an invalid jump rejected (409); (2) ONE application per candidate per job (a duplicate is ' +
        'rejected, 409); (3) CLOSED-JOB GUARD — a closed job accepts no applications (409). Emits a ' +
        'dependency-free RecruitmentService (postJob, closeJob/reopenJob, addCandidate, apply, advance, ' +
        'applicationsFor, listJobs) + an Express router (GET/POST /jobs, POST /jobs/:id/close|/reopen, POST ' +
        '/candidates, POST /jobs/:id/apply, GET /jobs/:id/applications, PATCH /applications/:id/stage) + a ' +
        'README. In-memory by default — swap the Maps for your DB. Pairs with the auth/notification/email ' +
        'recipes. Use for job-board / recruitment / hiring / ATS prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_invoicing',
      description:
        'Add a real Invoicing / billing backend to the app (server/invoicing/) — a packaged domain vertical for ' +
        'freelancers, agencies and SMBs. THREE real guarantees: (1) INVOICE STATE-MACHINE — draft → sent → ' +
        'paid|cancelled along allowed transitions only (paid/cancelled terminal), an invalid jump rejected ' +
        '(409); (2) EXACT PAYMENT LEDGER — balance = total − sum(payments), a payment can never exceed the ' +
        'balance (409, no negative), invoice auto-marks PAID at zero balance; (3) OVERDUE is DERIVED — a sent, ' +
        'unpaid, past-due invoice reads "overdue" (computed from the dates, never set by hand). Emits a ' +
        'dependency-free InvoicingService (createInvoice, total, balance, setStatus, recordPayment, ' +
        'displayStatus, isOverdue, outstandingTotal) + an Express router (GET/POST /invoices, GET /invoices/:id, ' +
        'PATCH /invoices/:id/status, POST /invoices/:id/payments, GET /invoices/outstanding/total) + a README. ' +
        'In-memory by default — swap the Maps for your DB. Pairs with the auth/payment/notification recipes. ' +
        'Use for invoicing / billing / freelance / accounts-receivable prompts.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_events',
      description:
        'Add a real events / RSVP backend to the app (server/events/) — a packaged domain vertical for meetups, ' +
        'workshops, webinars and community events. The real guarantee is CAPACITY ENFORCEMENT + a WAITLIST: an ' +
        'event never confirms more attendees than its capacity, overflow RSVPs go to a FIFO waitlist, and ' +
        'cancelling a confirmed seat AUTO-PROMOTES the first waitlisted attendee. Emits a dependency-free ' +
        'EventService (createEvent, rsvp, cancelRsvp, attendees, seatsLeft) + an Express router (POST /events, ' +
        'GET /events/:id (+ seatsLeft), GET /events/:id/attendees, POST /events/:id/rsvp → 409 on duplicate, ' +
        'DELETE /rsvps/:id) + a README. In-memory by default — swap the store for your DB. Pairs with the OTP/' +
        'notification/email recipes.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_subscriptions',
      description:
        'Add a real subscriptions / recurring-billing backend to the app (server/subscriptions/) — a packaged ' +
        'domain vertical for SaaS and memberships. The real guarantees are a lifecycle STATE-MACHINE (active ↔ ' +
        'paused, → past_due → cancelled, reactivate) enforced on every status change, and deterministic ' +
        'renewal-date math (renewalAt = start/renew + the plan interval). Emits a dependency-free ' +
        'SubscriptionService (definePlan, subscribe, setStatus, renew, isDue, list) + an Express router (POST ' +
        '/plans, POST/GET /subscriptions(/:id), PATCH /subscriptions/:id/status → 409 on invalid transition, ' +
        'POST /subscriptions/:id/renew). Charging is your gateway job — call renew() on a successful charge; ' +
        'use isDue() in a scheduled job (pairs with generate_jobs). In-memory by default — swap the store for ' +
        'your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_polls',
      description:
        'Add a real polls / surveys backend to the app (server/polls/) — a packaged domain vertical for ' +
        'communities, events and product feedback. The real guarantee is VOTE INTEGRITY: each voter can vote ' +
        'at most once per poll (a repeat vote is rejected, or moved with allowChange), a closed poll accepts no ' +
        'more votes, and the tally is always exact. Emits a dependency-free PollService (createPoll, vote, ' +
        'closePoll, results, hasVoted) + an Express router (POST /polls, GET /polls/:id(/results), POST ' +
        '/polls/:id/vote → 409 on a duplicate vote or closed poll, POST /polls/:id/close). Identify the voter ' +
        'by auth user id (or a device/session id for anonymous polls). In-memory by default — swap the store ' +
        'for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_blog',
      description:
        'Add a real blog / CMS backend to the app (server/blog/) — a packaged domain vertical for content ' +
        'sites, marketing pages, docs and any publish-workflow app. The real guarantees are a publish ' +
        'STATE-MACHINE (draft↔published↔archived, invalid jumps rejected), UNIQUE-slug generation from the ' +
        'title (de-duplicated: hello, hello-2, hello-3), and a public feed that returns PUBLISHED posts only ' +
        '(drafts/archived stay private). Emits a dependency-free BlogService (createPost, publish, unpublish, ' +
        'archive, getBySlug, listPublished, listAll) + an Express router (POST /posts, GET /posts, GET ' +
        '/posts/published, GET /posts/slug/:slug → 404 unless published, PATCH /posts/:id, PATCH ' +
        '/posts/:id/status → 409 on an invalid transition). Editing a title never changes the slug so ' +
        'permalinks stay stable. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_reviews',
      description:
        'Add a real reviews / ratings backend to the app (server/reviews/) — a packaged domain vertical for ' +
        'marketplaces, ecommerce, app stores, courses and any product-feedback surface. The real guarantee is ' +
        'RATING INTEGRITY: a rating is an integer 1..5 (out-of-range rejected), each user may review a given ' +
        'item at most once (a repeat submission UPDATES the existing review instead of double-counting), and ' +
        'the aggregate (average + count + per-star distribution) is computed EXACTLY from the live reviews. ' +
        'Emits a dependency-free ReviewService (submit, getByUser, remove, listForItem, aggregate) + an Express ' +
        'router (POST /reviews → create-or-update, 400 on a bad rating; GET /items/:itemId/reviews; GET ' +
        '/items/:itemId/rating; GET/DELETE /reviews/:id). Take userId from the authenticated session in ' +
        'production. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_loyalty',
      description:
        'Add a real loyalty / points-wallet backend to the app (server/loyalty/) — a packaged domain vertical ' +
        'for retail, apps, memberships and any rewards programme. The real guarantee is LEDGER INTEGRITY: a ' +
        "member's balance is ALWAYS exactly sum(earned, not expired) − sum(redeemed) and can never go negative " +
        '(a redeem beyond the balance is rejected), and every change is an append-only ledger entry ' +
        '(earn/redeem/expire) for a full audit history. Optional per-earn point expiry is supported. Emits a ' +
        'dependency-free LoyaltyService (earn, redeem, balance, expireDue, history) + an Express router (POST ' +
        '/loyalty/earn, POST /loyalty/redeem → 409 on insufficient balance, GET /loyalty/:member/balance, GET ' +
        '/loyalty/:member/history). Take member from the authenticated session in production. In-memory by ' +
        'default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_referrals',
      description:
        'Add a real referral / invite backend to the app (server/referrals/) — a packaged growth vertical for ' +
        'any app that wants viral invites. The real guarantee is ATTRIBUTION INTEGRITY: every user gets ONE ' +
        'stable unique referral code, a new user can be attributed to AT MOST ONE referrer (self-referral, an ' +
        'unknown code, and double-attribution are rejected), and the referrer is credited EXACTLY ONCE when the ' +
        'referred user completes the qualifying event (a retried completion never double-credits). Emits a ' +
        'dependency-free ReferralService (codeFor, attribute, complete, statsFor, listFor) + an Express router ' +
        '(GET /referrals/:user/code, POST /referrals/attribute → 409 on self/unknown/already-referred, POST ' +
        '/referrals/:referred/complete, GET /referrals/:referrer/stats). Pay rewards off statsFor().completed. ' +
        'Take the user id from the authenticated session in production. In-memory by default — swap the store ' +
        'for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_comments',
      description:
        'Add a real threaded-comments / discussion backend to the app (server/comments/) — a packaged domain ' +
        'vertical for blogs, forums, docs, social feeds and any content that invites discussion. The real ' +
        'guarantee is THREAD INTEGRITY: a reply MUST reference an existing parent (orphan replies rejected), a ' +
        "reply inherits its parent's thread and gets depth = parent.depth + 1, and a SOFT-DELETE tombstones a " +
        'comment that has replies ("[deleted]", children survive and stay nested) while a childless comment is ' +
        'hard-removed. Emits a dependency-free CommentService (post, edit, remove, tree, listThread, count) + an ' +
        'Express router (POST /comments → 404 if the parent is missing, GET /threads/:threadId/comments as a ' +
        'nested tree, GET /threads/:threadId/count, PATCH /comments/:id, DELETE /comments/:id). Identify the ' +
        'thread with whatever the discussion hangs off (a post id, an issue id). In-memory by default — swap the ' +
        'store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_messaging',
      description:
        'Add a real direct-messaging / chat backend to the app (server/messaging/) — a packaged domain vertical ' +
        'for social apps, marketplaces (buyer↔seller chat), support and any two-party conversation. The real ' +
        'guarantee is CONVERSATION INTEGRITY: a 1:1 conversation is keyed by the canonical (sorted) participant ' +
        'pair, so (a,b) and (b,a) are the SAME conversation (never a duplicate), each participant unread count ' +
        'is exact, and marking-read is MONOTONIC (the read cursor only moves forward — already-read messages ' +
        'never resurface). A self-conversation and an empty body are rejected. Emits a dependency-free ' +
        'MessagingService (send, history, unreadCount, markRead, inbox) + an Express router (POST /messages, GET ' +
        '/conversations/:me/:other/messages, POST /conversations/:me/:other/read, GET /inbox/:me). Take the ' +
        'sender from the auth session in production; emit a socket event from send() for real-time delivery. ' +
        'In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_listings',
      description:
        'Add a real marketplace-listings backend to the app (server/listings/) — a packaged domain vertical for ' +
        'classifieds, peer-to-peer marketplaces, second-hand stores and any buyer↔seller app. The real ' +
        'guarantee is SALE INTEGRITY: a listing follows the lifecycle draft→active→sold/removed (invalid jumps ' +
        'rejected), it can be SOLD AT MOST ONCE (a purchase on a sold/draft/removed listing is rejected and a ' +
        'seller cannot buy their own), and only ACTIVE listings are publicly searchable. A sold listing is ' +
        'immutable. Emits a dependency-free ListingService (create, publish, setStatus, buy, update, search, ' +
        'listBySeller, purchasesBy) + an Express router (POST /listings, GET /listings?q= + /listings/:id, PATCH ' +
        '/listings/:id/status → 409 on invalid transition, POST /listings/:id/buy → 409 on already-sold / ' +
        'unavailable / self-purchase). Take seller/buyer from the auth session in production. In-memory by ' +
        'default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_job_board',
      description:
        'Add a real job board / applicant-tracking backend to the app (server/jobboard/) — a packaged domain ' +
        'vertical for career sites, hiring platforms and any recruiting flow. The real guarantee is APPLICATION ' +
        'INTEGRITY: a candidate can apply to a given job AT MOST ONCE (a duplicate is rejected), only OPEN jobs ' +
        'accept applications, and an application follows the hiring STATE-MACHINE applied→screening→interview→' +
        'offer→hired/rejected (invalid jumps rejected; hired/rejected terminal). Emits a dependency-free ' +
        'JobBoardService (postJob, listOpenJobs, apply, advance, applicationsForJob, applicationsByCandidate) + ' +
        'an Express router (POST /jobs, GET /jobs, PATCH /jobs/:id/status, POST /jobs/:id/apply → 409 on ' +
        'closed/duplicate, GET /jobs/:id/applications, PATCH /applications/:id/status → 409 on invalid ' +
        'transition). Distinct from generate_jobs (background job queue). Take candidate from the auth session ' +
        'in production. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_wishlist',
      description:
        'Add a real wishlist / favorites / likes backend to the app (server/favorites/) — a near-universal ' +
        'domain vertical (ecommerce wishlists, content bookmarks, social likes). The real guarantee is ' +
        'IDEMPOTENT MEMBERSHIP: a (user, item) favorite exists AT MOST ONCE — add is idempotent (favoriting ' +
        'twice is a no-op, not a double entry), remove is idempotent, toggle flips the state, and the per-item ' +
        'favorite COUNT is always exact. One service covers wishlists/likes/bookmarks via a collection ' +
        'namespace. Emits a dependency-free FavoritesService (add, remove, toggle, has, listByUser, ' +
        'countForItem, usersForItem) + an Express router (POST /favorites → 201 new / 200 existing, POST ' +
        '/favorites/toggle, DELETE /favorites, GET /favorites/:user, GET /items/:item/favorites). Take user ' +
        'from the auth session in production. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_addresses',
      description:
        'Add a real address book / shipping-addresses backend to the app (server/addresses/) — a universal ' +
        'domain vertical for ecommerce, delivery and billing. The real invariant is AT-MOST-ONE-DEFAULT: a user ' +
        'can save many addresses but at most one is the default — the first address added becomes the default ' +
        'automatically, setDefault atomically unsets the previous default, and deleting the default promotes ' +
        'the most-recently-added remaining address. Emits a dependency-free AddressBook (add, setDefault, ' +
        'getDefault, update, remove, list) + an Express router (POST /addresses, GET /addresses/:user + ' +
        '/default, POST /addresses/:id/default, PATCH /addresses/:id, DELETE /addresses/:id → returns the ' +
        'promoted newDefaultId). Take user from the auth session in production. In-memory by default — swap the ' +
        'store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_coupons',
      description:
        'Add a real coupons / discount-codes backend to the app (server/coupons/) — a packaged domain vertical ' +
        'for ecommerce, SaaS and any checkout. The real guarantee is REDEMPTION INTEGRITY: a code enforces an ' +
        'optional TOTAL-redemption cap AND an optional PER-USER limit (both counted exactly), rejects an ' +
        'expired/inactive code or an order below its minimum, and computes the discount correctly — percentage ' +
        '(capped at the order total) or fixed (never below zero). validate() checks without counting; redeem() ' +
        'records the redemption toward both caps. Emits a dependency-free CouponService (create, validate, ' +
        'redeem, stats) + an Express router (POST /coupons, POST /coupons/validate → 422 with a reason if not ' +
        'usable, POST /coupons/redeem → 422 on failure, GET /coupons/:code/stats). Amounts are in the smallest ' +
        'currency unit. Pairs with generate_payment / generate_loyalty. In-memory by default — swap the store ' +
        'for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_kanban',
      description:
        'Add a real kanban board / task board backend to the app (server/kanban/) — a packaged domain vertical ' +
        'for project management, issue tracking and any "columns of cards" UI. The real guarantee is BOARD ' +
        'INTEGRITY: a card lives in exactly one column with a stable contiguous position (0,1,2,…); adding and ' +
        'moving re-index the affected columns so positions never collide or gap; and an optional per-column WIP ' +
        'LIMIT rejects an add/move that would overflow the column. moveCard clamps the target position to the ' +
        'destination length. Emits a dependency-free KanbanService (addColumn, addCard, moveCard, updateCard, ' +
        'removeCard, board) + an Express router (POST /columns, GET /boards/:boardId, POST /columns/:columnId/' +
        'cards → 409 at WIP limit, PATCH /cards/:id/move → 409 if destination full, PATCH/DELETE /cards/:id). ' +
        'Distinct from generate_support_tickets (ticket status machine). In-memory by default — swap the store ' +
        'for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_timesheet',
      description:
        'Add a real time-tracking / timesheet backend to the app (server/timesheet/) — a packaged domain ' +
        'vertical for freelancing, agencies, attendance and any billable-hours app. The real guarantee is ' +
        'SESSION INTEGRITY: a user has AT MOST ONE open (running) entry — clocking in while already clocked in ' +
        'is rejected, clocking out with nothing running is rejected, and clocking out computes an exact duration ' +
        '(endedAt − startedAt, never negative). Totals sum the CLOSED entries (optionally per project). Emits a ' +
        'dependency-free Timesheet (clockIn, clockOut, openEntry, addManual, list, totalMs) + an Express router ' +
        '(POST /time/clock-in → 409 if already running, POST /time/clock-out → 409 if nothing running, GET ' +
        '/time/:user/open, POST /time/manual, GET /time/:user (?project=) → entries + totalMs, DELETE /time/:id). ' +
        'Take user from the auth session in production. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_leaderboard',
      description:
        'Add a real leaderboard / rankings backend to the app (server/leaderboard/) — a packaged domain vertical ' +
        'for games, gamification, sales contests, quizzes and any ranked score. The real guarantee is RANK ' +
        'INTEGRITY: submit() keeps each player BEST score (a lower resubmit never downgrades and never resets ' +
        'the tie-break time); ranking is score DESC with a deterministic tie-break (whoever reached the score ' +
        'earlier ranks higher), so top()/rankOf()/around() are exact, 1-based and stable. Multiple boards are ' +
        'isolated by a board name. Emits a dependency-free LeaderboardService (submit, top, rankOf, entryOf, ' +
        'around, size, remove) + an Express router (POST /leaderboard/scores, GET /leaderboard?n=&board=, GET ' +
        '/leaderboard/:player?k=&board= → entry+rank+neighbours (404 if not ranked), DELETE /leaderboard/:player). ' +
        'Take player from the auth session in production. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_waitlist',
      description:
        'Add a real launch waitlist backend to the app (server/waitlist/) — a packaged domain vertical for ' +
        'product launches, beta access, drops and any "get in line" flow. The real guarantee is QUEUE ' +
        'INTEGRITY: join() dedups by email (case-insensitive) so a repeat join returns the SAME stable entry ' +
        '(never a duplicate); position() is a contiguous 1..n over the people still WAITING in join order; ' +
        'invite(n) moves the front n waiting entries (in order) to invited, after which the remaining queue ' +
        're-numbers correctly. Emits a dependency-free Waitlist (join, get, position, invite, remove, list) + an ' +
        'Express router (POST /waitlist → idempotent join with position, GET /waitlist/:email, POST ' +
        '/waitlist/invite {n}, GET /waitlist?status=, DELETE /waitlist/:email). Captures referredBy for ' +
        'referral-boosted launches (pairs with generate_referrals). In-memory by default — swap the store for ' +
        'your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_tags',
      description:
        'Add a real tags / taxonomy backend to the app (server/tags/) — a cross-cutting domain vertical used by ' +
        'blogs, ecommerce, CRMs, task boards and anything that labels content. The real guarantee is TAG ' +
        'INTEGRITY: tags are canonicalized (trimmed, lower-cased slug) so "React" and " react " are one tag; ' +
        'tag()/untag() are idempotent (a (tag, entity) attachment exists at most once); rename() CASCADES to ' +
        'every attachment and MERGES into an existing tag if the target slug already exists; all()/count() ' +
        'report exact usage. Emits a dependency-free TagService (tag, untag, tagsOf, entitiesWith, rename, all, ' +
        'count) + an Express router (POST /tags → 201 new / 200 existing, DELETE /tags?entity=&tag=, GET /tags, ' +
        'GET /tags/:tag/entities, GET /entities/:entity/tags, POST /tags/rename {from,to} → 404 on unknown tag). ' +
        'entity is any id you tag (post/product/contact). Pairs with generate_blog / generate_listings / ' +
        'generate_crm. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_experiments',
      description:
        'Add a real A/B testing / experiment-assignment backend to the app (server/experiments/) — a packaged ' +
        'domain vertical for any product running experiments or staged rollouts. The real guarantee is ' +
        'DETERMINISTIC STICKY ASSIGNMENT: assign() is a PURE hash of (experiment salt + user) → a stable [0,1) ' +
        'bucket → the weighted variant, so the SAME user ALWAYS gets the SAME variant with no stored state; ' +
        'variant WEIGHTS are respected across the population; expose() logs each user once for exact counts(). ' +
        'An inactive/unknown experiment returns the first-declared variant (control) and never throws. Emits a ' +
        'dependency-free ExperimentService (define, assign, expose, counts, list; node:crypto only) + an Express ' +
        'router (POST /experiments, GET /experiments/:key/assign/:user, POST /experiments/:key/expose, GET ' +
        '/experiments/:key/counts, GET /experiments). Assignment is pure so client and server agree with no ' +
        'round-trip. Distinct from generate_feature_flags (LaunchDarkly/Unleash provider). In-memory by default ' +
        '— swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_short_links',
      description:
        'Add a real URL shortener backend to the app (server/shortlinks/) — a packaged domain vertical for ' +
        'marketing links, sharing and QR targets. The real guarantee is LINK INTEGRITY: shorten() makes a ' +
        'UNIQUE code (auto-generated codes retry on the rare collision; a custom alias is rejected if taken or ' +
        'malformed; only http(s) URLs accepted); resolve() returns the target and increments an EXACT click ' +
        'count but returns null for an unknown/disabled/EXPIRED code (so the route 404s instead of redirecting); ' +
        'peek() previews without counting. Emits a dependency-free ShortLinkService (shorten, resolve, peek, ' +
        'setActive, remove, list; node:crypto only) + an Express router (POST /api/links → 409 on a taken alias, ' +
        'GET /api/links/:code stats, PATCH/DELETE /api/links/:code, and the public GET /:code → 302 redirect + ' +
        'click, 404 if not live). Mount at the ROOT so links look like https://yourdomain/:code. Pairs with ' +
        'generate_qr. In-memory by default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_feedback',
      description:
        'Add a real feedback / feature-request board backend to the app (server/feedback/) — a packaged domain ' +
        'vertical for a public product roadmap (Canny / Featurebase style). The real guarantee is VOTE + STATUS ' +
        'INTEGRITY: a user can upvote a given post AT MOST ONCE (upvote/unvote are idempotent, so vote counts are ' +
        'always exact), and a post moves along the status lifecycle open→planned→in_progress→done/declined ' +
        '(allowed transitions only; done/declined reopen to open). submit() counts the author own vote. Emits a ' +
        'dependency-free FeedbackService (submit, upvote, unvote, hasVoted, setStatus, list) + an Express router ' +
        '(POST /feedback, GET /feedback?status= sorted by votes, GET /feedback/:id?user=, POST/DELETE ' +
        '/feedback/:id/upvote, PATCH /feedback/:id/status → 409 on invalid transition). Distinct from ' +
        'generate_polls (fixed-option voting) and generate_kanban (private task board). In-memory by default — ' +
        'swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_consent',
      description:
        'Add a real GDPR/privacy consent-log backend to the app (server/consent/) — a packaged domain vertical ' +
        'for cookie/marketing/terms consent, DPA compliance and audit. The real guarantee is an APPEND-ONLY ' +
        'event log: every grant/withdraw is recorded with a purpose, policy version and source, and NOTHING is ' +
        'ever mutated or deleted — hasConsent(user, purpose) is derived from the MOST-RECENT event (latest ' +
        'wins), so the current state is always provable and the full history is auditable. Emits a ' +
        'dependency-free ConsentService (record, hasConsent, stateOf, history, grantedUsers) + an Express ' +
        'router (POST /consent {grant|withdraw}, GET /consent/:user, GET /consent/:user/:purpose, GET ' +
        '/consent/:user/history). Distinct from generate_audit (general tamper-evident log). In-memory by ' +
        'default — swap the store for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_activity_feed',
      description:
        'Add a real activity feed / timeline backend to the app (server/activity/) — a packaged domain vertical ' +
        'for a social feed, an activity stream, a per-project event log or a notification timeline. The real ' +
        'guarantee is STABLE CURSOR PAGINATION: every event gets a monotonic sequence id and the feed is paged ' +
        'newest-first by "id < cursor", so paging a live feed NEVER duplicates or skips an item even when new ' +
        'events are appended between page fetches (the classic offset-pagination bug this prevents). Emits a ' +
        'dependency-free ActivityFeedService (record, feed, actorFeed, markSeen, unseenCount) + an Express ' +
        'router (POST /api/activity, GET /api/activity ?cursor&limit, GET /api/activity/actor/:actor, GET ' +
        '/api/activity/unseen ?viewer, POST /api/activity/seen). Distinct from generate_audit (tamper-evident ' +
        'log) and generate_notification_center. In-memory by default — swap the array for your DB (an ' +
        'auto-increment id column plays the sequence-id role).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_cart',
      description:
        'Add a real shopping-cart backend to the app (server/cart/) — a packaged domain vertical, the ' +
        'foundational ecommerce primitive. The real guarantee is CART INTEGRITY: adding the same product MERGES ' +
        'quantities into ONE line (never a duplicate line), setting a line to 0 (or removing it) drops it, ' +
        'quantities never go negative, and the cart total is ALWAYS the exact sum of unitPrice × qty in INTEGER ' +
        'minor units (paise/cents) so money never drifts on floating point. Emits a dependency-free CartService ' +
        '(add, setQty, remove, clear, view) + an Express router (GET /api/cart/:userId, POST ' +
        '/api/cart/:userId/items, PATCH /api/cart/:userId/items/:productId, DELETE the line or the whole cart). ' +
        'Distinct from generate_inventory (stock), generate_orders (placed order) and generate_payment (charge). ' +
        'In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_reactions',
      description:
        'Add a real emoji-reactions backend to the app (server/reactions/) — a packaged domain vertical for ' +
        'reacting (👍 ❤️ 😂 …) to any post, comment, message or media. The real guarantee is REACTION ' +
        'INTEGRITY: a user reaction to a given (target, emoji) is an idempotent TOGGLE (re-reacting with the ' +
        'same emoji removes it — never a double count), and a user holds AT MOST ONE emoji per target (a new ' +
        'emoji replaces the old), so per-emoji counts are always exact. Emits a dependency-free ReactionService ' +
        '(react, unreact, hasReacted, countFor, summary) + an Express router (POST /api/reactions/:targetId ' +
        '{userId, emoji} → toggle, DELETE /api/reactions/:targetId, GET /api/reactions/:targetId ?viewer=). ' +
        'Emoji are validated against an allow-list. Distinct from generate_feedback (a single-upvote board) and ' +
        'generate_polls (fixed-option voting). In-memory by default — swap the Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_orders',
      description:
        'Add a real ecommerce order-lifecycle backend to the app (server/orders/) — a packaged domain vertical ' +
        'for checkout → fulfillment. The real guarantee is ORDER IMMUTABILITY + a status STATE-MACHINE: placing ' +
        'an order captures an IMMUTABLE SNAPSHOT of its line items and total (a later catalog price change can ' +
        'never alter a placed order; the total is the exact sum of frozen subtotals in integer minor units), ' +
        'and it moves placed → paid → shipped → delivered along allowed transitions only (illegal jump 409), ' +
        'with cancel allowed until it ships. Emits a dependency-free OrderService (place, get, transition, ' +
        'cancel, listForUser) + an Express router (POST /api/orders, GET /api/orders?userId=, GET ' +
        '/api/orders/:id, PATCH /api/orders/:id/status, POST /api/orders/:id/cancel). Distinct from generate_cart ' +
        '(pre-checkout, mutable) and generate_payment (the charge). In-memory by default — swap the Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_faq',
      description:
        'Add a real FAQ / knowledge-base backend to the app (server/faq/) — a packaged domain vertical for a ' +
        'help center or product FAQ. The real guarantee is the PUBLISH GATE + HELPFULNESS: a DRAFT entry is ' +
        'never returned by the public list or search (only published entries are), entries are grouped by ' +
        'category and manually ordered, keyword search matches the question OR answer (published only, ' +
        'case-insensitive), and each entry keeps EXACT helpful / not-helpful vote counts. Emits a ' +
        'dependency-free FaqService (add, update, setPublished, vote, publicList, adminList, search) + an ' +
        'Express router (GET /api/faq ?category= ?q=, GET /api/faq/admin, GET/PATCH/DELETE /api/faq/:id, POST ' +
        '/api/faq, PATCH /api/faq/:id/publish, POST /api/faq/:id/vote). Distinct from generate_support_tickets ' +
        '(a per-user ticket state machine) and generate_blog (articles). In-memory by default — swap the Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_quiz',
      description:
        'Add a real quiz / assessment backend to the app (server/quizzes/) — a packaged domain vertical for ' +
        'edtech, training or knowledge checks. The real guarantee is GRADING INTEGRITY: a submission is scored ' +
        'against the stored answer key into an EXACT score (points earned / total) plus per-question ' +
        'correctness, a configurable pass mark decides pass/fail, and the correct-answer key is NEVER exposed to ' +
        'the taker (the public view strips it; only server-side grading reads it). Each question is validated to ' +
        'have exactly one correct option. Emits a dependency-free QuizService (create, get, publicView, grade) + ' +
        'an Express router (POST /api/quizzes to create — guard with auth, GET /api/quizzes/:id taker view ' +
        'without the key, POST /api/quizzes/:id/submit to grade). Distinct from generate_polls (opinion tally, ' +
        'no right answer) and generate_feedback. In-memory by default — swap the Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_availability',
      description:
        'Add a real availability / opening-hours backend to the app (server/availability/) — a packaged domain ' +
        'vertical for a shop, clinic, restaurant or support desk (are you open right now?). The real guarantee ' +
        'is CORRECT OPEN/CLOSED RESOLUTION: weekly recurring windows per weekday (multiple a day), OVERNIGHT ' +
        'windows that cross midnight (close <= open runs into the next day), and date-specific EXCEPTIONS that ' +
        'override the weekly schedule for one date (closed, or special hours) — isOpenAt(date) resolves all of ' +
        'that exactly, and nextOpenFrom(date) finds the next opening. Emits a dependency-free ' +
        'AvailabilityService (setWeekly, setException, isOpenAt, nextOpenFrom, weeklySchedule) + an Express ' +
        'router (GET /api/availability, PUT /api/availability/weekly/:weekday, PUT /api/availability/exceptions, ' +
        'GET /api/availability/open ?at=). Distinct from generate_booking (reserves discrete slots) and ' +
        'generate_scheduler (runs cron jobs). In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_announcements',
      description:
        'Add a real site-announcement / banner backend to the app (server/announcements/) — a packaged domain ' +
        'vertical for maintenance notices, promos and new-feature callouts. The real guarantee is SCHEDULED ' +
        'VISIBILITY + DISMISS-ONCE: a banner is only active inside its optional [startsAt, endsAt] window (and ' +
        'when published), and once a user dismisses a dismissible banner it NEVER shows for that user again — ' +
        'activeFor(user) returns exactly the banners a given user should see now. level is ' +
        'info|success|warning|critical. Emits a dependency-free AnnouncementService (create, update, dismiss, ' +
        'activeFor, list) + an Express router (GET /api/announcements/active ?user=, GET/POST ' +
        '/api/announcements, PATCH/DELETE /api/announcements/:id, POST /api/announcements/:id/dismiss). Distinct ' +
        'from generate_notification_center (a per-user inbox) and generate_activity_feed (an event timeline). ' +
        'In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_collections',
      description:
        'Add a real saved-collections / boards backend to the app (server/collections/) — a packaged domain ' +
        'vertical for Pinterest-style boards or "save to collection". The real guarantee is MEMBERSHIP ' +
        'INTEGRITY: an item can belong to MANY collections at once, saving the same item twice is idempotent ' +
        '(no duplicate, exact itemCount), removing an item from one collection never affects the others, and ' +
        'each list is duplicate-free (newest-saved first). Collection names are unique per owner. Emits a ' +
        'dependency-free CollectionService (create, rename, saveItem, removeItem, collectionsForItem, view, ' +
        'listForOwner) + an Express router (GET /api/collections ?owner=, POST /api/collections, GET/PATCH/DELETE ' +
        '/api/collections/:id, POST /api/collections/:id/items, DELETE /api/collections/:id/items/:itemId). ' +
        'Distinct from generate_wishlist (a single flat list per user) and generate_tags (labels on one entity). ' +
        'In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_contact_form',
      description:
        'Add a real "Contact us" / lead-capture form backend to the app (server/contact/) — the universal ' +
        'contact form every site needs. The real guarantee is VALIDATED CAPTURE + SPAM REJECTION: a submission ' +
        'requires a name, a valid email and a non-empty message (bad input rejected, never silently stored), a ' +
        'filled hidden HONEYPOT field marks the submission as spam and drops it (bots fill it; humans never see ' +
        'it), and every accepted message moves through a status lifecycle new → read → archived (or spam). ' +
        'Emits a dependency-free ContactService (submit, setStatus, list, unreadCount) + an Express router ' +
        '(public POST /api/contact, admin GET /api/contact ?status=, GET /api/contact/:id, PATCH ' +
        '/api/contact/:id/status, DELETE /api/contact/:id). Pair with generate_email to notify staff. Distinct ' +
        'from generate_newsletter (email-only capture) and generate_feedback (a public voting board). In-memory ' +
        'by default — swap the Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_pageviews',
      description:
        'Add a real self-hosted page-view / visit counter to the app (server/pageviews/) — a packaged domain ' +
        'vertical, privacy-friendly and storing nothing with any third party. The real guarantee is ' +
        'UNIQUE-VISITOR DEDUP: every hit increments a page total, but a given visitor counts toward the page ' +
        'unique count only ONCE PER DAY — the visitor is a SALTED HASH of IP+User-Agent (the raw IP is never ' +
        'stored, non-reversible), so it is privacy-preserving. Plus a top-pages ranking. Emits a dependency-free ' +
        'PageViewService (node:crypto) with record / stats / topPages / siteTotal + an Express router (POST ' +
        '/api/views {path}, GET /api/views/stats ?path=, GET /api/views/top ?limit=). Distinct from ' +
        'generate_analytics (sends events to a 3rd-party like PostHog/Mixpanel) — this keeps all counts on your ' +
        'own server. In-memory by default — swap the Maps for your DB; set a stable PAGEVIEW_SALT in production.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_gift_cards',
      description:
        'Add a real gift-card / store-credit backend to the app (server/giftcards/) — a packaged domain vertical ' +
        'for ecommerce. The real guarantee is BALANCE INTEGRITY: a card is issued with a monetary balance in ' +
        'INTEGER minor units (paise/cents), redeeming DEBITS the balance atomically and can NEVER overdraw (a ' +
        'redemption for more than the remaining balance is rejected; a partial redemption leaves the EXACT ' +
        'remainder; sum(redemptions)+balance === original always). Codes are unique (node:crypto); a card can be ' +
        'deactivated; an expired card cannot be redeemed. Emits a dependency-free GiftCardService (issue, get, ' +
        'balance, redeem, setActive, list) + an Express router (POST /api/gift-cards, GET /api/gift-cards/:code, ' +
        'POST /api/gift-cards/:code/redeem, PATCH /api/gift-cards/:code). Distinct from generate_coupons (a ' +
        'discount, not a stored balance) and generate_loyalty (earned points). In-memory by default — swap the ' +
        'Map for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_teams',
      description:
        'Add a real teams / workspaces (multi-tenant membership) backend to the app (server/teams/) — a packaged ' +
        'domain vertical for any B2B SaaS. The real guarantee is MEMBERSHIP INTEGRITY: a user can be a member of ' +
        'MANY workspaces with a per-workspace role (owner|admin|member), a workspace ALWAYS keeps at least one ' +
        'owner (removing or demoting the last owner is rejected), and invites are SINGLE-USE (accepting a token ' +
        'twice fails). Emits a dependency-free TeamService (node:crypto for invite tokens) with createWorkspace / ' +
        'invite / acceptInvite / setRole / removeMember / workspacesForUser / roleOf + an Express router (POST ' +
        '/api/workspaces, GET /api/workspaces ?user=, GET /api/workspaces/:id/members, POST ' +
        '/api/workspaces/:id/invites, POST /api/workspaces/invites/accept, PATCH/DELETE ' +
        '/api/workspaces/:id/members/:userId). Distinct from generate_rbac / generate_abac (a permission MODEL, ' +
        'not tenancy/membership) — pair them to check what a role may DO. In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_status_page',
      description:
        'Add a real public status / incident page to the app (server/status/) — a packaged domain vertical (like ' +
        'status.example.com). The real guarantee is DERIVED OVERALL STATUS + an APPEND-ONLY INCIDENT TIMELINE: ' +
        'each service component has a health status (operational|degraded|partial_outage|major_outage) and the ' +
        'overall system status is DERIVED as the WORST component status; an incident carries an append-only ' +
        'timeline of updates (investigating→identified→monitoring→resolved) — resolving stamps resolvedAt and a ' +
        'resolved incident can no longer be updated. Emits a dependency-free StatusPageService (addComponent, ' +
        'setComponentStatus, overallStatus, openIncident, addUpdate, snapshot, incidentHistory) + an Express ' +
        'router (GET /api/status, GET /api/status/incidents, POST /api/status/components, PATCH ' +
        '/api/status/components/:id, POST /api/status/incidents, POST /api/status/incidents/:id/updates). ' +
        'Distinct from generate_announcements (dismissible banners) and generate_support_tickets (a private ' +
        'ticket queue). In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_survey',
      description:
        'Add a real multi-question survey / questionnaire backend to the app (server/surveys/) — a packaged ' +
        'domain vertical for user research, NPS and feedback drives. The real guarantee is SCHEMA-VALIDATED ' +
        'RESPONSES + EXACT AGGREGATION: a survey has typed questions (single_choice|multi_choice|rating|text), a ' +
        'submitted response is validated against that schema (required questions answered, choice answers ' +
        'reference real options, rating 1..5) so an invalid response is REJECTED — never stored, and aggregate() ' +
        'tallies each question EXACTLY (option counts, rating average, text answers). Emits a dependency-free ' +
        'SurveyService (create, get, submit, responseCount, aggregate) + an Express router (POST /api/surveys, ' +
        'GET /api/surveys/:id, POST /api/surveys/:id/responses, GET /api/surveys/:id/results). Distinct from ' +
        'generate_polls (a single fixed-option question) and generate_quiz (graded right/wrong answers). ' +
        'In-memory by default — swap the Maps for your DB.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_support_tickets',
      description:
        'Add a real support-ticket/helpdesk backend to the app (server/tickets/) — a packaged domain vertical ' +
        'for any SaaS/service business. The real guarantee is a status STATE-MACHINE: a ticket moves ' +
        'open → in_progress → resolved → closed along allowed transitions only (a closed ticket can only be ' +
        'reopened), and an invalid jump is rejected. Emits a dependency-free TicketService (create / transition ' +
        '/ assign / comment / list) + an Express router (POST /tickets, GET /tickets(/:id), PATCH ' +
        '/tickets/:id/status → 409 on invalid transition, PATCH /tickets/:id/assign, POST /tickets/:id/comments) ' +
        '+ a README. In-memory by default — swap the store for your DB (same contracts). Pairs with the auth/' +
        'notification/audit recipes.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_pagination',
      description:
        'Add real, DoS-safe list pagination to the app (server/lib/pagination.ts): dependency-free ' +
        'parsePagination(req.query) → a clamped { limit, offset, page } (caps limit so ?limit=999999 cannot ' +
        'OOM the DB, floors a bad/missing page at 1) and pageMeta(total, params) → { total, page, pages, ' +
        'hasNext, hasPrev } for the response envelope. Use on any list endpoint (products, orders, posts, ' +
        'search). Feed limit/offset into SQL LIMIT/OFFSET or .skip()/.take(). No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_rbac',
      description:
        'Add real role-based access control (RBAC): an ordered Role hierarchy + a hasRole() check + a ' +
        'requireRole(role) Express guard (401 unauthenticated, 403 when the role is too low; a higher role ' +
        'satisfies a lower requirement). Pass roles HIGHEST → LOWEST (e.g. ["admin","editor","viewer"]). ' +
        "Pairs with generate_auth (which sets req.user.role) and generate_crud's protected routes. Dependency-free.",
      input_schema: {
        type: 'object',
        properties: {
          roles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role names ordered highest → lowest privilege (e.g. ["admin","editor","viewer"]).',
          },
        },
        required: ['roles'],
      },
    },
    {
      name: 'generate_ids',
      description:
        'Add real secure IDs/tokens to the app (server/lib/ids.ts): dependency-free newId() (UUID v4 primary ' +
        'key / public record id), shortId() (compact URL-safe share/referral code, base62 with no modulo ' +
        'bias), secureToken() (long unguessable token for password-reset / email-verification links & API ' +
        'keys) and hashToken() for at-rest storage. All from the node:crypto CSPRNG — NEVER Math.random(), ' +
        'which is predictable and would let an attacker guess a reset token. No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_settings',
      description:
        'Add a real settings scaffold to the frontend (src/settings/, dependency-free React): a SettingsProvider ' +
        'that persists preferences to localStorage AND applies the theme to <html data-theme> (so dark mode ' +
        'actually works), a useSettings hook, and a SettingsPage with grouped sections + working controls ' +
        '(theme select, compact-mode + email-notification toggles, reset). Wrap the app in <SettingsProvider>, ' +
        'render <SettingsPage/> on a /settings route, and read a pref anywhere via useSettings(). Extend with ' +
        'your own sections. No dependency, no env key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_admin',
      description:
        'Generate a COMPLETE React admin page for one resource, bound to the generate_crud REST endpoints ' +
        '(/api/<resource>): a paginated table of rows, per-row delete, and honest loading/error/empty states. ' +
        'Pass the resource name + fields (the table columns). Dependency-free (plain React + fetch). Guard the ' +
        "route with generate_rbac's requireRole('admin') for a real admin area. Use after generate_crud.",
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Resource/model name (e.g. "Post").' },
          fields: {
            type: 'array',
            description: 'The resource fields shown as table columns.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name.' },
                type: { type: 'string', description: 'Optional type hint.' },
              },
              required: ['name'],
            },
          },
        },
        required: ['name', 'fields'],
      },
    },
    {
      name: 'generate_dashboard',
      description:
        'Generate a stats dashboard: a server endpoint (GET /api/dashboard/stats) that aggregates per-resource ' +
        'counts (total + created-in-the-last-7-days, soft-deleted excluded) on Prisma, and a React page ' +
        '(src/pages/Dashboard.tsx) of stat tiles. Pass the resource/model names to summarize. Reuses ' +
        "generate_crud's Prisma client + error handler. Guard the route with generate_rbac's requireRole('admin').",
      input_schema: {
        type: 'object',
        properties: {
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'Resource/model names to summarize (e.g. ["Post","User"]).',
          },
        },
        required: ['models'],
      },
    },
    {
      name: 'generate_backup',
      description:
        'Generate a data-export ("backup") endpoint: GET /api/admin/backup downloads a JSON snapshot of every ' +
        'row of the given resources, on Prisma. Pass the resource/model names to export. Reuses generate_crud\'s ' +
        "Prisma client + error handler. Guard it with generate_rbac's requireRole('admin') — it exposes ALL data.",
      input_schema: {
        type: 'object',
        properties: {
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'Resource/model names to export (e.g. ["Post","User"]).',
          },
        },
        required: ['models'],
      },
    },
    {
      name: 'analyze_requirements',
      description:
        'Analyze a build prompt for its likely DOMAIN (healthcare/ecommerce/social/saas/booking), the features ' +
        'that domain usually needs but the prompt left implicit (RBAC, audit log, payments, multi-tenant, ' +
        'offline, …), the non-functional signals (scale/offline/security/i18n), and a short list of clarifying ' +
        'questions to confirm before building — so a rich request never gets a shallow app. Use during planning.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "The user's build request to analyze." },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'generate_i18n',
      description:
        'Add real internationalization (react-i18next) to the app: an i18n init module, a JSON locale file per ' +
        'language, and a useLanguage() switch hook. English + Hindi ship with real starter translations; other ' +
        'languages start from the English keys to translate. Pass the language codes (e.g. ["en","hi","ta"]) — ' +
        'English is always kept as the fallback. Use it with useTranslation().t("key").',
      input_schema: {
        type: 'object',
        properties: {
          languages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Language codes (e.g. ["en","hi","ta"]). Defaults to ["en","hi"]; English is always the fallback.',
          },
        },
        required: ['languages'],
      },
    },
    {
      name: 'generate_ui_states',
      description:
        'Add a dependency-free React UI-states pack: a Spinner + Skeleton (loading placeholders), EmptyState, an ' +
        'ErrorBoundary (class boundary with fallback), a useAsync hook (loading/error/data for every fetch), and ' +
        'useOptimisticList (optimistic add/remove that rolls back on failure). Optionally pass include to emit a ' +
        'subset. Reuse them everywhere so the app has honest loading / empty / error states.',
      input_schema: {
        type: 'object',
        properties: {
          include: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional subset by name (e.g. ["Spinner","useAsync"]); default = the full pack.',
          },
        },
      },
    },
    {
      name: 'generate_state',
      description:
        'Add real GLOBAL state management to the frontend (src/store/, zustand): a typed cross-component store ' +
        '+ selector hooks (useItems/useItemsActions) so shared app state (cart, session, a live list) is not ' +
        'prop-drilled. Ships a working example with an OPTIMISTIC async action that applies instantly, confirms ' +
        'with the server, and ROLLS BACK on failure. Use when the app needs shared state across components. ' +
        "(For a LOCAL optimistic list inside one component, use generate_ui_states' useOptimisticList instead.) " +
        'Adds the zustand dependency, no env key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_image_optimization',
      description:
        'Add real image optimization: a sharp-based server helper (optimizeImage — resize + WebP re-encode on ' +
        'the upload path, so a 4 MB photo becomes ~100 KB) and a CLS-safe React <LazyImage> (native lazy-load ' +
        '+ async decode + reserved width/height so the layout never jumps → faster LCP). Use for any app that ' +
        'shows user-uploaded or content images. Adds the sharp dependency.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_sso',
      description:
        'Add real Single Sign-On (OpenID Connect) — works with any OIDC provider (Google/Okta/Auth0/Azure AD/' +
        'Keycloak). Emits a discovery-based OIDC client + /auth/sso/login and /auth/sso/callback routes with ' +
        'state+nonce (CSRF + replay protection); after login req.session.user has { id, email, name }. ' +
        'Bring-Your-Own credentials (OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI) pasted into .env, never ' +
        'stored. Needs a session (express-session). Never overwrites an existing .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_abac',
      description:
        'Add attribute-based access control (ABAC) — fine-grained authorization that RBAC roles alone cannot ' +
        'express (e.g. "only the OWNER or an admin may edit THIS record"). Emits a policy registry (deny by ' +
        'default / fail closed) + a can() evaluator + an authorize(policy, buildContext) Express guard (401/403). ' +
        'Complements generate_rbac (roles) and generate_auth (req.user). Dependency-free.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_metrics',
      description:
        'Add real Prometheus metrics (prom-client): a registry with default process metrics + an HTTP request ' +
        'counter and duration histogram + a middleware that records count/latency per request, and a GET ' +
        '/metrics scrape endpoint (Prometheus text format). Complements generate_observability (structured ' +
        'logging). Point Prometheus/Grafana at /metrics. Adds the prom-client dependency.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_tracing',
      description:
        'Add real distributed tracing (OpenTelemetry): a NodeSDK with auto-instrumentation for HTTP/Express/DB ' +
        'and an OTLP exporter, so a request becomes a trace across services in Jaeger/Tempo/Honeycomb/any OTLP ' +
        'backend. Bring-Your-Own collector endpoint (OTEL_EXPORTER_OTLP_ENDPOINT) + OTEL_SERVICE_NAME via .env, ' +
        'never stored. Completes the observability trio with generate_observability (logs) + generate_metrics. ' +
        'Never overwrites an existing .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'find_code_smells',
      description:
        'Scan the workspace for two code smells the other analyzers missed: magic numbers (numeric literals ' +
        'outside a generous allow-list of indices/HTTP codes/time constants — they usually want a named ' +
        'constant) and duplicate blocks (6+ identical non-trivial lines in two or more places — they usually ' +
        'want a shared function). Advisory only; never blocks a build. Returns a file:line findings list.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_error_tracking',
      description:
        'Add real error/exception tracking to the app (Bring-Your-Own key): a server + client init + ' +
        'captureError helper for "sentry" or "rollbar", so crashes become alerts with stack traces instead of ' +
        'going unnoticed. The server DSN/token is a secret; the client DSN/token is a public browser value. ' +
        'The user pastes them into .env; NavBharatAI never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['sentry', 'rollbar'], description: 'The error-tracking provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_feature_flags',
      description:
        'Add real server-side feature flags to the app (Bring-Your-Own key): a per-user isFeatureEnabled(flag, ' +
        'userKey) helper for "launchdarkly" or "unleash" — ship a feature dark, roll it out gradually (5% → ' +
        '100%), A/B test, or kill a broken feature instantly without a redeploy. A missing flag or unreachable ' +
        'service falls back to false, so the app never breaks. The user pastes their SDK key into .env; ' +
        'NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['launchdarkly', 'unleash'], description: 'The feature-flag provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_ai',
      description:
        'Add real AI text generation to the app on the USER\'S OWN provider key (Bring-Your-Own): a server ' +
        'generateText(prompt) + chat(messages) helper for "openai" or "anthropic" — for chat, summarise, ' +
        'draft, classify features. The model is env-driven (upgrade via .env, no code change). The API key is ' +
        'a server secret (never the browser); NavBharatAI never stores it and its own AI account is never used. ' +
        'Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['openai', 'anthropic'], description: 'The AI/LLM provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_geocoding',
      description:
        'Add real geocoding (address ⇄ coordinates) to the app (Bring-Your-Own key): a server geocode(' +
        'address) + reverseGeocode(lat, lng) helper for "google" or "mapbox" — the backend counterpart to ' +
        'generate_map, behind delivery, store locators and address validation. Server-side (the key never ' +
        'reaches the browser); no npm dependency (REST via fetch). The user pastes their key into .env; ' +
        'NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['google', 'mapbox'], description: 'The geocoding provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_translation',
      description:
        'Add real machine translation to the app (Bring-Your-Own key): a server translate(text, target, ' +
        'source?) helper for "google" or "deepl" — make the app multilingual (great for India\'s languages: ' +
        'English ⇄ Hindi/Tamil/Bengali/…). Server-side (the key never reaches the browser); no npm dependency ' +
        '(REST via fetch); a failed call returns the original text so it never breaks. The user pastes their ' +
        'key into .env; NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['google', 'deepl'], description: 'The translation provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_moderation',
      description:
        'Add real content moderation to the app (Bring-Your-Own key): a server moderate(text) → { flagged, ' +
        'score } helper for "openai" (free Moderation endpoint) or "perspective" (TOXICITY, tunable ' +
        'threshold) — catch toxic/unsafe user-generated content (comments, chat, reviews) before it is shown ' +
        'or stored. Server-side (the key never reaches the browser); no npm dependency (REST via fetch); fails ' +
        'open so a moderation outage never blocks the app. The user pastes their key into .env; NavBharatAI ' +
        'never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['openai', 'perspective'], description: 'The moderation provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_captcha',
      description:
        'Add real CAPTCHA / bot-protection verification to the app (server/lib/captcha.ts): a dependency-free ' +
        'verifyCaptcha(token, ip?) that checks the client token SERVER-SIDE against Cloudflare Turnstile, ' +
        'hCaptcha, or Google reCAPTCHA v2/v3 (selected by CAPTCHA_PROVIDER; secret in CAPTCHA_SECRET), ' +
        'enforcing the reCAPTCHA v3 score threshold. Use on public forms (signup/login/contact) — the client ' +
        'widget alone is not enough, a bot can forge the token. FAILS CLOSED (an unverifiable token is ' +
        'rejected) so an outage never lets bots through. No npm dependency; the user pastes the secret into ' +
        '.env; never overwrites an existing .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_cache',
      description:
        'Add real key/value caching to the app (Bring-Your-Own infra): a server cacheGet/cacheSet(key, value, ' +
        'ttlSeconds)/cacheDel helper for "redis" (over TCP, any Redis) or "upstash" (over HTTP, for ' +
        'serverless/edge). Cache expensive DB queries/API responses to make the app fast. Values are JSON-' +
        'serialised. The user points REDIS_URL / Upstash REST creds at their own infra in .env; NavBharatAI ' +
        'never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['redis', 'upstash'], description: 'The cache backend: Redis over TCP or Upstash over HTTP.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_retry',
      description:
        'Add a real retry-with-backoff helper to the app (server/lib/retry.ts): dependency-free ' +
        'retry(fn, { attempts, baseMs, shouldRetry, signal }) that wraps a flaky external call (payment ' +
        'gateway, third-party API, DB mid-failover) with exponential backoff + FULL JITTER (avoids a retry ' +
        'storm), a shouldRetry predicate, an attempt/delay cap and AbortSignal cancellation, and rethrows the ' +
        'last error on give-up (never a fake success). Only retry IDEMPOTENT work (GET/PUT or an ' +
        'idempotency-keyed payment) — retrying a bare create can duplicate it. No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_http_client',
      description:
        'Add a resilient HTTP client to the app (server/lib/http.ts): dependency-free ' +
        'fetchJson(url, { timeoutMs, headers, method, body }) that fixes the three classic bare-fetch bugs — ' +
        'it adds a REAL timeout (default 10s, AbortController) so a dead upstream fails fast instead of hanging ' +
        'the request forever, throws HttpError on any non-2xx status (native fetch resolves on 4xx/5xx, a ' +
        'silent bug), and returns parsed JSON. Use it for every server-side call to a third-party API; wrap ' +
        'with generate_retry for automatic backoff. Native fetch + AbortController, no dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_idempotency',
      description:
        'Add real idempotency to the app (server/lib/idempotency.ts): a dependency-free Express middleware + ' +
        'createMemoryStore() that make a POST run ONCE per client "Idempotency-Key" header and replay the same ' +
        'response for any repeat — so a double-tap or a retried/dropped request never double-charges or ' +
        'double-creates. A 5xx is not cached (stays retryable); a still-in-flight repeat gets 409. Guard ' +
        'payment/order mutations with it; pairs with generate_retry. In-memory (per-instance) — swap the store ' +
        'for Redis to scale across instances. No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_newsletter',
      description:
        'Add a real newsletter / mailing-list signup to the app (Bring-Your-Own key): a server subscribe(' +
        'email, name?) helper for "mailchimp" or "brevo" that adds a contact to a list — the "join our ' +
        'newsletter / waitlist" capability. Distinct from generate_email (which SENDS one-off emails). ' +
        'Server-side (the key never reaches the browser); no npm dependency (REST via fetch). The user pastes ' +
        'their key + list id into .env; NavBharatAI never stores them. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['mailchimp', 'brevo'], description: 'The mailing-list provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_email_template',
      description:
        'Add a real HTML email template builder to the app (server/lib/emailTemplate.ts): dependency-free ' +
        'renderEmail({ title, heading, body, button, footer, preheader }) → { html, text }. The HTML is ' +
        'responsive, TABLE-based with INLINE styles (renders correctly in Outlook/Gmail, unlike a div/flex ' +
        'email) with a bulletproof button, and every value is escaped so a name/amount can never break the ' +
        'markup; it also returns the matching PLAIN-TEXT body (send both parts so it stays out of spam). Use ' +
        'for welcome / verify / reset / receipt emails; pass .html + .text into the email-send recipe. No env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_currency',
      description:
        'Add real currency conversion to the app (Bring-Your-Own key): a server getRate(from, to) + convert(' +
        'amount, from, to) helper for "exchangerate" (any pair directly) or "fixer" (EUR-base cross-rate, ' +
        'computed for you) — behind multi-currency pricing, international checkout and finance dashboards. ' +
        'Server-side (the key never reaches the browser); no npm dependency (REST via fetch). The user pastes ' +
        'their key into .env; NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['exchangerate', 'fixer'], description: 'The exchange-rate provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_money_format',
      description:
        'Add real Indian money/number formatting to the app (server/lib/money.ts): dependency-free ' +
        'formatInr(paise) → a correctly lakh/crore-grouped ₹ string (12345678 → "₹1,23,456.78"), ' +
        'formatIndianNumber(n) → Indian-grouped counts, and rupeesInWords(rupees) → the amount in words ' +
        '(lakh/crore) for invoices/cheques. Built on native Intl en-IN, so grouping is correct (NOT Western ' +
        'thousands). Store money as integer paise. Distinct from generate_currency (conversion). No env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_weather',
      description:
        'Add real current-weather lookup to the app (Bring-Your-Own key): a server getWeather(city) → ' +
        '{ tempC, description, humidity } helper for "openweathermap" or "weatherapi" — behind delivery ETAs, ' +
        'travel, agri/logistics and dashboard features. Server-side (the key never reaches the browser); no ' +
        'npm dependency (REST via fetch); returns null on failure so it never breaks. The user pastes their ' +
        'key into .env; NavBharatAI never stores it. Never overwrites an existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['openweathermap', 'weatherapi'], description: 'The weather provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_datetime',
      description:
        'Add real IST date/time formatting to the app (server/lib/datetime.ts): dependency-free ' +
        'formatIstDateTime/formatIstDate/formatIstTime that render any timestamp in IST (Asia/Kolkata) ' +
        'regardless of the server timezone — fixing the common UTC-server bug where times show 5.5h off — plus ' +
        'relativeTime(ts) for a "2 hours ago" label. Accepts a Date, ISO string or epoch-ms; guards invalid ' +
        'dates. Use on order/appointment/"posted at" labels. Built on native Intl; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_notify',
      description:
        'Add real team notifications to the app (Bring-Your-Own webhook): a server notify(message) helper for ' +
        '"slack" or "discord" that posts to a channel — a new order, signup, failed payment or support ' +
        'request straight into your team chat. Server-side (the webhook URL never reaches the browser); no npm ' +
        'dependency (incoming webhook via fetch); never throws so a notification failure can\'t break the ' +
        'request. The user pastes the webhook URL into .env; NavBharatAI never stores it. Never overwrites an ' +
        'existing .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['slack', 'discord'], description: 'The team-chat provider to wire up.' },
        },
        required: ['provider'],
      },
    },
    {
      name: 'generate_notification_center',
      description:
        'Add a real IN-APP notification center to the frontend (src/notifications/, dependency-free React): a ' +
        'NotificationsProvider (add / mark-read / mark-all-read / unread count, persisted to localStorage) + a ' +
        'useNotifications hook + a NotificationBell component (unread badge + accessible dropdown + honest ' +
        'empty state). Wrap the app in <NotificationsProvider>, drop <NotificationBell/> in the header, and ' +
        "call add({ title, body }) anywhere. This is the IN-APP center; for OUTBOUND email/SMS/push use " +
        'generate_notify. No dependency, no env key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_env_validation',
      description:
        'Add a real fail-fast environment-variable validator to the app (server/lib/env.ts): validateEnv + ' +
        'requireEnv check every required env var is set and non-empty AT STARTUP and throw ONE clear error ' +
        'naming any that are missing — so a misconfigured deploy crashes immediately with an actionable ' +
        'message instead of a cryptic 500 deep inside a request. Pass "keys" = the env vars the app needs ' +
        '(e.g. the keys the other generators told the user to set). Unlike generate_env_example (which only ' +
        'documents keys) this ENFORCES them. Adds no dependency and no new env keys; never writes .env.example.',
      input_schema: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'The required environment-variable names to enforce at startup (e.g. ["DATABASE_URL", "STRIPE_SECRET_KEY"]).',
          },
        },
        required: ['keys'],
      },
    },
    {
      name: 'generate_cors',
      description:
        'Add a safe CORS configuration to the app (server/lib/cors.ts): a dependency-free corsMiddleware that ' +
        'allows credentialed cross-origin requests ONLY from an allowlist (ALLOWED_ORIGINS, comma-separated) ' +
        'and echoes back the exact matching origin — NEVER a wildcard "*", the dangerous anti-pattern the ' +
        'threat-model flags. Fixes the common fullstack blocker where the browser refuses the frontend→backend ' +
        'call. Handles the OPTIONS preflight. The user sets ALLOWED_ORIGINS in .env; NavBharatAI never stores ' +
        'it. Never overwrites an existing .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_csrf',
      description:
        'Add CSRF protection (double-submit cookie) to the app (server/lib/csrf.ts): dependency-free ' +
        'issueCsrfToken(res) + a csrfProtection Express middleware. Use when the app authenticates with a ' +
        'COOKIE session — it guards state-changing routes (POST/PUT/PATCH/DELETE) by requiring the ' +
        "'x-csrf-token' header to match the csrf_token cookie (constant-time compare); a cross-origin " +
        'attacker cannot read the cookie, so cannot forge the header → 403. Safe methods pass through. Not ' +
        'needed for pure Bearer/JWT-header APIs (no cookie). node:crypto, no dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_slug',
      description:
        'Add a real URL slug generator to the app (server/lib/slug.ts): a dependency-free slugify(title) that ' +
        'turns any title into a clean, URL-safe slug for blog posts, product pages, docs and profiles, plus ' +
        'uniqueSlug(title, existing) for collision-safe slugs. Unicode-aware — Hindi/Indic titles (e.g. ' +
        '"नमस्ते दुनिया" → "नमस्ते-दुनिया") produce a real slug instead of an empty string, and Latin accents ' +
        'are folded (café → cafe). No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_validation',
      description:
        'Add real request/input validation to the app (server/lib/validate.ts, zod): a typed validateBody() ' +
        'helper + an Express validate(schema) middleware that reject a malformed body with a clear 400 listing ' +
        'exactly which fields are wrong, BEFORE the handler runs — so bad input never crashes a route or ' +
        'reaches the database. Use whenever a route accepts a body (signup, forms, APIs). Adds the zod ' +
        'dependency; introduces no env keys and never writes .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_sanitize_html',
      description:
        'Add real HTML sanitization / XSS prevention to the app (server/lib/sanitize.ts, sanitize-html): ' +
        'sanitizeHtml(dirty) keeps a safe formatting subset (headings, lists, bold/italic, links forced to ' +
        'safe protocols + rel="noopener") and strips <script>, event handlers, javascript: URLs and <iframe>; ' +
        'sanitizeToText(dirty) strips all markup to plain text. Run it on any user-supplied HTML before you ' +
        'store or render it (comments, rich-text posts, bios, ticket bodies) to close the stored-XSS hole — a ' +
        'proper allowlist, not a bypassable regex. Adds the sanitize-html dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_markdown',
      description:
        'Add real Markdown → SAFE HTML rendering to the app (server/lib/markdown.ts, marked + sanitize-html): ' +
        'renderMarkdown(md) renders Markdown AND sanitizes the output in ONE call, so untrusted Markdown (a ' +
        'comment, a wiki edit) can never inject <script> or an onerror handler — safe by construction, no ' +
        'separate sanitize step to forget. Keeps a rich subset (headings, lists, TABLES, code blocks, images, ' +
        'links forced to safe protocols + rel="noopener"). Use for blogs, docs, comments, product descriptions. ' +
        'Adds the marked + sanitize-html dependencies; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_logging',
      description:
        'Add real structured logging to the app (server/lib/logger.ts, pino): a configured JSON logger + an ' +
        'Express requestLogger middleware that logs method/url/status/duration for every request (never ' +
        'headers or body, so secrets never leak). Replaces console.log with searchable, level-filtered, ' +
        'shippable logs — real observability in production. Adds the pino dependency; LOG_LEVEL tunes ' +
        'verbosity. Never overwrites an existing .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_request_id',
      description:
        'Add a real correlation-id (request-id) middleware to the app (server/lib/requestId.ts): dependency-' +
        'free (node:crypto), it reuses a SAFE inbound X-Request-Id (from a trusted proxy) or mints a UUID, puts ' +
        'it on req.id, and echoes it on the response header — so every log line and downstream call for one ' +
        'request shares one id and can be traced end to end. An unsafe/oversized header value is ignored; set ' +
        'trustInbound:false to always mint fresh. Mount it first, pairs with generate_logging/generate_tracing. ' +
        'No dependency, no key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_file_upload',
      description:
        'Add real file-upload validation to the app (server/lib/upload.ts): a dependency-free ' +
        'validateUpload(buffer, { allowed, maxBytes }) + detectFileType(buffer) that identify the TRUE file ' +
        'type from its MAGIC BYTES (PNG/JPEG/GIF/WebP/PDF/MP4/ZIP), NOT the forgeable client filename/extension/' +
        'Content-Type — so a renamed .php or a script cannot slip through as an image. Enforces a type ' +
        'allowlist + size cap and returns an honest {ok, type, error}. Run it before saving any upload ' +
        '(avatars, product photos, documents); pair with generate_image to resize after validating. No env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_graceful_shutdown',
      description:
        'Add real graceful shutdown to the app (server/lib/shutdown.ts): installGracefulShutdown(server) traps ' +
        'the SIGTERM every deploy/restart sends — stops accepting new connections, lets in-flight requests ' +
        'finish, runs optional cleanup (close the DB pool), then exits, with a hard timeout so a stuck ' +
        'connection can never hang the deploy. Prevents dropped requests and cut DB connections on restart ' +
        '(the actionable counterpart to the graceful-shutdown advisory). Dependency-free; SHUTDOWN_TIMEOUT_MS ' +
        'tunes the timeout. Writes no .env.example.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_maintenance',
      description:
        'Add real maintenance mode to the app (server/lib/maintenance.ts): a dependency-free Express middleware ' +
        'that, when on, returns 503 + Retry-After to every request EXCEPT health checks (/health,/healthz,/readyz ' +
        'so the orchestrator does not kill the instance), with an optional operator bypass header+token and a ' +
        'runtime setMaintenance(true/false) toggle seeded from the MAINTENANCE_MODE env. Mount it first. Use to ' +
        'take the app down cleanly for a deploy/migration. No dependency, no third-party key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_security_headers',
      description:
        'Add real security headers to the app (server/lib/securityHeaders.ts): a dependency-free middleware ' +
        'that sets the safe browser hardening headers (X-Content-Type-Options nosniff, X-Frame-Options ' +
        'SAMEORIGIN, Referrer-Policy, HSTS, Permissions-Policy) — defending against clickjacking, MIME-' +
        'sniffing and referrer leakage WITHOUT breaking a normal app. The actionable counterpart to the ' +
        'security-headers advisory. A Content-Security-Policy is included as a commented, opt-in block (a ' +
        'wrong CSP breaks the app, so it needs per-app tuning). No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_seo',
      description:
        'Add real SEO essentials to the app (server/lib/seo.ts): dependency-free buildMetaTags({ title, ' +
        'description, url, image }) → <head> title + description + canonical + OpenGraph + Twitter-card tags ' +
        '(so a shared link shows a proper preview on WhatsApp/LinkedIn/Twitter), buildSitemap(entries) → a ' +
        'valid /sitemap.xml, and buildRobotsTxt({ sitemapUrl, disallow }) → /robots.txt. Every value is ' +
        'escaped for its context, so a title with <, > or & never breaks the tag or the XML (nor injects ' +
        'markup). Use on any public site for discoverability. No dependency; no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_image',
      description:
        'Add real image processing to the app (server/lib/image.ts, sharp): resizeImage(buffer, { width }) to ' +
        'bound + re-encode a heavy upload into a fast web asset (WebP by default, honours EXIF orientation) + ' +
        'makeThumbnail(buffer, 200) for a square avatar/tile. Pair with file-upload/storage: resize BEFORE ' +
        'storing. Server-side; adds the sharp dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_webhook',
      description:
        'Add real incoming-webhook signature verification to the app (server/lib/webhook.ts): a dependency-free ' +
        'verifyWebhookSignature(rawBody, header, secret) that HMAC-SHA256s the RAW body and compares in ' +
        'CONSTANT TIME (crypto.timingSafeEqual), tolerating the "sha256=<hex>" header form — so a forged ' +
        '"payment succeeded" callback is rejected. Essential for payment webhooks (Cashfree/Razorpay/Stripe), ' +
        'GitHub/Shopify/WhatsApp callbacks. Call it on every webhook route before trusting the payload; the ' +
        'app supplies the provider secret via .env. No dependency (node:crypto); no env keys invented.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_webhook_sender',
      description:
        'Add a real OUTGOING webhook sender to the app (server/lib/webhookSender.ts): a dependency-free ' +
        'sendWebhook(url, payload, secret, { event }) for when YOUR app lets customers subscribe to events. It ' +
        'HMAC-SHA256 signs the JSON body as "X-Webhook-Signature: sha256=<hex>" (the exact format ' +
        'generate_webhook verifies, so subscribers can confirm it is really you), enforces a timeout so a slow ' +
        'subscriber cannot hang your server, and returns { ok, status } without throwing (retry on !ok). The ' +
        'send/verify pair to generate_webhook. No dependency (node:crypto + fetch); no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_pdf',
      description:
        'Add real PDF generation to the app (server/lib/pdf.ts, pdfkit): a server createInvoicePdf(...) ready ' +
        'invoice + a generic createPdf((doc) => { ... }) builder that resolve a Buffer you can stream as the ' +
        'HTTP response, save, or email. Core for GST/tax invoices, receipts, order confirmations, tickets and ' +
        'reports. Server-side; adds the pdfkit dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_csv',
      description:
        'Add real CSV import/export to the app (server/lib/csv.ts, papaparse): a server toCsv(rows) → ' +
        'Excel-ready CSV string + parseCsv(text) → objects. Quoting/escaping of commas, quotes and newlines ' +
        'is RFC-4180 correct, so data never corrupts. Use for report/table export, bulk product/contact/order ' +
        'import and data migration. Server-side; adds the papaparse dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_audit',
      description:
        'Add a real tamper-evident audit log to the app (server/lib/audit.ts) — dependency-free (node:crypto), ' +
        'NO API key, storage-agnostic. appendAudit(store, { actor, action, target?, meta? }) records who did ' +
        'what when; each entry stores the SHA-256 hash of the previous entry (a hash chain), so editing or ' +
        'deleting any past row breaks the chain. verifyAuditChain(entries) returns the seq of the first ' +
        'tampered entry (or -1 if intact). You supply a tiny { last(), save() } store backed by your DB. Use ' +
        'for admin actions, money movements, role changes and sensitive data edits — anything that needs a ' +
        'trustworthy trail.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_soft_delete',
      description:
        'Add real soft delete (trash & restore) to the app (server/lib/softDelete.ts): dependency-free and ' +
        'storage-agnostic. Instead of hard-deleting a record, softDelete(record) stamps deletedAt so it can be ' +
        'RESTORED (undo delete / a Trash bin / audit-friendly retention); restore(record) brings it back, ' +
        'isDeleted(record) checks it, and activeOnly/trashedOnly filter a list. For SQL, add a nullable ' +
        'deleted_at column and use activeWhere() ("deleted_at IS NULL") / trashedWhere(). Pairs with the ' +
        'audit-log recipe. No dependency, no key.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_qr',
      description:
        'Add real QR-code generation to the app (server/lib/qr.ts, qrcode): a server generateQr(text) → PNG ' +
        'data-URL + generateQrSvg(text) → SVG helper. Use for event/movie tickets, UPI & payment links, ' +
        '"scan to open", table ordering and share links (e.g. generateQr("upi://pay?pa=merchant@bank&am=100")). ' +
        'Server-side, generate on demand per order/ticket; adds the qrcode dependency, no env keys.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_upi',
      description:
        'Add a real UPI payment deep-link to the app (src/lib/upi.ts) — India-first, dependency-free, NO API ' +
        'key and NO payment gateway. buildUpiLink({ payeeVpa, payeeName, amount?, note? }) returns a ' +
        '`upi://pay?...` intent link that opens GPay/PhonePe/Paytm/BHIM directly for a real payment to the ' +
        "merchant's OWN VPA; isValidVpa(vpa) validates the address; omit amount for an open collect link. " +
        'Params are URL-encoded and the amount is fixed to 2 decimals (UPI spec), so the link works on the ' +
        'first tap. Pair with generate_qr (generateQr(link)) for scan-to-pay. Use this for direct merchant ' +
        'collection; for a gateway with webhooks/refunds use generate_payment instead.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_mobile_export',
      description:
        'Wrap the generated web app as a native mobile (Android/iOS) project using Capacitor: emits a ' +
        'parameterized capacitor.config.ts + a MOBILE_EXPORT.md runbook, and reports the Capacitor ' +
        'dependencies + package.json scripts to add. Use when the user wants a mobile/APK/Play-Store/app-store ' +
        'version of their app. HONEST: this generates the wrapper config, NOT a signed .apk/.aab/.ipa binary — ' +
        'that needs the native SDK + the user\'s keystore on a build runner. Never overwrites an existing ' +
        'capacitor.config.ts.',
      input_schema: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'Human app name shown on the device (e.g. "My Shop").' },
          appId: { type: 'string', description: 'Optional reverse-DNS app id (e.g. com.acme.myshop). Derived from appName when omitted.' },
          webDir: { type: 'string', description: 'Build output dir Capacitor packages (Vite → "dist", CRA → "build", Next export → "out"). Default "dist".' },
        },
        required: [],
      },
    },
    {
      name: 'generate_desktop_export',
      description:
        'Wrap the generated web app as a desktop app (Windows/.exe, macOS/.dmg, Linux/.AppImage) using ' +
        'Electron: emits electron/main.cjs + electron-builder.yml + a DESKTOP_EXPORT.md runbook, and reports ' +
        'the Electron devDependencies, package.json scripts, and the "main" entry to set. Use when the user ' +
        'wants a desktop/installable/.exe version of their app. HONEST: this generates the wrapper config, NOT ' +
        'a signed installer — electron-builder must run on the matching OS (Windows for .exe, macOS for .dmg). ' +
        'Never overwrites an existing electron-builder.yml.',
      input_schema: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'Human product name shown on the app/window (e.g. "My Shop").' },
          appId: { type: 'string', description: 'Optional reverse-DNS app id (e.g. com.acme.myshop). Derived from appName when omitted.' },
          webDir: { type: 'string', description: 'Build output dir Electron loads (Vite → "dist", CRA → "build", Next export → "out"). Default "dist".' },
        },
        required: [],
      },
    },
    {
      name: 'generate_extension_export',
      description:
        'Wrap the generated web app as a Chrome/Edge/Firefox browser extension (Manifest V3): emits a ' +
        'manifest.json that serves the built app as the extension popup + an EXTENSION_EXPORT.md runbook. Use ' +
        'when the user wants a "browser extension / Chrome extension" version of their app. HONEST: it ' +
        'generates the manifest + load/package instructions, not a published extension (publishing needs a ' +
        'Web Store / AMO developer account + review). Never overwrites an existing manifest.json.',
      input_schema: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'Extension name shown in the browser (e.g. "My Shop").' },
          description: { type: 'string', description: 'Optional short description for the manifest / store listing.' },
          webDir: { type: 'string', description: 'Build output dir whose index.html becomes the popup (Vite → "dist"). Default "dist".' },
        },
        required: [],
      },
    },
    {
      name: 'generate_types',
      description:
        'Generate TypeScript interface types from the app\'s database schema (Prisma models / SQL CREATE ' +
        'TABLE) and write them to src/types/db.ts, so the frontend and backend share one typed shape of the ' +
        'database instead of hand-written types that drift. Prisma enums become string-union types. Use after ' +
        'defining or changing the schema.',
      input_schema: {
        type: 'object',
        properties: { outPath: { type: 'string', description: 'Optional output path (default src/types/db.ts).' } },
        required: [],
      },
    },
    {
      name: 'optimize_infra',
      description:
        'Scan the app\'s infrastructure files (Dockerfile, Kubernetes manifests, Terraform) for real security ' +
        'and reliability anti-patterns: a base image on :latest, a container running as root, a secret baked ' +
        'into an image layer, a K8s pod with no resource limits or running privileged, a public (allUsers) ' +
        'Cloud Run binding, an unpinned Terraform provider, and more. Reports each finding with a concrete ' +
        'fix. Use before deploying, or when the user asks to harden/optimize their Docker/K8s/Terraform.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'schema_graph',
      description:
        'Show the database schema relationship graph (Prisma models / SQL tables and how they reference each ' +
        'other) and the CHANGE-PROPAGATION blast radius. Call with a "model" to see exactly which other ' +
        'models/tables reference it — review those BEFORE you rename, drop, or change the key of that model, ' +
        'so a schema change does not silently break dependents. Call with no argument for the whole graph + ' +
        'per-model dependent counts.',
      input_schema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Optional model/table name to see its blast radius (who depends on it).' },
        },
        required: [],
      },
    },
    {
      name: 'repair_ci_workflow',
      description:
        'Detect and fix a broken CI pipeline — GitHub Actions (.github/workflows/*.yml), GitLab CI (.gitlab-ci.yml), or Jenkins (Jenkinsfile) — that will FAIL when it ' +
        'runs: `npm ci` with no committed lockfile (auto-fixed to `npm install`), a setup-node cache keyed to ' +
        'the wrong package manager (repointed to the real one), or an `npm run <script>` for a script ' +
        'package.json does not define (reported for a manual fix). Use after generating a fullstack/CI app, ' +
        'or when the user says CI is failing. Only changes workflows that are actually broken.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'replace_symbol',
      description:
        'AST-SAFELY replace ONE top-level symbol (a function, class, interface, type, enum, or const) ' +
        'in a file by name, leaving all surrounding code byte-for-byte intact. Use this instead of ' +
        'edit_file when you want to rewrite a whole function/class and a fuzzy string match would be ' +
        'risky or ambiguous — it parses the file with the TypeScript compiler and swaps exactly that ' +
        "declaration's node. Returns an honest error (with the available symbol names) if the symbol " +
        "isn't a top-level declaration.",
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File to patch, e.g. src/lib/auth.ts.' },
          symbol: { type: 'string', description: 'Top-level symbol name to replace (function/class/interface/type/enum/const).' },
          code: { type: 'string', description: 'The complete new declaration text (e.g. the full "export function ...() { ... }").' },
        },
        required: ['path', 'symbol', 'code'],
      },
    },
    {
      name: 'check_conventions',
      description:
        'Check naming + import-ordering conventions and get suggested fixes (analysis only — writes ' +
        'nothing). Pass file paths (PascalCase for .tsx components, camelCase for .ts services/hooks), ' +
        'identifiers with their kind (function/variable→camel, constant→SCREAMING_SNAKE, component/type→' +
        'Pascal), and/or import lines (to get the correct built-in→external→internal→relative order). ' +
        'Use it before finishing to keep the generated code consistent, then apply the suggestions with edit_file.',
      input_schema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to check, e.g. src/components/myCard.tsx.' },
          identifiers: {
            type: 'array',
            description: 'Identifiers to check.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                kind: { type: 'string', description: 'function | variable | constant | component | type' },
              },
              required: ['name', 'kind'],
            },
          },
          imports: { type: 'array', items: { type: 'string' }, description: 'Import lines to re-order.' },
        },
      },
    },
    {
      name: 'generate_release_notes',
      description:
        'Generate user-facing RELEASE NOTES (Markdown) for the app and write them to the workspace ' +
        '(default RELEASE_NOTES.md). Pass the current feature list (and the previous one, if you have it, ' +
        'to produce a real added/removed diff). Honest: identical features → a "no user-visible changes" ' +
        'note (nothing fabricated). Use when finishing a version or before a deploy.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name (defaults to "App").' },
          features: { type: 'array', items: { type: 'string' }, description: 'Current user-visible features.' },
          previous_features: { type: 'array', items: { type: 'string' }, description: 'Previous version features (for the diff).' },
          tech_stack: { type: 'array', items: { type: 'string' }, description: 'Tech stack entries.' },
          version: { type: 'string', description: 'Version label, e.g. v1.2.0.' },
          path: { type: 'string', description: 'Optional output path (defaults to RELEASE_NOTES.md).' },
        },
        required: ['features'],
      },
    },
    {
      name: 'web_search',
      description:
        'Search the web for up-to-date information — package versions, framework/API docs, ' +
        'or the meaning of an unfamiliar error. Returns a short ranked list of titles, URLs ' +
        'and snippets. Use it when the answer is not in the workspace and you would otherwise guess.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up (e.g. "vite 5 config server.host" or "npm zod").' },
          limit: { type: 'number', description: 'Max results (1–10, default 5).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'screenshot',
      description:
        'Capture a screenshot of ANY URL and SEE the result image. Two uses: (1) YOUR OWN APP — use the ' +
        'preview URL (or http://localhost:<devPort>) after the dev server is up, to verify it renders ' +
        'correctly (layout, broken UI, missing elements); (2) ANY REAL WEBSITE ON THE INTERNET — pass a ' +
        'public address like https://example.com to actually LOOK at a real site, e.g. when the user ' +
        'asks for something "like <site>", or wants a real page examined. Optional width/height check ' +
        'responsive layouts. Requires a real sandbox.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to capture (e.g. http://localhost:5173).' },
          width: { type: 'number', description: 'Optional viewport width (e.g. 390 for mobile).' },
          height: { type: 'number', description: 'Optional viewport height.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'find_ui_element',
      description:
        'ASK THE RUNNING APP WHERE SOMETHING IS. Describe what you can SEE in plain language ("the small ' +
        'green dot", "the logo in the header", "the red Delete button") and get back the matching ' +
        'elements from the RENDERED page — each with its exact class string (grep that verbatim to reach ' +
        'the source), its text, its position and size, its real colours, and its exact file:line when the ' +
        'preview stamps one. USE THIS FIRST for any visual request ("remove/change/move the X") instead of ' +
        'guessing class names with grep: one call replaces dozens of blind searches. ' +
        'JUST AS IMPORTANT — if the thing is NOT on the page, this says so WITH EVIDENCE (which colours ' +
        'and shapes actually exist). That is a real answer: report it to the user and ask what they meant. ' +
        'NEVER edit a different element because you could not find the one they named. Requires a real sandbox.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The running app URL to inspect (the preview URL, or http://localhost:<devPort>).' },
          query: { type: 'string', description: 'What you are looking for, in plain language — colour, shape, text or role (e.g. "small green dot", "logo", "Submit button").' },
        },
        required: ['url', 'query'],
      },
    },
    {
      name: 'browser_action',
      description:
        'Drive a REAL Chrome browser — on your own app OR on any real website on the internet. Actions: ' +
        'click, type, navigate, scroll, press, hover, double_click, select_option, wait. State ' +
        '(cookies/DOM/URL) persists across calls, so you can complete a multi-step flow (fill a form → ' +
        'submit → verify) or browse a real site page by page. Every action returns a screenshot you can ' +
        'SEE. `navigate` accepts any public https address (e.g. https://example.com) as well as the ' +
        'sandbox preview URL — so when the user asks about a real website, GO AND LOOK AT IT rather than ' +
        'guessing from memory. Internal/private network addresses are refused. Requires a real sandbox.',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The interaction to perform.',
            enum: ['click', 'type', 'navigate', 'scroll', 'press', 'wait', 'hover', 'double_click', 'select_option'],
          },
          selector: { type: 'string', description: 'CSS selector for click/type/hover/select (when applicable).' },
          text: { type: 'string', description: 'Text to type, key to press, or option to select.' },
          url: { type: 'string', description: 'URL for the navigate action.' },
          direction: { type: 'string', description: 'Scroll direction.', enum: ['up', 'down'] },
        },
        required: ['action'],
      },
    },
    {
      name: 'console_errors',
      description:
        'Read runtime browser errors (console.error, uncaught exceptions, failed requests) captured ' +
        'while the app ran — failures a successful BUILD never reveals. Use after loading/driving the ' +
        'app to catch runtime breakage. Requires a real sandbox.',
      input_schema: {
        type: 'object',
        properties: {
          since_seconds: { type: 'number', description: 'Look back this many seconds (default 120).' },
        },
      },
    },
    {
      name: 'deploy',
      description:
        'Publish the built app to a PERMANENT public URL (Firebase Hosting) that stays live after the ' +
        'sandbox stops — use when the user asks to deploy/publish/go live. Run "npm run build" first so ' +
        'a dist/ directory exists, then call deploy. Returns the public https URL. Requires a real sandbox.',
      input_schema: { type: 'object', properties: {} },
    },
  ];
}

/** The set of base tool names the catalog exposes (for validation). */
export const CATALOG_TOOL_NAMES = [
  'read_file',
  'write_file',
  'write_files_batch',
  'edit_file',
  'bash',
  'grep',
  'glob',
  'update_todo',
  'update_preview',
  'recall',
  'evaluate',
  'codemod_rename',
  'codemod_add_prop',
  'codemod_move_file',
  'generate_readme',
  'generate_architecture_docs',
  'generate_dev_guide',
  'generate_env_example',
  'generate_gitignore',
  'generate_app_defaults',
  'generate_openapi',
  'generate_api_docs',
  'generate_tests',
  'generate_integration_tests',
  'generate_e2e',
  'run_tests',
  'typecheck',
  'find_dead_code',
  'architecture_map',
  'api_graph',
  'code_graph',
  'check_toolchain',
  'check_package',
  'lint',
  'generate_observability',
  'generate_bundle_optimization',
  'generate_seed_data',
  'generate_auth',
  'generate_migration',
  'generate_crud',
  'generate_booking',
  'generate_inventory',
  'generate_crm',
  'generate_hospital_erp',
  'generate_school_erp',
  'generate_courier',
  'generate_restaurant_pos',
  'generate_real_estate',
  'generate_fitness',
  'generate_pharmacy',
  'generate_recruitment',
  'generate_invoicing',
  'generate_events',
  'generate_subscriptions',
  'generate_polls',
  'generate_blog',
  'generate_reviews',
  'generate_loyalty',
  'generate_referrals',
  'generate_comments',
  'generate_messaging',
  'generate_listings',
  'generate_job_board',
  'generate_wishlist',
  'generate_addresses',
  'generate_coupons',
  'generate_kanban',
  'generate_timesheet',
  'generate_leaderboard',
  'generate_waitlist',
  'generate_tags',
  'generate_experiments',
  'generate_short_links',
  'generate_feedback',
  'generate_consent',
  'generate_activity_feed',
  'generate_cart',
  'generate_reactions',
  'generate_orders',
  'generate_faq',
  'generate_quiz',
  'generate_availability',
  'generate_announcements',
  'generate_collections',
  'generate_contact_form',
  'generate_pageviews',
  'generate_gift_cards',
  'generate_teams',
  'generate_status_page',
  'generate_survey',
  'generate_support_tickets',
  'generate_graphql',
  'generate_pagination',
  'generate_rbac',
  'generate_ids',
  'generate_admin',
  'generate_settings',
  'generate_dashboard',
  'generate_backup',
  'analyze_requirements',
  'generate_i18n',
  'generate_ui_states',
  'generate_state',
  'generate_image_optimization',
  'generate_sso',
  'generate_abac',
  'generate_metrics',
  'generate_tracing',
  'find_code_smells',
  'generate_deploy_artifacts',
  'generate_deploy_config',
  'generate_iac',
  'scan_vulnerabilities',
  'check_licenses',
  'threat_model',
  'run_migrations',
  'generate_db_config',
  'generate_payment',
  'generate_email',
  'generate_storage',
  'generate_realtime',
  'generate_search',
  'generate_otp',
  'generate_totp',
  'generate_indian_validators',
  'generate_analytics',
  'generate_map',
  'generate_jobs',
  'generate_scheduler',
  'generate_sms',
  'generate_password',
  'generate_ratelimit',
  'generate_api_versioning',
  'generate_error_tracking',
  'generate_feature_flags',
  'generate_ai',
  'generate_geocoding',
  'generate_translation',
  'generate_moderation',
  'generate_captcha',
  'generate_cache',
  'generate_retry',
  'generate_http_client',
  'generate_idempotency',
  'generate_newsletter',
  'generate_email_template',
  'generate_currency',
  'generate_money_format',
  'generate_weather',
  'generate_datetime',
  'generate_notify',
  'generate_notification_center',
  'generate_env_validation',
  'generate_cors',
  'generate_csrf',
  'generate_slug',
  'generate_validation',
  'generate_sanitize_html',
  'generate_markdown',
  'generate_logging',
  'generate_request_id',
  'generate_file_upload',
  'generate_graceful_shutdown',
  'generate_maintenance',
  'generate_security_headers',
  'generate_seo',
  'generate_webhook',
  'generate_webhook_sender',
  'generate_qr',
  'generate_upi',
  'generate_pdf',
  'generate_csv',
  'generate_audit',
  'generate_soft_delete',
  'generate_image',
  'generate_mobile_export',
  'generate_desktop_export',
  'repair_ci_workflow',
  'optimize_infra',
  'generate_types',
  'schema_graph',
  'generate_extension_export',
  'replace_symbol',
  'check_conventions',
  'generate_release_notes',
  'web_search',
  'screenshot',
  'find_ui_element',
  'browser_action',
  'console_errors',
  'deploy',
] as const;

/**
 * The `task` sub-agent tool (§3.3) — only the Architect gets this. Delegates a
 * focused unit of work to a specialist agent, which runs as a constrained nested
 * agent and returns a summary.
 */
export function taskToolDef(): ClaudeToolDef {
  return {
    name: 'task',
    description:
      'Delegate a focused task to a specialist agent. The agent runs with its own ' +
      'tools and returns a summary of what it did. Use this to parallelise and ' +
      'organise the build across the team.',
    input_schema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: `The specialist to delegate to. One of: ${WORKER_ROLES.join(', ')}.`,
          enum: [...WORKER_ROLES],
        },
        instruction: {
          type: 'string',
          description: 'A clear, self-contained instruction for the specialist.',
        },
      },
      required: ['role', 'instruction'],
    },
  };
}

/**
 * The `second_opinion` tool (Layer 84 — Multi-Model Ensemble). Optional, granted
 * only to the Architect (and Reviewer). Sends the question/artifact to a DIFFERENT
 * AI model (the non-Claude router) for an independent critique, so the agent can
 * cross-check risky or final work beyond a single model.
 */
export function secondOpinionToolDef(): ClaudeToolDef {
  return {
    name: 'second_opinion',
    description:
      'Get an independent critical review from a DIFFERENT AI model (not Claude). ' +
      'Provide the question or the code/decision to review. Use sparingly for ' +
      'risky or final work.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What to review — a question, a decision, or code/explanation to critique.',
        },
      },
      required: ['prompt'],
    },
  };
}

/**
 * The `consensus` tool (Layer 49 — Collective Intelligence). Optional, granted
 * only to the Architect. Convenes a PANEL of independent expert viewpoints
 * (correctness, security, UX) from a DIFFERENT AI model on a hard design
 * decision and returns their synthesized verdict — going beyond a single
 * viewpoint.
 */
export function consensusToolDef(): ClaudeToolDef {
  return {
    name: 'consensus',
    description:
      'Convene a panel of independent expert viewpoints (correctness, security, ' +
      'UX) from a different AI model on a hard design decision, and get their ' +
      'synthesized verdict. Use sparingly for important architectural choices.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The hard decision or design choice to put to the panel.',
        },
      },
      required: ['question'],
    },
  };
}

/** Build the tool definitions for a given allowed-tool list (incl. `task`). Never returns duplicate names. */
export function catalogForTools(allowed: ToolName[]): ClaudeToolDef[] {
  const base = defaultToolCatalog().filter((t) => (allowed as string[]).includes(t.name));
  if ((allowed as string[]).includes('task')) base.push(taskToolDef());
  if ((allowed as string[]).includes('second_opinion')) base.push(secondOpinionToolDef());
  if ((allowed as string[]).includes('consensus')) base.push(consensusToolDef());
  return dedupeToolsByName(base);
}

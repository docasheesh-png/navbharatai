import type { ClaudeToolDef } from './ClaudeClient';
import type { ToolName } from './types';
import { WORKER_ROLES } from './AgentRegistry';

/**
 * ToolCatalog — the native Anthropic tool definitions the v3.0 agent team can
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
      description: 'Replace the build todo list shown to the user. Use this to plan and track progress.',
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
        'workspace. Each function gets a describe/it with a smoke assertion + an explicit ' +
        '"// TODO: assert real behaviour" — it never fakes a passing assertion that pretends to verify ' +
        'logic. Use this to seed real tests for services/hooks/utils after building them.',
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
        'Read-only, no arguments. Run it on a full-stack app before declaring it done, then fix any ' +
        'MISSING call by adding the route or correcting the path/method.',
      input_schema: { type: 'object', properties: {} },
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
        'Compile/type-check EVERY language in the workspace, not just frontend TypeScript — real proof ' +
        'the code compiles. Auto-detects and runs the right checker per language present: `tsc --noEmit` ' +
        '(or the project\'s typecheck script) for TS/TSX, `compileall` for Python, `mvn compile` for ' +
        'Java, and `go build ./...` for Go — then reports OK/FAIL per language with the first errors. ' +
        'Takes no arguments. Run it before declaring a polyglot build verified; fix any language that fails.',
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
        '"firebase" writes client auth helpers (signIn/signUp/signOut/onAuthChange) over the Firebase ' +
        'SDK (needs `firebase` installed). Use when the app needs login/protected routes — then wire ' +
        'signToken on login and the middleware onto protected routes with edit_file.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['jwt', 'firebase'], description: 'Auth strategy. Defaults to "jwt" (dependency-free).' },
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
        'HPA, and an Ingress when a host is given), a Helm chart (values-parameterized), and Terraform for ' +
        'Google Cloud Run (terraform/*.tf). By default all three are written; pass "include" to pick a ' +
        'subset. Deterministic; the operator runs `kubectl apply` / `helm install` / `terraform apply`.',
      input_schema: {
        type: 'object',
        properties: {
          include: {
            type: 'array',
            description: "Which IaC to write. Any of 'k8s', 'helm', 'terraform'. Defaults to all three.",
            items: { type: 'string', enum: ['k8s', 'helm', 'terraform'] },
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
        'Capture a screenshot of a running URL inside the sandbox and SEE the result image, so ' +
        'you can verify the app actually renders correctly (layout, broken UI, missing elements). ' +
        'Use the preview URL (or http://localhost:<devPort>) after the dev server is up. Optional ' +
        'width/height check responsive layouts. Requires a real sandbox.',
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
      name: 'browser_action',
      description:
        'Drive a real headless browser to TEST interactive flows: click, type, navigate, scroll, ' +
        'press, hover, double_click, select_option, or wait. State (cookies/DOM/URL) persists across ' +
        'calls so you can complete a multi-step flow (fill a form → submit → verify). Returns the ' +
        'action result and a screenshot you can SEE. Requires a real sandbox.',
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
  'generate_env_example',
  'generate_gitignore',
  'generate_app_defaults',
  'generate_openapi',
  'generate_api_docs',
  'generate_tests',
  'run_tests',
  'find_dead_code',
  'architecture_map',
  'api_graph',
  'code_graph',
  'typecheck',
  'check_toolchain',
  'check_package',
  'lint',
  'generate_observability',
  'generate_bundle_optimization',
  'generate_seed_data',
  'generate_auth',
  'generate_migration',
  'generate_deploy_artifacts',
  'generate_iac',
  'scan_vulnerabilities',
  'replace_symbol',
  'check_conventions',
  'generate_release_notes',
  'web_search',
  'screenshot',
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

/** Build the tool definitions for a given allowed-tool list (incl. `task`). */
export function catalogForTools(allowed: ToolName[]): ClaudeToolDef[] {
  const base = defaultToolCatalog().filter((t) => (allowed as string[]).includes(t.name));
  if ((allowed as string[]).includes('task')) base.push(taskToolDef());
  if ((allowed as string[]).includes('second_opinion')) base.push(secondOpinionToolDef());
  if ((allowed as string[]).includes('consensus')) base.push(consensusToolDef());
  return base;
}

// AgentV3 — ARCHITECTURE INVARIANTS (Mission 10/10, Phase 1).
//
// THE DEFECT CLASS THIS EXISTS FOR. An app is not degraded by one bad edit; it is degraded by fifty
// locally-reasonable ones. Edit 1 builds a Tailwind app whose network calls all go through
// `src/lib/api.ts`. Edit 30 adds a page that inlines its own `fetch()` and ships a `.module.css`.
// Nothing in the stack objects: it typechecks, it lints, the preview renders, the reviewer sees a
// perfectly good file. Every gate we own judges a file on its OWN merits, and not one of them asks the
// question that actually matters on an edit — **is this how THIS app is built?**
//
// So the app slowly stops being one app. That is the same shape as the admin's "1st page beautiful,
// andar ke page bas HTML feel dete hai" report, generalised past styling to the whole architecture, and
// it is the mechanism behind a falling edit-survival curve.
//
// THE RULES COME FROM THE PROJECT, NEVER FROM US. Every invariant here is OBSERVED from the codebase's
// own dominant practice. We do not have an opinion about whether an app should use Tailwind or the `@/`
// alias; we only insist that an app that already made that choice keeps it. A generic house style
// imposed on a user's imported repo would be us breaking THEIR architecture, which is the very failure
// this module is supposed to prevent.
//
// BOTH HALVES OF THE 50/50 LAW, deliberately:
//   • PREVENT — the invariants are rendered into the edit prompt BEFORE the model writes a line, so the
//     correct file is written the first time. This is the half that actually moves the number.
//   • DETECT — after the build, the files this build CHANGED are checked against the invariants derived
//     from the project as it was BEFORE the build. Deterministic, no model call, advisory only.
//
// NOT EVERY INVARIANT IS CHECKED, AND THAT IS ON PURPOSE. An invariant is only given `checked: true`
// when a violation is unambiguous from the changed file alone. "Shared state lives in the store" is
// true and worth telling the model, but a new `useState` is not a violation of it — flagging one would
// be a false alarm, and false alarms are what teach people to ignore a report. Stated-only invariants
// still do the prevention half, which is the valuable half.
//
// PURE: no I/O, no clock, no model. Bounded by construction. Never throws.

/** The kinds of invariant we can observe. */
export type InvariantKind =
  | 'styling'
  | 'import-alias'
  | 'data-access'
  | 'state-store'
  | 'layering'
  | 'page-location';

export interface Invariant {
  kind: InvariantKind;
  /** The rule, phrased as an instruction to whoever edits this project next. */
  rule: string;
  /** Why we believe it — the observation from the project's own files. Never a guess. */
  evidence: string;
  /**
   * True when a violation is unambiguously detectable from a changed file's content. A stated-only
   * invariant (false) still reaches the prompt; it simply is not something we will accuse a file of.
   */
  checked: boolean;
  /**
   * The machine-readable half of the rule — what the checker actually compares against.
   *
   * It exists so the check is driven by DATA rather than by parsing the sentence back out of `rule`.
   * Reconstructing state from prose means a harmless reword silently switches a check off, which is a
   * failure mode this codebase has already paid for once.
   */
  params?: {
    styling?: StylingSystem;
    /** 'alias' — internal imports go through the alias; 'relative' — there is no alias to use. */
    importStyle?: 'alias' | 'relative';
    /** The single module every network call is expected to go through. */
    apiHub?: string;
  };
}

export interface InvariantViolation {
  kind: InvariantKind;
  file: string;
  /** What the file did, in the terms the invariant is phrased in. */
  detail: string;
  rule: string;
}

export interface DeriveInput {
  /** Every source path in the project. */
  files: readonly string[];
  /** file → the module specifiers it imports (WorkspaceMemory's graph shape). */
  imports: Record<string, readonly string[]>;
  /** External package names seen across imports / declared in package.json. */
  dependencies?: readonly string[];
  /**
   * File contents, when available. Optional on purpose: at prompt time the project graph is warm but
   * the contents are not, and re-reading a whole project to build a prompt block would cost more than
   * the block saves. Supplying contents only ever yields MORE invariants, never different ones.
   */
  contents?: Record<string, string>;
}

/** Caps — a prompt block that can grow without bound is a bill that can grow without bound. */
const MAX_VIOLATIONS = 8;

const isCode = (f: string): boolean => /\.(t|j)sx?$/.test(f);
const isSource = (f: string): boolean => isCode(f) && !/(^|\/)(node_modules|dist|build|\.next|coverage)\//.test(f);
const isTestFile = (f: string): boolean => /\.(test|spec)\.(t|j)sx?$/.test(f) || /(^|\/)(__tests__|tests?)\//.test(f);

// ---------------------------------------------------------------------------------------------
// STYLING SYSTEM
// ---------------------------------------------------------------------------------------------

type StylingSystem = 'tailwind' | 'css-modules' | 'styled-components';

const STYLED_PACKAGES: Record<string, StylingSystem> = {
  'styled-components': 'styled-components',
  '@emotion/styled': 'styled-components',
  '@emotion/react': 'styled-components',
};

/**
 * The ONE styling system this project uses, or null when it uses none or several.
 *
 * A mixed project gets no invariant at all. That is the precision-first choice: a repo that genuinely
 * uses Tailwind for pages and CSS modules for a design-system package is not making a mistake, and
 * telling it otherwise would be us imposing a preference we have no business having.
 */
export function detectStylingSystem(input: DeriveInput): StylingSystem | null {
  const files = input.files || [];
  const deps = new Set(input.dependencies || []);
  const found = new Set<StylingSystem>();

  if (files.some((f) => /(^|\/)tailwind\.config\.(js|ts|cjs|mjs)$/.test(f))) found.add('tailwind');
  if (deps.has('tailwindcss')) found.add('tailwind');
  for (const [pkg, system] of Object.entries(STYLED_PACKAGES)) if (deps.has(pkg)) found.add(system);
  // Two or more, so a single stray module stylesheet in a Tailwind app does not read as a system.
  if (files.filter((f) => /\.module\.(css|scss|sass|less)$/.test(f)).length >= 2) found.add('css-modules');

  // Tailwind's v4 CSS-first config declares itself in a stylesheet rather than a config file.
  if (input.contents) {
    for (const content of Object.values(input.contents)) {
      if (typeof content === 'string' && /@import\s+["']tailwindcss["']|@tailwind\s+(base|utilities)/.test(content)) {
        found.add('tailwind');
        break;
      }
    }
  }

  return found.size === 1 ? [...found][0] : null;
}

const STYLING_LABEL: Record<StylingSystem, string> = {
  tailwind: 'Tailwind CSS utility classes',
  'css-modules': 'CSS Modules (`*.module.css`)',
  'styled-components': 'styled-components / Emotion',
};

/** Which styling system a single file reaches for, or null when it styles by no particular system. */
function stylingUsedBy(content: string): StylingSystem | null {
  if (/from\s+["'](styled-components|@emotion\/styled|@emotion\/react)["']/.test(content)) return 'styled-components';
  if (/from\s+["'][^"']+\.module\.(css|scss|sass|less)["']/.test(content)) return 'css-modules';
  return null;
}

// ---------------------------------------------------------------------------------------------
// IMPORT STYLE
// ---------------------------------------------------------------------------------------------

const isAliasSpec = (s: string): boolean => /^(@|~)\//.test(s);
const isRelativeSpec = (s: string): boolean => s.startsWith('.');
/** Two or more levels up. A single `./x` or `../x` is normal even in an alias project. */
const isDeepRelative = (s: string): boolean => s.startsWith('../../');

/** How this project refers to its own modules: by alias, relatively, or with no clear majority. */
export function detectImportStyle(input: DeriveInput): { style: 'alias' | 'relative'; alias: string } | null {
  let aliasCount = 0;
  let relativeCount = 0;
  let aliasPrefix = '@/';
  for (const [file, specs] of Object.entries(input.imports || {})) {
    if (!isSource(file) || isTestFile(file)) continue;
    for (const spec of specs || []) {
      if (isAliasSpec(spec)) { aliasCount += 1; aliasPrefix = spec.slice(0, 2); }
      else if (isRelativeSpec(spec)) relativeCount += 1;
    }
  }
  const total = aliasCount + relativeCount;
  // Below this there is no "convention" yet, only a handful of imports.
  if (total < 8) return null;
  if (aliasCount / total >= 0.8) return { style: 'alias', alias: aliasPrefix };
  // A project with NO alias imports at all is the more valuable half of this pair: introducing `@/`
  // into a project whose bundler has no such alias configured is not drift, it is a broken build.
  if (aliasCount === 0) return { style: 'relative', alias: aliasPrefix };
  return null;
}

// ---------------------------------------------------------------------------------------------
// DATA ACCESS
// ---------------------------------------------------------------------------------------------

/**
 * A direct network call, ignoring the words that merely contain one.
 *
 * `refetch()`, `queryClient.fetchQuery()` and `this.fetch()` are all method calls on something that
 * already went through the app's own layer, so they are not what this is looking for.
 */
const DIRECT_NETWORK = /(^|[^.\w])(fetch\s*\(|axios\s*[.(])/;

const looksLikeApiHub = (f: string): boolean =>
  /(^|\/)(src\/)?(lib|api|services|service|utils|shared|data)\/[^/]*(api|http|client|request|fetcher|axios)[^/]*\.(t|j)sx?$/i.test(f)
  || /(^|\/)(src\/)?(api|apiClient|http|httpClient)\.(t|j)sx?$/i.test(f);

/**
 * The single module every network call in this project goes through, or null.
 *
 * Requires all three: a plausible hub that really does call the network, at least three other modules
 * importing it, and NOT ONE other source file calling the network directly. That last condition is
 * what makes a later violation meaningful — the project has demonstrably held this line everywhere, so
 * a new file breaking it is drift, not a difference of opinion.
 */
export function detectApiHub(input: DeriveInput): { file: string; importers: number } | null {
  const contents = input.contents;
  if (!contents) return null;

  const sourceFiles = Object.keys(contents).filter((f) => isSource(f) && !isTestFile(f));
  const hubs = sourceFiles.filter((f) => looksLikeApiHub(f) && DIRECT_NETWORK.test(contents[f] || ''));
  if (hubs.length !== 1) return null;
  const hub = hubs[0];

  // Anyone else calling the network directly means there is no such convention to protect.
  for (const f of sourceFiles) {
    if (f === hub) continue;
    if (DIRECT_NETWORK.test(contents[f] || '')) return null;
  }

  const stem = hub.replace(/\.(t|j)sx?$/, '').replace(/\/index$/, '');
  const tail = stem.split('/').pop() || stem;
  let importers = 0;
  for (const [file, specs] of Object.entries(input.imports || {})) {
    if (file === hub || !isSource(file)) continue;
    if ((specs || []).some((s) => isAliasSpec(s) || isRelativeSpec(s) ? s.replace(/\.(t|j)sx?$/, '').endsWith(tail) : false)) {
      importers += 1;
    }
  }
  return importers >= 3 ? { file: hub, importers } : null;
}

// ---------------------------------------------------------------------------------------------
// STATE, LAYERING, PLACEMENT — stated, not checked
// ---------------------------------------------------------------------------------------------

const STATE_PACKAGES: Record<string, string> = {
  zustand: 'Zustand',
  '@reduxjs/toolkit': 'Redux Toolkit',
  'react-redux': 'Redux',
  jotai: 'Jotai',
  recoil: 'Recoil',
  mobx: 'MobX',
  valtio: 'Valtio',
};

function detectStateStore(input: DeriveInput): { lib: string; file: string } | null {
  const deps = new Set(input.dependencies || []);
  const lib = Object.keys(STATE_PACKAGES).find((p) => deps.has(p));
  if (!lib) return null;
  const store = (input.files || []).find((f) => isSource(f) && /(^|\/)(store|stores)[./]/i.test(f));
  return store ? { lib: STATE_PACKAGES[lib], file: store } : null;
}

const PAGE_DIRS = ['src/pages/', 'src/screens/', 'src/views/', 'src/routes/', 'app/', 'pages/'];

function detectPageDir(input: DeriveInput): { dir: string; count: number } | null {
  const counts = PAGE_DIRS
    .map((dir) => ({ dir, count: (input.files || []).filter((f) => f.startsWith(dir) && isSource(f)).length }))
    .filter((c) => c.count >= 3)
    .sort((a, b) => b.count - a.count);
  // Two comparably-sized page directories means the project has no single answer; saying it does
  // would send new pages to an arbitrary one of them.
  if (counts.length === 0) return null;
  if (counts.length > 1 && counts[1].count >= counts[0].count / 2) return null;
  return counts[0];
}

function hasClientServerSplit(input: DeriveInput): boolean {
  const files = input.files || [];
  const hasServer = files.some((f) => /(^|\/)(src\/)?server\//.test(f) && isSource(f));
  const hasClient = files.some((f) => /(^|\/)(src\/)?(client|components|pages)\//.test(f) && isSource(f));
  return hasServer && hasClient;
}

// ---------------------------------------------------------------------------------------------
// DERIVE / RENDER / CHECK
// ---------------------------------------------------------------------------------------------

/** Everything this project has demonstrably decided about its own structure. Pure. Never throws. */
export function deriveInvariants(input: DeriveInput): Invariant[] {
  const out: Invariant[] = [];
  if (!input || !Array.isArray(input.files)) return out;

  const styling = detectStylingSystem(input);
  if (styling) {
    out.push({
      kind: 'styling',
      rule: `Style every new or edited file with ${STYLING_LABEL[styling]} — the system this project already uses. Do not introduce a second styling system.`,
      evidence: `the project's existing files style exclusively with ${STYLING_LABEL[styling]}`,
      checked: true,
      params: { styling },
    });
  }

  const importStyle = detectImportStyle(input);
  if (importStyle?.style === 'alias') {
    out.push({
      kind: 'import-alias',
      rule: `Import this project's own modules through the \`${importStyle.alias}\` alias, not through deep relative paths like \`../../\`.`,
      evidence: `at least 80% of internal imports already use \`${importStyle.alias}\``,
      checked: true,
      params: { importStyle: 'alias' },
    });
  } else if (importStyle?.style === 'relative') {
    out.push({
      kind: 'import-alias',
      rule: 'Import this project\'s own modules with RELATIVE paths (`./x`, `../x`). This project has no `@/` path alias — an aliased import will not resolve and will break the build.',
      evidence: 'every internal import in the project is relative; no alias is in use',
      checked: true,
      params: { importStyle: 'relative' },
    });
  }

  const hub = detectApiHub(input);
  if (hub) {
    out.push({
      kind: 'data-access',
      rule: `Make every network call through \`${hub.file}\`. Do not call \`fetch\` or \`axios\` directly from a component, page or hook.`,
      evidence: `${hub.importers} modules import it and no other file in the project calls the network directly`,
      checked: true,
      params: { apiHub: hub.file },
    });
  }

  const store = detectStateStore(input);
  if (store) {
    out.push({
      kind: 'state-store',
      rule: `Shared application state lives in \`${store.file}\` (${store.lib}). Add new shared state there rather than introducing a second store or duplicating it in component state.`,
      evidence: `the project uses ${store.lib} with a store module at \`${store.file}\``,
      checked: false,
    });
  }

  if (hasClientServerSplit(input)) {
    out.push({
      kind: 'layering',
      rule: 'Client code must never import from `server/`. Share types through a shared module and talk to the server over its API.',
      evidence: 'the project keeps client and server code in separate directories',
      checked: false,
    });
  }

  const pageDir = detectPageDir(input);
  if (pageDir) {
    out.push({
      kind: 'page-location',
      rule: `New pages/screens belong in \`${pageDir.dir}\`, alongside the existing ones.`,
      evidence: `${pageDir.count} pages already live there`,
      checked: false,
    });
  }

  return out;
}

/**
 * The prompt block. Returns '' when the project has decided nothing yet, so a fresh build costs
 * nothing and the caller can skip the section entirely.
 */
export function renderInvariants(invariants: readonly Invariant[]): string {
  if (!invariants || invariants.length === 0) return '';
  const lines: string[] = [
    '## THIS PROJECT\'S ARCHITECTURE — observed from its own code, keep to it',
    '',
    'These are not general best practices. They are the choices THIS project has already made, read out',
    'of its files. An edit that breaks one of them makes the app less consistent than it was before you',
    'touched it, even if the file you wrote is fine on its own.',
    '',
  ];
  for (const inv of invariants) lines.push(`- ${inv.rule} _(${inv.evidence})_`);
  lines.push('', 'If the user explicitly asks to change one of these, change it everywhere — never in one new file only.');
  return lines.join('\n');
}

/**
 * Check the files an edit actually changed against the invariants derived from the project BEFORE the
 * edit. Deterministic and advisory: it costs nothing on a clean build and can never fail one.
 *
 * Only `checked: true` invariants participate. Layering is deliberately not among them even though it
 * is perfectly detectable — `ArchitectureAnalysis.layeringViolations` already owns that detection over
 * the whole graph, and two modules reporting the same defect is how the two of them drift apart.
 */
export function checkInvariants(
  invariants: readonly Invariant[],
  changed: Record<string, string>,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (!invariants || !changed) return out;
  const active = invariants.filter((i) => i.checked);
  if (active.length === 0) return out;

  const styling = active.find((i) => i.kind === 'styling');
  const alias = active.find((i) => i.kind === 'import-alias');
  const data = active.find((i) => i.kind === 'data-access');
  const projectStyling = styling?.params?.styling ?? null;
  const importStyle = alias?.params?.importStyle ?? null;
  const hubFile = data?.params?.apiHub ?? null;

  for (const [file, content] of Object.entries(changed)) {
    if (typeof content !== 'string' || !isSource(file) || isTestFile(file)) continue;

    if (styling && projectStyling) {
      const used = stylingUsedBy(content);
      if (used && used !== projectStyling) {
        out.push({
          kind: 'styling',
          file,
          detail: `it styles with ${STYLING_LABEL[used]} while the rest of the app uses ${STYLING_LABEL[projectStyling]}`,
          rule: styling.rule,
        });
      }
    }

    if (alias && importStyle) {
      const specs = importSpecifiers(content);
      if (importStyle === 'alias') {
        const deep = specs.find(isDeepRelative);
        if (deep) {
          out.push({ kind: 'import-alias', file, detail: `it imports \`${deep}\` instead of using the project's alias`, rule: alias.rule });
        }
      } else {
        const aliased = specs.find(isAliasSpec);
        if (aliased) {
          out.push({ kind: 'import-alias', file, detail: `it imports \`${aliased}\`, but this project has no such alias configured`, rule: alias.rule });
        }
      }
    }

    if (data && hubFile && file !== hubFile && DIRECT_NETWORK.test(content)) {
      out.push({
        kind: 'data-access',
        file,
        detail: `it calls the network directly instead of going through \`${hubFile}\``,
        rule: data.rule,
      });
    }
  }

  return out.slice(0, MAX_VIOLATIONS);
}

/** Every module specifier a file imports (static imports, side-effect imports, re-exports). */
function importSpecifiers(content: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s;])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
}

/** One honest line for the build report. Pure. */
export function invariantSummary(invariants: readonly Invariant[], violations: readonly InvariantViolation[]): string {
  const checked = invariants.filter((i) => i.checked).length;
  if (violations.length === 0) {
    return `This edit kept every one of the project's ${invariants.length} observed architecture rule(s) (${checked} of them machine-checked).`;
  }
  return `This edit broke ${violations.length} of the project's own architecture rule(s): `
    + violations.map((v) => `${v.file} — ${v.detail}`).join('; ');
}

/**
 * WHAT IS THIS FILE? — a one-line answer for every file the build writes (admin 2026-08-10).
 *
 * THE ASK: "jab NavBharatAI koi app banata hai, ek saath bahut sari file bana deta hai — background me
 * sab aise hi chale, frontend par user ko ek ek file dikhe narration ke saath."
 *
 * Half of that already shipped: `revealPacer` (2026-07-21) drips the real file events into the feed one
 * at a time, so a 44-file burst reads as 44 arrivals instead of one flash. What was missing is the
 * NARRATION — a row that says `LoginForm.tsx · new` tells a non-technical user nothing about what just
 * got built for them.
 *
 * 🔒 DERIVED, NEVER GENERATED. This is a pure function of the PATH — no model call, no token, no
 * latency, and nothing to get wrong at build time. Three reasons that matters more than it sounds:
 *   • A per-file LLM description would cost a call PER FILE — 44 extra calls on a normal build, on the
 *     one path where the user is already waiting.
 *   • A generated description can be WRONG, and a confident wrong label on a file the user cannot read
 *     is worse than no label (second absolute rule: honest state, never a plausible-looking one).
 *   • It must work identically when the feed is replayed from history, where no model is running.
 *
 * ⚠️ IT DESCRIBES THE ROLE, NOT THE CONTENT. The row already shows the file NAME, so this adds the one
 * thing the name does not carry: what kind of thing it is. `LoginForm.tsx` → "screen part". Claiming
 * more than the path can prove — "handles login with OTP" — would be fabrication.
 *
 * Returns `null` for a path with no confident role. A missing label is honest; a guessed one is not,
 * and the UI simply shows the filename as it does today.
 */

/** The roles a path can be recognised as. `null` (no role) is a normal, expected outcome. */
export type FileRole =
  | 'deps' | 'config' | 'env' | 'schema' | 'migration' | 'seed'
  | 'entry' | 'page' | 'route' | 'layout' | 'component' | 'hook' | 'store' | 'context'
  | 'api' | 'server' | 'service' | 'model' | 'middleware' | 'auth'
  | 'style' | 'asset' | 'type' | 'util' | 'test' | 'doc' | 'ci' | 'container';

const base = (p: string): string => (p || '').split('/').pop() || '';
const lower = (p: string): string => (p || '').toLowerCase();

/**
 * The role of one file. Ordered most-specific first: an exact well-known FILENAME beats a directory
 * convention, which beats an extension — otherwise `prisma/schema.prisma` would read as "config" and
 * `src/pages/api/orders.ts` (a Next.js API route) as "page".
 */
export function fileRole(path: string | null | undefined): FileRole | null {
  const p = lower(String(path ?? '').replace(/^\.\//, ''));
  if (!p) return null;
  const b = base(p);

  // 1) Exact filenames — unambiguous, and several would be mis-read by any later rule.
  if (b === 'package.json' || b === 'package-lock.json' || b === 'requirements.txt' || b === 'go.mod' || b === 'pom.xml' || b === 'pubspec.yaml' || b === 'gemfile') return 'deps';
  if (b === 'dockerfile' || b.startsWith('docker-compose')) return 'container';
  if (b === '.env' || b.startsWith('.env.')) return 'env';
  if (b === 'readme.md') return 'doc';
  if (b === 'index.html') return 'entry';
  if (b === 'schema.prisma') return 'schema';

  // 2) A test is a test wherever it lives. This runs BEFORE the directory rules because generated
  //    apps put `Login.test.tsx` NEXT TO `Login.tsx` inside `components/`, and the directory rule
  //    would otherwise claim it as a component — a wrong label on a file the user cannot read.
  if (/\.(test|spec)\.[jt]sx?$/.test(b) || /(^|\/)(tests?|__tests__|e2e|cypress)\//.test(p)) return 'test';

  // 2) Directory conventions — the strongest signal in a generated app, and the reason a Next.js
  //    `pages/api/*` file must be read as an API before the `pages/` rule can claim it.
  if (/(^|\/)(\.github\/workflows|\.gitlab-ci)/.test(p)) return 'ci';
  if (/(^|\/)(migrations?|prisma\/migrations)\//.test(p)) return 'migration';
  if (/(^|\/)seeds?\//.test(p) || /\bseed\b/.test(b)) return 'seed';
  if (/(^|\/)(pages\/api|app\/api|api)\//.test(p)) return 'api';
  if (/(^|\/)(routes?|controllers?)\//.test(p)) return 'route';
  if (/(^|\/)middleware/.test(p)) return 'middleware';
  if (/(^|\/)(services?|lib\/services?)\//.test(p)) return 'service';
  if (/(^|\/)(models?|entities|schemas?)\//.test(p)) return 'model';
  if (/(^|\/)(hooks?)\//.test(p) || /^use[A-Z_]/.test(base(String(path ?? '')))) return 'hook';
  if (/(^|\/)(stores?|state|redux|slices?)\//.test(p)) return 'store';
  if (/(^|\/)(contexts?|providers?)\//.test(p)) return 'context';
  if (/(^|\/)(pages|views|screens)\//.test(p)) return 'page';
  if (/(^|\/)(components?|widgets?|ui)\//.test(p)) return 'component';
  if (/(^|\/)(utils?|helpers?|lib)\//.test(p)) return 'util';
  if (/(^|\/)(public|assets?|static|images?|icons?|fonts?)\//.test(p)) return 'asset';
  if (/(^|\/)(docs?)\//.test(p)) return 'doc';

  // 3) Name shapes that are conventions in their own right.
  if (/^(main|index|app|server)\.[jt]sx?$/.test(b) || b === 'main.py' || b === 'app.py' || b === 'manage.py') return 'entry';
  if (/^(layout|_app|_document)\.[jt]sx?$/.test(b)) return 'layout';
  if (/\b(auth|login|signup|session)\b/.test(b)) return 'auth';

  // 4) Extensions — the weakest signal, so it runs last.
  if (/\.(css|scss|sass|less|styl)$/.test(b)) return 'style';
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|mp4|mp3)$/.test(b)) return 'asset';
  if (/\.d\.ts$/.test(b) || b === 'types.ts' || b === 'types.d.ts') return 'type';
  if (/\.(md|mdx|txt)$/.test(b)) return 'doc';
  if (/\.(ya?ml|toml|ini|conf)$/.test(b) || /\.config\.[jt]s$/.test(b) || /^(vite|next|nuxt|tailwind|postcss|eslint|tsconfig|babel|jest|vitest|svelte|astro)\b/.test(b)) return 'config';
  if (/\.(sql)$/.test(b)) return 'schema';

  return null; // honest: this path does not tell us what it is
}

/**
 * Short, plain-language labels — in PROFESSIONAL ENGLISH, like every other piece of NavBharatAI's own
 * text (CLAUDE.md's Language standard; admin re-stated 2026-08-11).
 *
 * ⚠️ THESE ARE DELIBERATELY NOT TRANSLATED, and an earlier version of this file got that wrong. The
 * platform speaks English; only an AI RESPONSE follows the user's language. A file label is the app
 * talking, not the AI, so a Hindi label here would be the app speaking the wrong language — and it
 * would have needed 22 hand-written translations per label to be fair to every Indian user, which is
 * exactly the unmaintainable path the rule avoids.
 *
 * Written for a NON-technical reader — what the file DOES for the app, not what a framework calls it.
 */
const LABELS: Record<FileRole, string> = {
  deps: 'the app\'s package list',
  config: 'setup / configuration',
  env: 'environment settings',
  schema: 'database structure',
  migration: 'database update step',
  seed: 'starter data',
  entry: 'where the app starts',
  page: 'a screen',
  route: 'a server route',
  layout: 'the page frame',
  component: 'a part of a screen',
  hook: 'shared screen logic',
  store: 'app data store',
  context: 'shared app state',
  api: 'an API endpoint',
  server: 'server code',
  service: 'business logic',
  model: 'a data model',
  middleware: 'request checks',
  auth: 'login & accounts',
  style: 'look & styling',
  asset: 'image / font',
  type: 'type definitions',
  util: 'helper code',
  test: 'a test',
  doc: 'documentation',
  ci: 'build automation',
  container: 'deployment setup',
};

/**
 * The one-line label for a path, or `null` when the path does not confidently say what it is.
 *
 * `null` is a first-class answer, not a failure: the UI keeps showing the filename exactly as it does
 * today. A guessed label on a file the user cannot read would be worse than none.
 */
export function describeFile(path: string | null | undefined): string | null {
  const role = fileRole(path);
  return role ? LABELS[role] : null;
}

/** Exposed so a test can prove every role has a label. */
export const _labels = LABELS;

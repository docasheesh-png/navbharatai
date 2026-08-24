// WHICH OF THE 24 FRAMEWORKS CAN ACTUALLY BECOME AN APK — measured, not assumed.
//
// 🔒 WHY THIS EXISTS (admin 2026-08-24: "v5 ko aisa banao ki woh sabhi framework me app bana sake, aur
// app banne ke bad sabhi framework app ki apk file bana de … 24 bar apko individually test karna
// hoga"). Every row below was produced by scaffolding that framework from our own TemplateRegistry,
// running a real `npm install` and `npm run build`, and looking at what landed on disk — not by
// reading docs and not from memory.
//
// 🔒 THE HONEST HEADLINE, WHICH THE ADMIN NEEDS BEFORE ANY CODE: **"an APK for all 24" is not
// physically possible, and promising it would be the fake success rule 2 forbids.** Capacitor wraps a
// WEB APP — it needs a folder of HTML/CSS/JS to show. Nine of the twenty-four are backend frameworks
// (Express, Hono, NestJS, Fastify, FastAPI, Flask, Spring Boot, Go, Django) that have no screens at
// all: they answer with JSON. An APK built from one of those installs, opens, and shows a blank page
// or raw JSON. It would "work" in the sense that a file was produced, and be useless in every sense
// that matters to whoever installed it.
//
// So the goal this module actually serves is the one worth having: **every framework that HAS a user
// interface produces a working APK, and every framework that does not says so plainly, with the
// reason** — instead of shipping a broken shell and letting the user discover it on their phone.
//
// 🔒 THE SECOND FINDING, AND THE ONE THAT WAS SILENTLY BREAKING REAL APKs. `detectWebDir` in
// mobileProjectAssembler knew exactly three answers — Vite → `dist`, Next → `out`, CRA → `build` — and
// fell back to `dist` for everything else. Four UI frameworks put their build somewhere else entirely:
//
//     Angular    → dist/app/browser   (the `application` builder nests the browser bundle)
//     SvelteKit  → build              (adapter-static)
//     Nuxt       → .output/public     (nuxt generate)
//     Remix      → build/client
//
// For all four, Capacitor was pointed at a folder that does not exist. The APK either failed to
// assemble or shipped empty — and nothing said why, because a wrong guess looks exactly like a right
// one until someone opens the app.

import { planDeployment } from '../AgentV3/deployPlan';

export type ApkCapability =
  /** Its normal build already emits a static site. Nothing to configure. */
  | 'ready'
  /** It CAN emit a static site, but the project must be switched to static output first. */
  | 'needs-static-export'
  /** It has no user interface at all, so there is nothing for an app to show. */
  | 'no-ui';

export interface FrameworkCapability {
  /** The picker id, matching FRAMEWORK_OPTIONS. */
  id: string;
  /** Can this become an installable app, and on what condition? */
  apk: ApkCapability;
  /**
   * Where a successful STATIC build lands, relative to the project root. '' when there is none.
   * These are observed values — see the module header.
   */
  webDir: string;
  /** The command that produces that folder, when it differs from `npm run build`. */
  staticBuildCommand?: string;
  /** For 'needs-static-export': the exact change required, in the user's terms. */
  staticExportHint?: string;
}

/**
 * The measured table. Ordered as the picker orders them so the two can be read side by side.
 *
 * ⚠️ A framework MISSING from this table is not an error — `frameworkCapability` returns a
 * conservative 'ready'/'dist' for anything it does not know, which is exactly today's behaviour. This
 * table only ever makes the answer BETTER, never introduces a new way to fail.
 */
export const FRAMEWORK_CAPABILITIES: readonly FrameworkCapability[] = [
  // ── Builds a static site out of the box. Verified: build ran, index.html landed in webDir. ──
  { id: 'vite-react', apk: 'ready', webDir: 'dist' },
  { id: 'vue', apk: 'ready', webDir: 'dist' },
  { id: 'svelte', apk: 'ready', webDir: 'dist' },
  { id: 'solid', apk: 'ready', webDir: 'dist' },
  { id: 'preact', apk: 'ready', webDir: 'dist' },
  { id: 'lit', apk: 'ready', webDir: 'dist' },
  { id: 'alpine', apk: 'ready', webDir: 'dist' },
  { id: 'vanilla', apk: 'ready', webDir: 'dist' },
  { id: 'astro', apk: 'ready', webDir: 'dist' },
  // Angular's `application` builder nests the browser bundle one level deeper than its outputPath.
  // This is the single most misleading of the four: `dist/` DOES exist, so a wrong guess finds a real
  // folder — one holding server bundles and stats, with no index.html in it.
  { id: 'angular', apk: 'ready', webDir: 'dist/app/browser' },
  // No build step at all; the files ARE the site. The assembler copies them into `www`.
  { id: 'static', apk: 'ready', webDir: 'www' },

  // ── Server frameworks that CAN be built as a static site, with one deliberate change. ──
  {
    id: 'nextjs',
    apk: 'needs-static-export',
    webDir: 'out',
    staticExportHint: "add `output: 'export'` to next.config — after that `next build` writes a "
      + 'complete site to `out/`. Server-only features (API routes, server actions, image optimisation) '
      + 'cannot come with it, because there is no server inside a phone app.',
  },
  {
    id: 'nuxt',
    apk: 'needs-static-export',
    webDir: '.output/public',
    staticBuildCommand: 'npm run generate',
    staticExportHint: 'build with `nuxt generate` instead of `nuxt build` — it writes a complete site '
      + 'to `.output/public`, while `nuxt build` produces a server that a phone app cannot run.',
  },
  {
    id: 'sveltekit',
    apk: 'needs-static-export',
    webDir: 'build',
    staticExportHint: 'swap `@sveltejs/adapter-node` for `@sveltejs/adapter-static` in svelte.config.js '
      + '— the node adapter builds a server, which a phone app has nowhere to run.',
  },
  {
    id: 'remix',
    apk: 'needs-static-export',
    webDir: 'build/client',
    staticExportHint: 'turn on Remix SPA mode (`ssr: false` in vite.config) — a default Remix build '
      + 'renders every page on a server, so `build/client` holds JavaScript but no page to open.',
  },

  // ── No user interface. An APK here would install and show nothing. ──
  { id: 'node-express', apk: 'no-ui', webDir: '' },
  { id: 'hono', apk: 'no-ui', webDir: '' },
  { id: 'nestjs', apk: 'no-ui', webDir: '' },
  { id: 'fastify', apk: 'no-ui', webDir: '' },
  { id: 'python-fastapi', apk: 'no-ui', webDir: '' },
  { id: 'flask', apk: 'no-ui', webDir: '' },
  { id: 'spring-boot', apk: 'no-ui', webDir: '' },
  { id: 'go', apk: 'no-ui', webDir: '' },
  // Django renders HTML, but from a running Python server per request — there is no static site to
  // package, and no Python runtime inside an Android app to produce one.
  { id: 'django', apk: 'no-ui', webDir: '' },
];

const BY_ID = new Map(FRAMEWORK_CAPABILITIES.map((c) => [c.id, c]));

/**
 * What we know about one framework.
 *
 * 🔒 AN UNKNOWN ID IS 'ready'/'dist', DELIBERATELY. That is precisely the behaviour every caller had
 * before this table existed, so adding it can only improve an answer and never break one — and an app
 * whose framework we cannot name is far more likely to be an ordinary Vite-style project than a
 * headless API. Guessing 'no-ui' would refuse to build APKs for working apps, which is the worse
 * error by a distance. PURE.
 */
export function frameworkCapability(id: string | null | undefined): FrameworkCapability {
  const key = String(id ?? '').trim().toLowerCase();
  return BY_ID.get(key) ?? { id: key, apk: 'ready', webDir: 'dist' };
}

/**
 * The honest sentence for a framework that cannot become an app right now, or '' when it can.
 *
 * Never blames the user: choosing a backend framework is a correct thing to do, it simply is not a
 * thing with screens. And it always names what they CAN do — a refusal without a next step is the
 * dead end this codebase keeps deleting.
 */
export function apkRefusal(cap: FrameworkCapability, frameworkName: string): string {
  if (cap.apk === 'ready') return '';
  if (cap.apk === 'no-ui') {
    return `${frameworkName} builds a server that answers requests — it has no screens, so there is `
      + 'nothing for a phone app to show. An app made from this would install and open to a blank '
      + 'page. Deploy it as a backend instead, and make the app from the front-end project that talks '
      + 'to it.';
  }
  return `${frameworkName} apps are rendered by a server by default, and a phone app has no server `
    + `inside it. To package this one: ${cap.staticExportHint}`;
}

/**
 * Every framework that can produce an installable app today, for the UI to offer honestly. Kept as a
 * derived value rather than a second hand-written list — two lists drift, one cannot.
 */
export function apkCapableFrameworkIds(): string[] {
  return FRAMEWORK_CAPABILITIES.filter((c) => c.apk !== 'no-ui').map((c) => c.id);
}

/**
 * Does this PROJECT have anything an app could show? Asked of the real files, not of a stored id.
 *
 * 🔒 THE FILES ARE THE AUTHORITY, and deliberately so. A framework id is what the user picked once,
 * possibly weeks ago; the files are what they have now. An app that began as an Express API and grew
 * a React front end must be packageable, and one scaffolded from a UI template whose screens were all
 * deleted must not be — neither of which an id can tell you.
 *
 * 🔒 IT REUSES `planDeployment` RATHER THAN CLASSIFYING AGAIN. That module already answers "what shape
 * is this app" for the publish path, from the same manifests, and it is already tested and measured. A
 * second classifier here would be the duplicated-then-drifted logic rule 4 exists to prevent — and the
 * drift would show up as the two features disagreeing about the same app.
 *
 * Returns '' — meaning "go ahead" — unless the project is POSITIVELY a server with no screens. Every
 * uncertain case builds, exactly as it does today: refusing a working app is far worse than packaging
 * an odd one.
 */
export function apkRefusalForProject(files: Record<string, string>): string {
  const all = files ?? {};
  const paths = Object.keys(all);
  // Any real screen at all ⇒ there is something to show. Checked FIRST, so a fullstack app that
  // genuinely has a front end is never refused on the strength of its server half.
  const hasUi = paths.some((p) => /(^|\/)index\.html$/i.test(p) || /\.(tsx|jsx|vue|svelte|astro)$/i.test(p));
  if (hasUi) return '';
  const shape = planDeployment(all).shape;
  if (shape !== 'node-server' && shape !== 'python-server') return '';
  return 'This project is a server that answers requests — it has no screens, so there is nothing for '
    + 'a phone app to show. An app built from it would install and open to a blank page. Deploy it as '
    + 'a backend instead, and make the app from the front-end project that talks to it.';
}

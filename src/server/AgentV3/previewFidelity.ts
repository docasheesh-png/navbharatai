// WHERE THE IN-BROWSER PREVIEW IS NOT THE REAL APP — said out loud, instead of left to be discovered.
//
// WHY (gap analysis 2026-09-10). The in-browser preview is not a dev server: it is a Babel-in-the-page
// mini-bundler (src/lib/previewUtils.ts) that resolves imports itself and pulls dependencies from a
// CDN. That is what makes it free, instant and still there days after the sandbox is gone — a genuine
// advantage no competitor has. But a handful of ordinary build features have no equivalent in it, and
// when one is used the preview renders something that is NOT what the app really looks like.
//
// The toolbar said only "In-browser preview (react)". So a user whose SCSS did not load, or whose
// CSS-module class names came out undefined, or whose custom Tailwind colours silently fell back to
// the defaults, had no way to know whether their app was broken or the preview was approximate — and
// the honest answer, which we knew and did not say, was the second.
//
// 🔒 THE RULE THIS MODULE FOLLOWS: report ONLY what is genuinely unsupported and genuinely present in
// this workspace's files. A false caveat is worse than none — it teaches the user to distrust a
// preview that was in fact accurate, and sends them to the paid Live server for nothing.

export interface PreviewFidelityCaveat {
  /** Stable id, so the panel can style or suppress one without matching on prose. */
  id: 'css-modules' | 'css-preprocessor' | 'web-worker' | 'vite-glob' | 'tailwind-config' | 'public-assets';
  /** One plain sentence, in the user's terms — never a build-tool lecture. */
  text: string;
}

const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs)$/i;

/** Files whose CONTENT is worth scanning — never node_modules, never the megabyte lock files. */
function codeFiles(files: Record<string, string>): string[] {
  return Object.keys(files).filter((p) => SOURCE_RE.test(p) && !p.includes('node_modules'));
}

/**
 * What this workspace uses that the in-browser preview cannot reproduce.
 *
 * PURE and allocation-light: it reads the file map it is handed and nothing else, so it can run on
 * every preview build without being a cost.
 */
export function previewFidelityCaveats(files: Record<string, string>): PreviewFidelityCaveat[] {
  const out: PreviewFidelityCaveat[] = [];
  const paths = Object.keys(files || {}).filter((p) => !p.includes('node_modules'));
  const code = codeFiles(files || {});
  const bodyOf = (p: string) => (typeof files[p] === 'string' ? files[p] : '');

  // 1. CSS MODULES. The mini-bundler injects a .css file's text and returns an EMPTY exports object,
  //    so `styles.card` is undefined and every class name on the page comes out blank. The layout
  //    collapses, which reads exactly like a broken app.
  if (paths.some((p) => /\.module\.(css|scss|sass|less)$/i.test(p))
    || code.some((p) => /import\s+\w+\s+from\s+['"][^'"]+\.module\.(css|scss|sass|less)['"]/.test(bodyOf(p)))) {
    out.push({ id: 'css-modules', text: 'CSS Modules — class names come out blank here, so the layout will look wrong. It is correct on the live server.' });
  }

  // 2. SCSS / SASS / LESS. Not in the resolver's extension list and not compiled anywhere in the page,
  //    so the import fails outright and takes the render with it.
  if (paths.some((p) => /\.(scss|sass|less|styl)$/i.test(p))) {
    out.push({ id: 'css-preprocessor', text: 'Sass/SCSS or Less styles are not compiled here — this preview shows the app without them.' });
  }

  // 3. WEB WORKERS. `new Worker(new URL('./x', import.meta.url))` needs a real served file; the page
  //    has only an in-memory file map, so the worker never starts and whatever it powers does nothing.
  if (code.some((p) => /new\s+Worker\s*\(/.test(bodyOf(p)))) {
    out.push({ id: 'web-worker', text: 'Background workers do not run here, so anything they power will look inactive.' });
  }

  // 4. import.meta.glob — a Vite-only API. `import.meta` is rewritten to a plain object in the page, so
  //    `.glob` is undefined and the module throws on load.
  if (code.some((p) => /import\.meta\.glob\b/.test(bodyOf(p)))) {
    out.push({ id: 'vite-glob', text: 'This app loads files in bulk the way Vite does, which only works on the live server.' });
  }

  // 5. A CUSTOMISED TAILWIND THEME. The in-page Tailwind compiler cannot read tailwind.config, so a
  //    custom palette, font or spacing scale silently falls back to Tailwind's defaults — the app
  //    renders, and simply is not the right colours. (A config with no `theme.extend` customisation
  //    changes nothing, so it is not worth a caveat.)
  const tw = paths.find((p) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(p));
  if (tw && /theme\s*:\s*\{[\s\S]*extend\s*:\s*\{\s*[^}\s]/.test(bodyOf(tw))) {
    out.push({ id: 'tailwind-config', text: 'Your custom Tailwind colours and fonts are not applied here — the live server shows the real ones.' });
  }

  // 6. FILES FROM public/. A dev server serves them at the site root; this page has no server, so a
  //    logo or a font referenced as "/logo.png" simply does not appear.
  if (paths.some((p) => /^public\//i.test(p) && !/\.html?$/i.test(p))) {
    out.push({ id: 'public-assets', text: 'Images and files kept in your public folder are not served here, so some may be missing.' });
  }

  return out;
}

/**
 * One line for the panel, or '' when the preview is genuinely faithful.
 *
 * Deliberately ONE sentence with a count rather than a list of six: a wall of caveats above a working
 * app reads as "this is broken", which is the opposite of the truth being conveyed.
 */
export function previewFidelityNotice(caveats: PreviewFidelityCaveat[]): string {
  if (!caveats.length) return '';
  if (caveats.length === 1) return caveats[0].text;
  return `${caveats[0].text} (and ${caveats.length - 1} other ${caveats.length === 2 ? 'difference' : 'differences'} from the live server)`;
}

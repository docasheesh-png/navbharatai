// P-PIPE.84 — PWA / installability advisory (opt-in by intent).
//
// A build-report dimension that reports PWA readiness — but ONLY for an app that shows PWA INTENT
// (a manifest, a service worker, PWA meta tags, or a PWA build plugin). If there is zero PWA intent,
// the whole line is OMITTED (assessed:false) — most generated apps are not PWAs, so nagging "no
// manifest" on every build would be noise. When there IS intent, it flags the concrete missing piece
// (linked-but-no-file, file-but-not-linked, installable-but-no-offline, SW-but-no-manifest). It never
// re-checks favicons/apple-touch-icons (SEO owns those) and never deep-validates manifest fields.
//
// Pure, never throws. Advisory only — never a readiness blocker. Same pure-logic + thin-caller split
// as the SEO/design linters.

export interface PwaFinding {
  level: 'medium' | 'low';
  message: string;
}

export interface PwaReport {
  /** false = no PWA intent at all → the caller OMITS the line entirely (no noise on non-PWA apps). */
  assessed: boolean;
  /** true = a manifest + service worker (or a PWA build plugin) are present — nothing to nag. */
  complete: boolean;
  findings: PwaFinding[];
}

/** npm packages that generate a manifest + service worker at build time → treat PWA setup as complete. */
const PWA_PLUGINS = ['vite-plugin-pwa', '@vite-pwa/nuxt', '@vite-pwa/sveltekit', 'next-pwa', '@ducanh2912/next-pwa', 'workbox-webpack-plugin'];

export function analyzePwa(
  sources: ReadonlyArray<{ path: string; content: string }>,
  files: readonly string[],
  dependencies: readonly string[] = [],
): PwaReport {
  const allCode = sources.map((s) => s.content).join('\n');
  const fileSet = files.map((f) => f.toLowerCase());

  const hasPlugin = dependencies.some((d) => PWA_PLUGINS.includes(d));
  const hasManifestLink = /<link[^>]+rel\s*=\s*["']?manifest/i.test(allCode);
  // The `.webmanifest` EXTENSION is what's standardized, not the stem — favicon generators and most
  // hand-written PWAs ship `site.webmanifest` / `app.webmanifest`, not `manifest.webmanifest`. Match
  // ANY stem for `.webmanifest`; keep the conventional `manifest.json` for the generic `.json`
  // extension so an unrelated `data.json` can't be mistaken for the manifest. (Without this, a real
  // `site.webmanifest` was missed → a FALSE "the link will 404" finding on a perfectly valid PWA.)
  const hasManifestFile = fileSet.some((f) => /(^|\/)(?:[\w.-]+\.webmanifest|manifest\.json)$/.test(f));
  const hasSwFile = fileSet.some((f) => /(^|\/)(sw|service-worker)\.(js|ts)$/.test(f));
  const registersSw = /navigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/.test(allCode);
  const hasServiceWorker = hasSwFile || registersSw;
  const hasPwaMeta = /(apple-mobile-web-app-capable|mobile-web-app-capable|name\s*=\s*["']theme-color)/i.test(allCode);

  const intent = hasPlugin || hasManifestLink || hasManifestFile || hasServiceWorker || hasPwaMeta;
  if (!intent) return { assessed: false, complete: false, findings: [] };

  // A build-time PWA plugin generates the manifest + SW — don't nag about missing static files.
  if (hasPlugin) return { assessed: true, complete: true, findings: [] };

  const findings: PwaFinding[] = [];
  const hasManifest = hasManifestLink || hasManifestFile;
  if (hasManifestLink && !hasManifestFile) {
    findings.push({ level: 'medium', message: 'A <link rel="manifest"> is present but no manifest.json/.webmanifest file was found — the link will 404.' });
  }
  if (hasManifestFile && !hasManifestLink) {
    findings.push({ level: 'medium', message: 'A web app manifest file exists but is not linked from the HTML (<link rel="manifest" href="…">) — browsers won\'t discover it.' });
  }
  if (hasManifest && !hasServiceWorker) {
    findings.push({ level: 'low', message: 'A manifest is present but no service worker — the app can be installed but has no offline support.' });
  }
  if (hasServiceWorker && !hasManifest) {
    findings.push({ level: 'low', message: 'A service worker is present but no web app manifest — the app can\'t be added to the home screen.' });
  }

  return { assessed: true, complete: findings.length === 0, findings };
}

/** One advisory report line, or '' when there's no PWA intent (the line is then omitted). Pure. */
export function pwaSummary(report: PwaReport): string {
  if (!report.assessed) return '';
  if (report.complete) return 'PWA/installability: ✓ manifest + service worker present — the app is installable.';
  const order: Record<PwaFinding['level'], number> = { medium: 0, low: 1 };
  const sorted = [...report.findings].sort((a, b) => order[a.level] - order[b.level]);
  return [`PWA/installability — ${report.findings.length} item(s):`, ...sorted.map((f) => `  ⚠ ${f.message}`)].join('\n');
}

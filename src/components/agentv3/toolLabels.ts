// WHAT THE LIVE STRIP SAYS — in words the person who asked for the app can read.
//
// 🔴 WHY (admin, 2026-09-20): of the three things a Pro reply contains, they kept the live events
// ("yeh theek hai") and asked for the noise around them to go. But the events themselves still read
// `writing src/components/InvoiceForm.tsx` and `running: npm install --no-audit --no-fund`, which is
// a developer's sentence shown to a shopkeeper on a phone. NavBharatAI's user has no other window
// onto the build; this strip is the whole story they get.
//
// 🔒 THE RULE THAT KEEPS THIS HONEST: nothing here invents a name. Every label is derived from the
// path or command the engine really used — the directory noise is dropped and a PascalCase file name
// is spaced out, and that is all. A command is renamed ONLY when it is recognised exactly; anything
// else is shown as it was typed (shortened), because "running a command" would hide a real fact and
// a guessed name would state a false one.
//
// ⚠️ DO NOT "improve" this by translating identifiers. `useInvoices` stays `useInvoices`: it is a real
// name the user may meet again in Code Studio, and turning it into "Use invoices" would be a worse
// sentence AND a different word from the one in their project. Only PascalCase — the convention this
// engine uses for a SCREEN or a COMPONENT, i.e. a thing the user can actually see — is spaced.

/** Extensions dropped from a displayed file name. */
const DROPPED_EXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|html?|json|md|svg|png|jpe?g|webp|ya?ml|txt)$/i;

/** Words that read badly when title-cased from an identifier. Kept short and literal on purpose. */
const ACRONYMS: Readonly<Record<string, string>> = {
  api: 'API', ui: 'UI', id: 'ID', url: 'URL', pdf: 'PDF', csv: 'CSV',
  sql: 'SQL', http: 'HTTP', gst: 'GST', otp: 'OTP', qr: 'QR', sms: 'SMS',
};

/** Files whose name says nothing useful, mapped to what they ARE. */
const WELL_KNOWN: Readonly<Record<string, string>> = {
  'package.json': 'project setup',
  'package-lock.json': 'project setup',
  'tsconfig.json': 'project setup',
  'vite.config': 'project setup',
  'tailwind.config': 'styling setup',
  'index.css': 'styles',
  'app.css': 'styles',
  'index.html': 'the page',
  'readme.md': 'the notes',
};

function titleCaseWord(w: string, first: boolean): string {
  const lower = w.toLowerCase();
  if (ACRONYMS[lower]) return ACRONYMS[lower];
  if (first) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return lower;
}

/** `InvoiceForm` → `Invoice form`. Only applied to PascalCase names (a screen or a component). */
function spacePascalCase(name: string): string {
  const parts = name.replace(/[-_]+/g, ' ').split(/(?=[A-Z])/).join(' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  return parts.map((p, i) => titleCaseWord(p, i === 0)).join(' ');
}

/**
 * The name of a file as a person would say it. PURE and total.
 *
 * Returns the ORIGINAL string when it cannot do better — an empty result would be a label that says
 * nothing, which is worse than a path.
 */
export function plainFileName(path: string): string {
  const raw = typeof path === 'string' ? path.trim() : '';
  if (!raw) return '';

  const clean = raw.replace(/\\/g, '/').replace(/^\.?\/+/, '').split(/[?#]/)[0];
  const segments = clean.split('/').filter(Boolean);
  let base = segments[segments.length - 1] ?? '';
  if (!base) return raw;

  const known = WELL_KNOWN[base.toLowerCase()] ?? WELL_KNOWN[base.toLowerCase().replace(DROPPED_EXT, '')];
  if (known) return known;

  // `src/pages/invoices/index.tsx` is named by its FOLDER — "index" names nothing.
  const stem = base.replace(DROPPED_EXT, '');
  if (/^(index|main)$/i.test(stem) && segments.length > 1) {
    base = segments[segments.length - 2];
  } else {
    base = stem;
  }
  if (!base) return raw;

  if (/^App$/.test(base)) return 'the app';
  // PascalCase ⇒ a screen or component ⇒ spaced. Everything else is left exactly as written.
  if (/^[A-Z][A-Za-z0-9]*$/.test(base)) return spacePascalCase(base);
  return base;
}

/** A shell command, capped so one long install line cannot take the whole strip. */
const MAX_COMMAND_CHARS = 48;

/**
 * Commands renamed to what they DO. Prefix-matched, longest first, and deliberately short: a command
 * that is not on this list is shown as it was typed rather than described by a guess.
 */
const COMMAND_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['npm run build', 'building the app'],
  ['npm run dev', 'starting the preview'],
  ['npm run test', 'running the tests'],
  ['npm run lint', 'checking the code'],
  ['npm install', 'installing packages'],
  ['npm ci', 'installing packages'],
  ['npx tsc', 'checking the code'],
  ['tsc ', 'checking the code'],
  ['npx vitest', 'running the tests'],
  ['git init', 'setting up version history'],
  ['git commit', 'saving a checkpoint'],
];

export function plainCommand(command: string): string {
  const raw = typeof command === 'string' ? command.trim() : '';
  if (!raw) return 'a command';
  const lower = raw.toLowerCase();
  for (const [prefix, name] of COMMAND_NAMES) {
    if (lower.startsWith(prefix)) return name;
  }
  return raw.length > MAX_COMMAND_CHARS ? `${raw.slice(0, MAX_COMMAND_CHARS - 1)}…` : raw;
}

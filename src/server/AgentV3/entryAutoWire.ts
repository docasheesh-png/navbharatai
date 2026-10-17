/**
 * 🔴 THE PREVIEW SHOWED "HELLO WORLD" FOR 5.6 MINUTES WHILE THE SCREENS SAT ON DISK (autopsy ca99778e, 2026-10-17).
 *
 * Weak tier, "mock test app … UP Police". The frontend sub-agent wrote the data, the types, a theme hook, Home.tsx
 * and Test.tsx. It was told, in the tool result of its first leaf write, "write src/App.tsx NEXT — the preview still
 * shows the starter" (`entryFirstWriteNote`, autopsy 39e982bd), and before that the prompt said the same
 * (`shellEarlyRule`). It wrote the next leaf anyway. The user watched the starter page until they pressed Stop.
 *
 * 🔑 THE CLASS: a rule whose only enforcement is words. Three autopsies (68f0a486, 39e982bd, ca99778e) added a
 * louder sentence each time and the leaves-first habit won each time. The fact the user needs — "my screens are
 * visible" — does not depend on the model at all: the screens are on disk, they export components, and the entry
 * is still OUR starter. So the PLATFORM wires them: a provisional src/App.tsx that renders every zero-prop screen
 * written so far behind a simple tab bar, rewritten as more screens land, and left alone the moment anybody else
 * writes the entry. The model's own App.tsx always wins; this only ever replaces our "Hello World".
 *
 * 🔒 NEVER OVER ANYBODY'S WORK: written only while the entry is byte-for-byte our starter or our own last shell
 * (`entryIsStillTheStarter` / `isAutoWiredEntry`). A screen that needs props is not mounted (it would crash without
 * them); a `…Provider` that takes only children wraps the tabs. Kill switch `AGENTV3_ENTRY_AUTOWIRE=off`. PURE.
 */
import { isUiComponentPath } from './earlyPreview';

export function entryAutoWireEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_ENTRY_AUTOWIRE ?? '').trim().toLowerCase() !== 'off';
}

/** The marker the shell carries — how the platform knows the entry is still its own and may be rewritten. */
export const AUTO_WIRED_MARK = 'navbharatai:auto-wired-entry';

export function isAutoWiredEntry(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.includes(AUTO_WIRED_MARK);
}

const SCREEN_DIR = /^src\/(?:.*\/)?(?:pages|screens|views|routes)\/[^/]+\.(?:tsx|jsx)$/;
const SCREEN_SUFFIX = /(?:Page|Screen|View)$/;
const SCREEN_NAMES = new Set([
  'home', 'dashboard', 'landing', 'test', 'quiz', 'exam', 'practice', 'result', 'results', 'review', 'history',
  'profile', 'settings', 'login', 'signup', 'about', 'leaderboard', 'library', 'browse', 'search', 'cart', 'checkout',
  'menu', 'orders', 'game', 'play', 'editor', 'notes', 'tasks', 'calendar', 'reports', 'analytics', 'admin',
]);

/** Is this written file a SCREEN (a page the user navigates to), not a widget, hook or provider? PURE. */
export function isScreenPath(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\//, '');
  if (!isUiComponentPath(p)) return false;
  const base = p.replace(/^.*\//, '').replace(/\.(?:tsx|jsx)$/, '');
  if (/^use[A-Z]/.test(base) || /(?:Provider|Context|Theme|Icon|Icons|Button|Card|Modal|Layout|Header|Footer|Nav|Navbar|Sidebar)$/.test(base)) return false;
  if (/^src\/(?:.*\/)?(?:components\/ui|hooks|lib|utils|context|contexts|theme|styles|data|types)\//.test(p)) return false;
  return SCREEN_DIR.test(p) || SCREEN_SUFFIX.test(base) || SCREEN_NAMES.has(base.toLowerCase());
}

export interface WiredExport { path: string; name: string; kind: 'default' | 'named' }

const IDENT = '[A-Z][A-Za-z0-9_]*';

/**
 * The component a screen file exports that can be mounted with NO props, or null. A component whose parameter list
 * is not empty needs something we cannot invent, so it is not mounted. PURE.
 */
export function zeroPropExport(path: string, content: string): WiredExport | null {
  const src = String(content ?? '');
  const base = String(path).replace(/^.*\//, '').replace(/\.(?:tsx|jsx)$/, '');
  const zeroFn = (name: string): boolean =>
    new RegExp(`function\\s+${name}\\s*\\(\\s*\\)`).test(src)
    || new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:React\\.memo\\()?\\s*\\(\\s*\\)\\s*(?::[^=]+)?=>`).test(src);
  // export default function Name() / export default function () {}
  let m = src.match(new RegExp(`export\\s+default\\s+function\\s+(${IDENT})\\s*\\(\\s*\\)`));
  if (m) return { path, name: m[1], kind: 'default' };
  if (/export\s+default\s+function\s*\(\s*\)/.test(src) || /export\s+default\s+\(\s*\)\s*=>/.test(src)) return { path, name: safeName(base), kind: 'default' };
  // function Name() {…}  export default Name;
  m = src.match(new RegExp(`export\\s+default\\s+(${IDENT})\\s*;?\\s*(?:$|\\n)`));
  if (m && zeroFn(m[1])) return { path, name: m[1], kind: 'default' };
  // export function Name() / export const Name = () => — prefer the one named like the file
  const named: string[] = [];
  for (const mm of src.matchAll(new RegExp(`export\\s+(?:function\\s+(${IDENT})\\s*\\(\\s*\\)|const\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*(?:React\\.memo\\()?\\s*\\(\\s*\\)\\s*(?::[^=]+)?=>)`, 'g'))) {
    named.push(mm[1] ?? mm[2]);
  }
  if (named.length) return { path, name: named.find((n) => n === base) ?? named[0], kind: 'named' };
  return null;
}

/** A provider that takes only `children` — safe to wrap the whole shell in. PURE. */
export function childrenOnlyProvider(path: string, content: string): WiredExport | null {
  const src = String(content ?? '');
  const re = new RegExp(`export\\s+(default\\s+)?function\\s+(${IDENT}Provider)\\s*\\(\\s*\\{\\s*children\\s*\\}\\s*(?::[^)]*)?\\)`);
  const m = src.match(re);
  if (m) return { path, name: m[2], kind: m[1] ? 'default' : 'named' };
  const c = src.match(new RegExp(`export\\s+const\\s+(${IDENT}Provider)\\s*(?::[^=]+)?=\\s*\\(\\s*\\{\\s*children\\s*\\}\\s*(?::[^)]*)?\\)\\s*(?::[^=]+)?=>`));
  return c ? { path, name: c[1], kind: 'named' } : null;
}

function safeName(base: string): string {
  const s = base.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Z]/.test(s) ? s : `Screen${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** "src/pages/MockTest.tsx" → "./pages/MockTest" (relative to src/App.tsx). PURE. */
export function importSpecifier(entryPath: string, path: string): string {
  const fromDir = entryPath.replace(/[^/]*$/, '');
  const target = path.replace(/\.(?:tsx|jsx)$/, '');
  if (target.startsWith(fromDir)) return `./${target.slice(fromDir.length)}`;
  const up = fromDir.split('/').filter(Boolean).length;
  return `${'../'.repeat(up)}${target}`;
}

/** "MockTestPage" → "Mock Test". PURE. */
export function tabLabel(name: string): string {
  const words = name.replace(/(?:Page|Screen|View)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words || name;
}

/**
 * The provisional entry: every screen behind a tab bar, inline-styled (no class a stylesheet must define), valid
 * as both TSX and JSX. Deterministic for the same input, so a rewrite with no new screen is a no-op. PURE.
 */
export function autoWiredEntry(screens: readonly WiredExport[], entryPath = 'src/App.tsx', provider: WiredExport | null = null): string {
  const used = new Set<string>();
  const local = screens.map((s) => {
    let n = s.name; let i = 2;
    while (used.has(n)) n = `${s.name}${i++}`;
    used.add(n);
    return { ...s, local: n };
  });
  const imports = local.map((s) => (s.kind === 'default'
    ? `import ${s.local} from '${importSpecifier(entryPath, s.path)}';`
    : `import { ${s.name}${s.local !== s.name ? ` as ${s.local}` : ''} } from '${importSpecifier(entryPath, s.path)}';`));
  if (provider) {
    imports.push(provider.kind === 'default'
      ? `import ${provider.name} from '${importSpecifier(entryPath, provider.path)}';`
      : `import { ${provider.name} } from '${importSpecifier(entryPath, provider.path)}';`);
  }
  const tabs = local.map((s) => `  { label: ${JSON.stringify(tabLabel(s.name))}, Screen: ${s.local} },`);
  const body = [
    `    <div style={{ minHeight: '100vh' }}>`,
    ...(local.length > 1 ? [
      `      <nav style={{ display: 'flex', gap: 8, padding: 8, overflowX: 'auto', borderBottom: '1px solid rgba(127,127,127,.25)' }}>`,
      `        {SCREENS.map((s, i) => (`,
      `          <button key={s.label} onClick={() => setTab(i)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,.35)', background: i === tab ? 'rgba(99,102,241,.15)' : 'transparent', fontWeight: i === tab ? 700 : 400, cursor: 'pointer', color: 'inherit' }}>{s.label}</button>`,
      `        ))}`,
      `      </nav>`,
    ] : []),
    `      <Current />`,
    `    </div>`,
  ];
  const tree = provider ? [`    <${provider.name}>`, ...body.map((l) => `  ${l}`), `    </${provider.name}>`] : body;
  return [
    `// ${AUTO_WIRED_MARK} — written by NavBharatAI so your screens show in the preview while the app is being built.`,
    `// The builder replaces this file with the real layout and navigation.`,
    `import { useState } from 'react';`,
    ...imports,
    '',
    'const SCREENS = [',
    ...tabs,
    '];',
    '',
    'export default function App() {',
    '  const [tab, setTab] = useState(0);',
    '  const Current = SCREENS[Math.min(tab, SCREENS.length - 1)].Screen;',
    '  return (',
    ...tree,
    '  );',
    '}',
    '',
  ].join('\n');
}

/** The tool-result line the writer reads when the platform wired its screens. PURE. */
export function autoWiredNote(entryPath: string, screens: readonly WiredExport[], skipped: readonly string[]): string {
  const names = screens.map((s) => s.name).join(', ');
  const skip = skipped.length ? ` Not mounted (they take props): ${skipped.slice(0, 6).map((p) => p.replace(/^.*\//, '')).join(', ')}.` : '';
  return `\n🖥️ The platform wired ${entryPath} to your screens (${names}) so the live preview shows them now instead of the starter page. `
    + `It is a provisional tab shell marked "${AUTO_WIRED_MARK}": replace it with write_file when you write the real layout and navigation `
    + `(do not edit_file it — overwrite it whole).${skip}`;
}

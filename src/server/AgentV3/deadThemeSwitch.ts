// AgentV3 — a light/dark switch that sets something nothing styles.
//
// 🔴 AUTOPSY 8257ca59 (2026-10-01). A calculator was pre-seeded from NavBharatAI's tested template,
// whose theme switch (`src/theme.tsx`, ThemeToggle) sets `data-theme` on <html> — and the stylesheet's
// overrides are written for exactly that attribute. The polish step decided the switch was not "clear,
// visible" enough, replaced it with a 🌓 button doing `document.documentElement.classList.toggle('dark')`,
// and removed the ThemeToggle import. No rule anywhere targets `.dark`, so the button did nothing. The
// write-time typecheck said "clean" (it was), the explorer said "it responded" (it threw nothing), and
// only the post-build reviewer happened to read index.css and notice — a 3-minute repair on another engine.
//
// 🔑 THE CLASS: a write that switches a class or a `data-*` attribute on <html>/<body> for which no
// stylesheet, no `<style>` string and no Tailwind `dark:` variant exists. It is decidable from the code
// alone, so it is said WHILE THE FILE IS OPEN, beside the other write-time notes — never after the app is
// green, where only a repair can act on it.
//
// 🔒 PRECISION FIRST. Only literal names are judged (`classList.toggle(theme)` names nothing we can check);
// any trace of the name being styled anywhere in what was read stands the note down; and the caller passes
// nothing when it could not read the project, so "unknown" is always silence. PURE.

export interface RootThemeHook {
  kind: 'class' | 'attribute';
  /** The class name, or the attribute name (`data-theme`). */
  name: string;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every identifier the code assigns `document.documentElement` or `document.body` to. */
function rootAliases(code: string): string[] {
  const out = ['document.documentElement', 'document.body', 'document.querySelector\\(\\s*[\'"](?:html|body|:root)[\'"]\\s*\\)'];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z]+\s*)?=\s*document\.(?:documentElement|body)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(esc(m[1]));
  return out;
}

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The literal classes and data attributes this code switches on <html> or <body>. PURE. */
export function rootThemeHooks(code: string): RootThemeHook[] {
  const src = String(code ?? '');
  if (!/document\.(?:documentElement|body|querySelector)/.test(src)) return [];
  const hooks: RootThemeHook[] = [];
  const seen = new Set<string>();
  const add = (h: RootThemeHook) => { const k = `${h.kind}:${h.name}`; if (!seen.has(k)) { seen.add(k); hooks.push(h); } };
  for (const root of rootAliases(src)) {
    const cls = new RegExp(`${root}\\s*\\.\\s*classList\\s*\\.\\s*(?:toggle|add)\\(\\s*(['"\`])([\\w-]+)\\1`, 'g');
    const attr = new RegExp(`${root}\\s*\\.\\s*setAttribute\\(\\s*['"](data-[\\w-]+)['"]`, 'g');
    const data = new RegExp(`${root}\\s*\\.\\s*dataset\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*=(?!=)`, 'g');
    const name = new RegExp(`${root}\\s*\\.\\s*className\\s*=\\s*(['"\`])([\\w-]+)\\1`, 'g');
    let m: RegExpExecArray | null;
    while ((m = cls.exec(src))) add({ kind: 'class', name: m[2] });
    while ((m = name.exec(src))) add({ kind: 'class', name: m[2] });
    while ((m = attr.exec(src))) add({ kind: 'attribute', name: m[1] });
    while ((m = data.exec(src))) add({ kind: 'attribute', name: `data-${kebab(m[1])}` });
  }
  return hooks;
}

/** Whether anything in what was read styles this hook. PURE. */
export function hookIsStyled(hook: RootThemeHook, project: Readonly<Record<string, string>>): boolean {
  const texts = Object.values(project ?? {}).filter((t): t is string => typeof t === 'string');
  if (hook.kind === 'attribute') {
    const sel = new RegExp(`\\[\\s*${esc(hook.name)}\\b`);
    return texts.some((t) => sel.test(t));
  }
  const sel = new RegExp(`\\.${esc(hook.name)}(?![\\w-])`);
  if (texts.some((t) => sel.test(t))) return true;
  if (hook.name === 'dark') {
    // Tailwind's class strategy: `dark:` variants, a `darkMode` setting, or a v4 custom variant.
    if (texts.some((t) => /(?:^|[\s"'`{(])dark:[\w[!-]/m.test(t) || /\bdarkMode\b/.test(t) || /@(?:custom-)?variant\s+dark\b/.test(t))) return true;
  }
  return false;
}

/** What the project's own theming already switches on, for the note's hint. PURE. */
function existingThemeMechanism(project: Readonly<Record<string, string>>): string {
  const entries = Object.entries(project ?? {});
  const toggle = entries.find(([, t]) => /export\s+(?:default\s+)?function\s+ThemeToggle\b|export\s+const\s+ThemeToggle\b/.test(t));
  if (toggle) return `This project already has a working switch — ThemeToggle in ${toggle[0]} — use it instead of a new one. `;
  const attr = entries.map(([, t]) => /\[\s*(data-[\w-]+)\s*=?/.exec(t)?.[1]).find((a) => a && /theme|mode|scheme|color/i.test(a));
  if (attr) return `The styles switch on the ${attr} attribute of <html> ([${attr}='dark'] …) — set that instead. `;
  if (entries.some(([, t]) => /prefers-color-scheme/.test(t))) return 'The stylesheet follows the device setting (prefers-color-scheme), so a switch needs its own override rules. ';
  return '';
}

/**
 * The note for a written file whose theme switch sets something nothing styles, or '' when there is
 * nothing to say. `project` holds what was read of the project INCLUDING the written file; the caller
 * passes `null` when it could not read enough to judge, and the answer is then always ''. PURE.
 */
export function deadThemeSwitchNote(path: string, code: string, project: Readonly<Record<string, string>> | null): string {
  if (!project) return '';
  const dead = rootThemeHooks(code).filter((h) => !hookIsStyled(h, project));
  if (dead.length === 0) return '';
  const what = dead.map((h) => (h.kind === 'class' ? `the class "${h.name}"` : `the attribute ${h.name}`)).join(' and ');
  const rules = dead.map((h) => (h.kind === 'class' ? `.${h.name}` : `[${h.name}]`)).join(', ');
  return `\nNOTE — ${path} switches ${what} on <html>/<body>, but nothing in this project styles it (no rule for ${rules}`
    + `${dead.some((h) => h.name === 'dark') ? ', no dark: classes' : ''}), so pressing that switch changes nothing on screen. `
    + existingThemeMechanism(project)
    + 'Fix it now, while the file is open: make the switch set what the styles already use, or add rules that change the colour variables.';
}

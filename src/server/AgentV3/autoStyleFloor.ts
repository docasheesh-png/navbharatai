/**
 * 🔴 57 CLASS NAMES, NO RULES, FOR THE WHOLE BUILD (autopsy ca99778e, 2026-10-17).
 *
 * The mock-test screens used 57 classes no stylesheet defined. Every write was answered with the list
 * (`undefinedClassWriteNote`, e6d46cde), the turn-end hands it back once (stylePolishResume, 1be16985) and the
 * end-of-build check repairs it (a 100–170 s pass). The user, who stopped at 5.6 min, saw none of the three: the
 * notes were ignored, the turn never ended, and the repair never came. What they saw was raw HTML.
 *
 * 🔑 THE CLASS: styling exists only once a model chooses to write it. This is a FLOOR the platform lays itself,
 * at the write that introduces the class: a sheet of plain, theme-neutral rules for the class names whose words
 * say what they are (card, btn, option, grid, title, timer, correct, …), imported FIRST from the Vite mount so any
 * rule the builder writes later wins the cascade. A name whose words say nothing gets no rule (never a guess).
 *
 * 🔒 IT HIDES NOTHING FROM THE NETS. `collectDefinedClasses` does not count this sheet, so the write notes, the
 * turn-end hand-back and the end-of-build repair still see every class as undefined and still ask for real rules
 * — the floor is what the user sees meanwhile, not an answer. Kill switch `AGENTV3_AUTO_STYLE_FLOOR=off`. PURE.
 */

export const AUTO_STYLE_PATH = 'src/nb-autostyle.css';
export const AUTO_STYLE_IMPORT = "import './nb-autostyle.css';";

export function autoStyleFloorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_AUTO_STYLE_FLOOR ?? '').trim().toLowerCase() !== 'off';
}

export function isAutoStyleSheet(path: string): boolean {
  return String(path ?? '').replace(/^\.?\/+/, '') === AUTO_STYLE_PATH;
}

/** "questionCard" / "question-card" / "question_card" → ["question", "card"]. PURE. */
export function classWords(cls: string): string[] {
  return String(cls)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_]+/)
    .filter(Boolean);
}

const R = {
  container: 'max-width: 960px; margin: 0 auto; padding: 16px; box-sizing: border-box;',
  card: 'border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 16px; margin-bottom: 12px; background: rgba(127,127,127,.06);',
  button: 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: 8px; border: 1px solid #4f46e5; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer;',
  buttonQuiet: 'display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: 8px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; font-weight: 600; cursor: pointer;',
  title: 'font-size: 1.5rem; font-weight: 700; margin: 0 0 12px; line-height: 1.25;',
  subtitle: 'font-size: 1.1rem; font-weight: 600; margin: 0 0 8px;',
  muted: 'opacity: .75; font-size: .9rem;',
  grid: 'display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));',
  compactGrid: 'display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));',
  stack: 'display: flex; flex-direction: column; gap: 8px;',
  row: 'display: flex; flex-wrap: wrap; align-items: center; gap: 8px;',
  spread: 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;',
  badge: 'display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .8rem; background: rgba(127,127,127,.15);',
  input: 'padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; width: 100%; box-sizing: border-box;',
  option: 'display: block; width: 100%; text-align: left; padding: 10px 12px; margin: 6px 0; border-radius: 8px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; cursor: pointer;',
  active: 'outline: 2px solid #6366f1; background: rgba(99,102,241,.12);',
  success: 'background: rgba(34,197,94,.15); border-color: #22c55e;',
  danger: 'background: rgba(239,68,68,.12); border-color: #ef4444;',
  warning: 'background: rgba(234,179,8,.16); border-color: #eab308;',
  progress: 'height: 8px; border-radius: 999px; background: rgba(127,127,127,.2); overflow: hidden;',
  fill: 'height: 100%; background: #6366f1; border-radius: inherit;',
  stat: 'font-weight: 700; font-variant-numeric: tabular-nums;',
  hidden: 'display: none;',
  center: 'text-align: center;',
} as const;

/** Order matters: the first rule whose word appears wins (a "submit-btn" is a button, not a form). */
const WORD_RULES: ReadonlyArray<readonly [RegExp, keyof typeof R]> = [
  [/^(?:hidden|hide|sr)$/, 'hidden'],
  [/^(?:correct|success|right|pass|passed)$/, 'success'],
  [/^(?:wrong|incorrect|error|danger|fail|failed)$/, 'danger'],
  [/^(?:warning|warn|marked|flagged)$/, 'warning'],
  [/^(?:active|selected|current|chosen)$/, 'active'],
  [/^(?:secondary|ghost|outline|link|tab|tabs|chip)$/, 'buttonQuiet'],
  [/^(?:btn|button|cta|submit)$/, 'button'],
  [/^(?:option|options|choice|choices|answer|answers)$/, 'option'],
  [/^(?:palette|numbers|dots|bubbles)$/, 'compactGrid'],
  [/^(?:fill|filled|bar)$/, 'fill'],
  [/^(?:progress|track|meter)$/, 'progress'],
  [/^(?:badge|tag|pill|label|chip)$/, 'badge'],
  [/^(?:input|field|select|textarea|search)$/, 'input'],
  [/^(?:title|heading|headline|h1|hero)$/, 'title'],
  [/^(?:subtitle|subheading|h2|h3)$/, 'subtitle'],
  [/^(?:muted|desc|description|hint|caption|meta|note|small|helper|subtext)$/, 'muted'],
  [/^(?:timer|score|stat|stats|count|counter|value|marks|points)$/, 'stat'],
  [/^(?:grid|cards|tiles|gallery)$/, 'grid'],
  [/^(?:list|stack|column|col|form|body|content)$/, 'stack'],
  [/^(?:header|footer|toolbar|topbar|navbar|summary)$/, 'spread'],
  [/^(?:row|flex|actions|buttons|controls|nav|inline)$/, 'row'],
  [/^(?:card|panel|box|tile|section|paper|item|question|result|modal|dialog|sheet)$/, 'card'],
  [/^(?:container|wrapper|wrap|page|screen|app|main|layout|shell)$/, 'container'],
  [/^(?:center|centered)$/, 'center'],
];

/** The floor rule for one class name, or '' when its words say nothing we can style honestly. PURE. */
export function floorRuleFor(cls: string): string {
  if (!/^-?[A-Za-z_][\w-]*$/.test(cls)) return '';
  const words = classWords(cls);
  // The LAST word names the thing ("question-card" is a card, "card-title" is a title); fall back to any word.
  const ordered = [...words].reverse();
  for (const w of ordered.slice(0, 1).concat(ordered.slice(1))) {
    for (const [re, key] of WORD_RULES) if (re.test(w)) return `.${cls} { ${R[key]} }`;
  }
  return '';
}

/** The whole floor sheet for these class names — sorted, so the same set always writes the same bytes. PURE. */
export function autoStyleSheet(classes: Iterable<string>): string {
  const rules = [...new Set(classes)].sort().map(floorRuleFor).filter(Boolean);
  if (rules.length === 0) return '';
  return [
    '/* navbharatai:auto-style-floor — plain rules NavBharatAI lays for class names no stylesheet defines yet, so the',
    '   screens are readable while the app is built. Imported first: every rule in your own stylesheets wins. */',
    ...rules,
    '',
  ].join('\n');
}

/** The mount with the floor imported FIRST (so later sheets win), or null when it already is / cannot be. PURE. */
export function withAutoStyleImport(mount: string): string | null {
  if (typeof mount !== 'string' || mount.includes('nb-autostyle.css')) return null;
  return `${AUTO_STYLE_IMPORT}\n${mount}`;
}

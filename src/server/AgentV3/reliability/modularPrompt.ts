/**
 * P5a — SLIM CORE PROMPT + ON-DEMAND MODULES (fix/build-reliability, AGENTV3_MODULAR_PROMPT).
 *
 * The architect prompt is ~91,000 chars (~23k tokens) on every turn of every build — game-engine
 * recipes for a todo app, Prisma relation rules for a static landing page, a 3,300-char generator
 * catalogue for a first draft. On the weak ladder (128k window, slower models) that is a large slice
 * of the window and of every turn's latency, and the rules that matter for THIS app are diluted.
 *
 * With the flag on, the SAME prompt is built and then pieces that belong to a domain are moved out
 * unless the request needs them. Each module is identified by the opening words of its own bullet /
 * paragraph (stable text, written once in systemPrompt.ts), so nothing is re-worded and nothing can
 * drift: when a module's anchor is not found, that piece simply stays in the prompt. A removed module
 * is listed at the end with one line, and the model can pull it in with `read_guide`. PURE.
 */
import { reliabilityFlag } from './flags';
import type { ClaudeToolDef } from '../ClaudeClient';

export function modularPromptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('MODULAR_PROMPT', env);
}

export interface PromptModule {
  id: string;
  /** One line shown when the module is not loaded. */
  summary: string;
  /** The request needs this module. */
  trigger: RegExp;
  /** A piece (paragraph or `- ` bullet) belongs to this module when it starts with one of these. */
  anchors: RegExp[];
  /** The anchor claims its WHOLE paragraph (all of its bullets), not just the piece it starts. */
  wholeParagraph?: boolean;
}

export const PROMPT_MODULES: readonly PromptModule[] = [
  {
    id: 'games',
    summary: 'how to build a game with the game tools (2D/3D engines, controls, game UI recipes)',
    trigger: /\b(game|games|khel|puzzle|snake|tetris|arcade|platformer|shooter|racing|chess|ludo|quiz game|3d|three\.?js|phaser|canvas)\b/i,
    anchors: [/^- 🎮 GAMES ARE BUILT WITH THE GAME TOOLS/],
  },
  {
    id: 'fullstack',
    summary: 'full-stack rules: server serves client routes, DB-independent page serving, row level security, Prisma relations, seed scripts, auth',
    trigger: /\b(backend|server|api|database|db|login|log in|signup|sign up|auth|account|postgres|mysql|mongo|prisma|express|supabase|firebase|full[- ]?stack|admin panel|dashboard|crud|payment|order|booking)\b/i,
    anchors: [
      /^- 🚨 FULL-STACK APPS/,
      /^- 🧟 PAGE SERVING MUST NEVER DEPEND ON THE DATABASE/,
      /^- 🔒 EVERY TABLE MUST BE CLOSED/,
      /^- PRISMA RELATIONS/,
      /^- If you HAND-WRITE an executable seed SCRIPT/,
      /^- For a FULL-STACK app, call api_graph/,
      /^- If the app exposes an HTTP API/,
      /^- When the app needs login \/ protected routes/,
    ],
  },
  {
    id: 'python',
    summary: 'Python projects: venv, pip, running the server',
    trigger: /\b(python|flask|django|fastapi|streamlit|pandas)\b/i,
    anchors: [/^- PYTHON:/],
  },
  {
    id: 'ai-in-app',
    summary: 'how an app that needs an AI model calls one (keys, proxy, providers)',
    trigger: /\b(ai|a\.i\.|chatbot|chat bot|assistant|gpt|llm|gemini|claude|openai|summari[sz]e|summary|generate text|jarvis|copilot)\b/i,
    anchors: [/^AI INSIDE THE APP:/],
  },
  {
    id: 'secrets',
    summary: 'apps that need API keys / secrets (payments, SMS, maps, a database URL): request_secrets, never hard-code',
    trigger: /\b(stripe|razorpay|payment|pay|sms|otp|twilio|maps?|api key|token|secret|email|smtp|webhook|database url)\b/i,
    anchors: [/^- SECRETS \/ API KEYS the app needs/],
  },
  {
    id: 'android',
    summary: 'how the user gets a real Android .apk of their app',
    trigger: /\b(apk|android|play store|playstore|mobile app|install on (my )?phone)\b/i,
    anchors: [/^If the user asks how to get their app as a real Android file/],
    wholeParagraph: true,
  },
  {
    id: 'finishing',
    summary: 'production finishing generators (README, architecture docs, release notes, deploy artifacts, observability, bundle splitting, seed data, OpenAPI)',
    trigger: /\b(deploy|publish|production|docker|readme|documentation|docs|release|go live|ci|kubernetes|seo)\b/i,
    anchors: [
      /^- Before finishing a real app, call generate_readme/,
      /^- For a LARGER app \(many files\/components\), also call generate_architecture_docs/,
      /^- When finishing a version \(or before a deploy\), call generate_release_notes/,
      /^- For a real app with a backend and\/or a frontend entry, call generate_observability/,
      /^- For a production-ready Vite\+React app, call generate_bundle_optimization/,
      /^- After defining a data model, call generate_seed_data/,
      /^- Before shipping a real app, call generate_deploy_artifacts/,
      /^- When you IMPORT\/clone an existing repo, call check_toolchain/,
      /^- For a POLYGLOT app/,
    ],
  },
];

export interface ModularPromptResult {
  prompt: string;
  /** Modules kept in (requested or always). */
  loaded: string[];
  /** Modules moved out (available through read_guide). */
  deferred: string[];
  charsBefore: number;
  charsAfter: number;
}

/** Split into paragraphs, and paragraphs into `- ` bullets, keeping the exact separators. */
function pieces(prompt: string): Array<{ text: string; sep: string; module: PromptModule | null }> {
  const out: Array<{ text: string; sep: string; module: PromptModule | null }> = [];
  const paras = prompt.split(/(\n\n+)/);
  for (let i = 0; i < paras.length; i += 2) {
    const para = paras[i];
    const paraSep = paras[i + 1] ?? '';
    const bullets = para.split(/\n(?=- )/);
    const whole = moduleOf(bullets[0]);
    const paraModule = whole?.wholeParagraph ? whole : null;
    bullets.forEach((b, j) => out.push({ text: b, sep: j < bullets.length - 1 ? '\n' : paraSep, module: paraModule ?? moduleOf(b) }));
  }
  return out;
}

function moduleOf(text: string): PromptModule | null {
  for (const m of PROMPT_MODULES) if (m.anchors.some((a) => a.test(text))) return m;
  return null;
}

/** The text of one module, extracted from a full prompt ('' when none of its anchors are present). */
export function moduleText(fullPrompt: string, id: string): string {
  return pieces(fullPrompt).filter((p) => p.module?.id === id).map((p) => p.text).join('\n');
}

/**
 * Build the slim prompt for this request. `request` is the user's message (plus anything else that
 * says what is being built). `forceLoad` keeps modules regardless (e.g. edit mode on a full-stack app).
 */
export function modularizePrompt(fullPrompt: string, request: string, forceLoad: readonly string[] = []): ModularPromptResult {
  const want = new Set<string>(forceLoad);
  for (const m of PROMPT_MODULES) if (m.trigger.test(request)) want.add(m.id);
  const deferred = new Set<string>();
  let out = '';
  for (const p of pieces(fullPrompt)) {
    const m = p.module;
    if (m && !want.has(m.id)) {
      deferred.add(m.id);
      // Keep the separator so the surrounding structure stays intact.
      if (p.sep.startsWith('\n\n') && out.endsWith('\n')) out = out.replace(/\n+$/, '') + p.sep;
      continue;
    }
    out += p.text + p.sep;
  }
  if (deferred.size) {
    const lines = PROMPT_MODULES.filter((m) => deferred.has(m.id)).map((m) => `- ${m.id}: ${m.summary}`);
    out = `${out.replace(/\s+$/, '')}\n\nON-DEMAND GUIDES — not loaded for this request to keep your context small. If the work turns out to need one, call read_guide with its name BEFORE doing that part:\n${lines.join('\n')}`;
  }
  const loaded = PROMPT_MODULES.filter((m) => !deferred.has(m.id)).map((m) => m.id);
  return { prompt: out, loaded, deferred: [...deferred], charsBefore: fullPrompt.length, charsAfter: out.length };
}

export const READ_GUIDE_TOOL: ClaudeToolDef = {
  name: 'read_guide',
  description: 'Load one of the ON-DEMAND GUIDES listed at the end of your instructions (e.g. "games", "fullstack", "secrets"). Returns the full rules for that topic.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The guide name, as listed under ON-DEMAND GUIDES.' } },
    required: ['name'],
  },
};

/** The ~200-line file rule (AGENTV3_FILE_SIZE_RULE). */
export const FILE_SIZE_RULE = [
  'FILE SIZE — KEEP EVERY SOURCE FILE UNDER ~200 LINES. A file that long is written in one turn without being',
  'cut off by the output limit, and edited without losing your place. When a screen or module grows past that,',
  'split it: one component per file, hooks in their own file, data/constants in their own file. Never write a',
  'single 600-line App.tsx — App.tsx only wires routes/layout and imports the screens.',
].join('\n');

export function fileSizeRuleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('FILE_SIZE_RULE', env);
}

// AN AI PROVIDER CALLED FROM THE PAGE NEEDS A KEY IN THE PAGE (autopsy e52cebbf, 2026-10-06, Q-730).
//
// Build e52cebbf ("a personal finance app that categorises expenses using AI") wrote a browser file that
// read `localStorage.getItem("openai-api-key")`, asked the user to paste an OpenAI key into a settings box,
// and called `https://api.openai.com/v1/chat/completions` from the page. Q-723 stopped the fast lane
// planning that file (it now writes NavBharatAI's keyless `src/lib/ai.ts` itself), but nothing READ what
// a builder actually wrote — so any other lane, or a model that ignored the rule, could ship the same
// shape again and nothing would say so.
//
// The SHAPE, not the words: a browser source file that talks to an AI provider's own API host, builds a
// provider SDK client for the browser, or reads a provider key the bundle exposes (`VITE_OPENAI_API_KEY`).
// Any of the three means the key lives in the page — readable by every visitor, billable by anyone. The
// right path is the keyless route NavBharatAI already wires (`src/lib/ai.ts` → `window.NavAI` / the app AI
// gateway) or the user's own server.
//
// Server code is NOT browser code: `server/`, `api/`, `functions/`, `backend/`, Next's `pages/api` and
// `app/**/route.ts`, `*.server.*`, and anything under a test or build directory are skipped. PURE.

export type BrowserAiKeyShape = 'provider-host' | 'browser-sdk' | 'bundled-key' | 'image-host';

export interface BrowserAiKeyFinding {
  file: string;
  line: number;
  shape: BrowserAiKeyShape;
  snippet: string;
}

const SOURCE_RE = /\.(?:[cm]?[jt]sx?|vue|svelte|html)$/i;
const NOT_BROWSER_RE = /(^|[\\/])(?:server|backend|functions|netlify|supabase[\\/]functions|__mocks__|mocks?|tests?|__tests__|e2e|node_modules|coverage)([\\/]|$)|^(?:api|dist|build|scripts)[\\/]|(^|[\\/])pages[\\/]api[\\/]|\.(?:test|spec|server)\.|(^|[\\/])app[\\/](?:.+[\\/])?route\.[cm]?[jt]s$|(^|[\\/])(?:server|index\.server|vite\.config|next\.config)\.[cm]?[jt]s$/i;

/** AI providers' own API hosts — a browser call to one of these carries the provider key. */
const PROVIDER_HOST_RE = /\bapi\.openai\.com\b|\bapi\.anthropic\.com\b|\bgenerativelanguage\.googleapis\.com\b|\bapi\.x\.ai\b|\bapi\.groq\.com\b|\bopenrouter\.ai\/api\b|\bapi\.mistral\.ai\b|\bapi\.together\.(?:xyz|ai)\b|\bapi\.deepseek\.com\b|\bapi\.cohere\.(?:ai|com)\b|\bapi\.perplexity\.ai\b|\baiplatform\.googleapis\.com\b/i;
/**
 * An AI picture service called from the page (autopsy 303e8a6f, the sibling of cc3ef776). The picture
 * services answer 401 to a request without a key (Pollinations included, since 2026-10-04), so a page that
 * calls one either fails on every picture or carries a key every visitor can read. Neither the host list
 * above nor any other check named this host, so the cc3ef776 failure could come back through any lane.
 */
const IMAGE_HOST_RE = /\b(?:image|gen)\.pollinations\.ai\b|\bapi\.stability\.ai\b|\bapi\.replicate\.com\b|\bfal\.run\b|\bapi\.together\.xyz\/v1\/images\b/i;
/** A provider SDK told to run in the browser — the SDK's own name for "the key is in the page". */
const BROWSER_SDK_RE = /\bdangerouslyAllowBrowser\s*:\s*true\b/;
/** A provider key the bundler inlines into the page. */
const BUNDLED_KEY_RE = /\b(?:import\.meta\.env|process\.env)\.(?:VITE_|NEXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_)?(?:OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE_GENAI|GOOGLE_AI|GROQ|XAI|GROK|MISTRAL|DEEPSEEK|OPENROUTER|TOGETHER|COHERE|PERPLEXITY)_?API_?KEY\b/i;

const SHAPES: Array<[BrowserAiKeyShape, RegExp]> = [
  ['image-host', IMAGE_HOST_RE],
  ['provider-host', PROVIDER_HOST_RE],
  ['browser-sdk', BROWSER_SDK_RE],
  ['bundled-key', BUNDLED_KEY_RE],
];

const MAX_FINDINGS = 12;

/** True for a source file that runs in the user's browser. PURE. */
export function isBrowserSource(file: string): boolean {
  const f = String(file ?? '');
  if (!SOURCE_RE.test(f)) return false;
  // `process.env.X` in a Vite/CRA browser file is bundled; the same text in server code is a real secret
  // read on the server — the path decides which one it is.
  return !NOT_BROWSER_RE.test(f);
}

/** Every browser file that calls an AI provider with a key the page must hold. PURE. */
export function findBrowserAiKeyUse(files: Readonly<Record<string, string>>): BrowserAiKeyFinding[] {
  const out: BrowserAiKeyFinding[] = [];
  for (const [file, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string' || !content || !isBrowserSource(file)) continue;
    const lines = content.split('\n');
    for (const [shape, re] of SHAPES) {
      const i = lines.findIndex((l) => re.test(l) && !/^\s*(?:\/\/|\*|\/\*)/.test(l));
      if (i < 0) continue;
      out.push({ file, line: i + 1, shape, snippet: lines[i].trim().slice(0, 120) });
      break; // one finding per file is enough to say "this file holds a key"
    }
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

const FIX = 'Use NavBharatAI\'s keyless AI instead: import { generateText, chat } from "src/lib/ai.ts" (it goes through '
  + 'window.NavAI in the preview and the app AI gateway once published — no key anywhere). If the user really wants '
  + 'their own provider, the call belongs on their own server with the key in its environment, never in the page.';

/**
 * The fix for a page that makes PICTURES. Text has a keyless route; pictures do not (autopsy 303e8a6f): the
 * remedy above ("no key anywhere") would send a picture app to the text recipe and tell it pictures are free.
 */
const PICTURE_FIX = 'For AI pictures, use run_recipe "generate_image_ai": the page asks NavBharatAI (window.NavAI.image) '
  + 'and NavBharatAI makes the picture on its server with the image API key the app\'s owner saves in Keys & Secrets — '
  + 'the key never reaches the page. Pictures always need an image API key; tell the user which keys work and where to add them.';

/** A line that asks for a PICTURE rather than text: an images endpoint, an image model, or a picture host. */
const PICTURE_CALL_RE = /\/images\/generations\b|\bdall-?e-?\d\b|\bgpt-image\b|\bimagen-\d|\bgrok-[\w.-]*image\b/i;

/** The fix for one finding: the picture route for a picture call, the keyless text route otherwise. PURE. */
function fixFor(hit: BrowserAiKeyFinding, content: string): string {
  return hit.shape === 'image-host' || PICTURE_CALL_RE.test(hit.snippet) || PICTURE_CALL_RE.test(content) ? PICTURE_FIX : FIX;
}

/** The note the builder hears while the file is still open. '' when clean. PURE. */
export function browserAiKeyWriteNote(file: string, content: string): string {
  if (typeof content !== 'string' || !content) return '';
  const hit = findBrowserAiKeyUse({ [file]: content })[0];
  if (!hit) return '';
  if (hit.shape === 'image-host') {
    return `\n\n⛔ AI PICTURE SERVICE CALLED FROM THE PAGE — ${file}:${hit.line} ${hit.snippet}\n`
      + 'Without a key this service refuses every picture; with one, the key lives in the page where every visitor '
      + `can read it and spend it. ${PICTURE_FIX}\n`;
  }
  return `\n\n⛔ AI KEY IN THE PAGE — ${file}:${hit.line} ${hit.snippet}\n`
    + 'This browser code calls an AI provider directly, so the provider key has to live in the page, where every '
    + `visitor can read it and spend it. ${fixFor(hit, content)}\n`;
}

/** One line for the build report, naming each file. '' when clean. PURE. */
export function browserAiKeyReportLine(findings: readonly BrowserAiKeyFinding[]): string {
  if (!findings.length) return '';
  const where = findings.map((f) => `${f.file}:${f.line} (${f.shape})`).join(', ');
  const pictures = findings.some((f) => f.shape === 'image-host' || PICTURE_CALL_RE.test(f.snippet));
  return `Browser code calls an AI provider with a key the page must hold — ${where}. The key would be readable by every visitor `
    + `(and an AI picture service called without one refuses every picture). ${pictures ? PICTURE_FIX : FIX}`;
}

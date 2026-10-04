/**
 * IS THIS ORDER ABOUT THE APP THAT IS HERE? (admin 2026-09-30, verbatim: "puch lo user se!")
 *
 * 🔴 AUTOPSY 1389f0d5. A workspace held a calculator. The user typed "Generate a pdf on genesis 4 with
 * added images with this photo type uploaded". A build order on an existing app is turned into an EDIT
 * (`BUILD_ORDER_READ_AS_EDIT` — the net that keeps a "build" from bulldozing somebody's app), so the
 * engine built a Genesis-4 PDF page INTO the calculator: a calculator with a Bible chapter bolted on,
 * which nobody asked for, billed as an edit. Building it as a fresh app instead would have replaced the
 * calculator — also something nobody asked for. Only the user knows which they meant, so the turn now
 * ASKS: add it to this app, or start a new app.
 *
 * ⚠️ THE ASYMMETRY THAT DECIDES EVERY DOUBTFUL CASE (the same one IntentClassifier.ts records): a wrong
 * question costs ONE message, and the answer is one word; a wrong build costs minutes, money and an app
 * changed in a way the user did not choose. But a question asked about an ordinary edit ("add a login
 * page", "Install button do") is friction on the commonest turn there is, so the test is narrow:
 *   1. the order names a WHOLE THING to make — an app, a website, a game, a PDF, a store — not a part
 *      of one (a button, a page, a colour);
 *   2. it does not point at the app that is here ("this app", "isi app me", "mera app");
 *   3. what it is ABOUT shares not one word-stem with what the existing app is: the names of its own
 *      files and the earlier build requests made in this workspace.
 * Either side empty ⇒ we cannot tell ⇒ no question, exactly the old behaviour. PURE.
 *
 * Kill switch: `AGENTV3_ASK_UNRELATED=off` restores the old edit-always behaviour.
 */
import { SCAFFOLD_PATHS, couldBeAppCode } from './userProjectFiles';

export function askUnrelatedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_ASK_UNRELATED ?? '').trim().toLowerCase() !== 'off';
}

/** A whole thing someone makes — never a part of one. */
// 🔴 A GAME CAN BE NAMED BY ITS KIND (autopsy e3b0ce25, 2026-10-04): "Build one block fitting puzzle"
// named no word on the old list, so it read as "a part of an app" and was built INTO the PDF reader
// that was here — the reader was replaced and the user was never asked. A puzzle, a quiz or a
// calculator is a whole thing as surely as a "game" is.
const WHOLE_THING = /\b(?:apps?|application|web\s*apps?|websites?|web\s*sites?|sites?|games?|puzzles?|quiz(?:zes)?|calculators?|trackers?|planners?|chatbots?|dashboards?|portals?|stores?|shops?|pdfs?|e-?books?|ebooks?|documents?|landing\s+pages?|clones?|software|softwares)\b/i;

/** The order points at the app that is already here. */
const POINTS_HERE = /\b(?:this|the|my|the\s+same|same|current|existing|our|isi|iss?|isme|ismein|isme|yahi|yahin|meri|mera|mere|apni|apna|apne|hamari|hamara)\s+(?:wali\s+|wala\s+|wale\s+)?(?:apps?|application|websites?|sites?|games?|puzzles?|quiz(?:zes)?|calculators?|trackers?|planners?|chatbots?|projects?)\b|\b(?:isme|ismein|isi\s+me|isi\s+mein|in\s+it|to\s+it|into\s+it|here)\b/i;

/** "Make it …", "isko …" — the order is about the thing already here. */
const ABOUT_IT = /\b(?:make|turn|convert|change|redesign|style|restyle)\s+it\b|\b(?:isko|ise|isse|usko|use)\s/i;
/** "like a professional website", "game jaisa" — a comparison of style, not a new thing to make. */
const COMPARISON = /\b(?:like|as)\s+(?:an?\s+)?(?:[a-z-]+\s+){0,2}(?:apps?|websites?|sites?|games?|dashboards?|portals?|stores?|shops?)\b|\b(?:apps?|websites?|sites?|games?|dashboards?)\s+(?:jaisa|jaisi|jaise|jesa|jaesa|type|style|look)\b/i;

/** A change to something — this app's, by default. */
const EDIT_VERB = /\b(?:add|jodo|jod\s+do|daalo|dalo|daal\s+do|lagao|laga\s+do|hatao|hata\s+do|remove|delete|change|update|badlo|badal\s+do|improve|translate|replace|rename|move|show|hide|insert|include|enable|disable)\b/i;
/** "App me …", "app ko …", "website par …" — Hindi postpositions on THE app. */
const APP_REFERENCE_HI = /\b(?:apps?|application|websites?|sites?|games?|puzzles?|quiz(?:zes)?|calculators?|trackers?|planners?|chatbots?|project)\s+(?:me|mein|mai|mei|ko|ka|ki|ke|par|pe|se)\b/i;
/** Packaging or porting the app that is here — never a different app. */
const PLATFORM = /\b(?:android|ios|iphone|ipad|mobile|installable|pwa|apk|aab|ipa|desktop|native|play\s*store|app\s*store|offline)\b/i;
/** The whole-thing word followed by a PART of an app ("game mode", "pdf download", "store page"). */
const FOLLOWED_BY_PART = /^\s+(?:page|pages|mode|download|downloads|export|exports|button|section|feature|features|option|options|screen|screens|tab|tabs|version|icon|link|links|view|report|reports|module|widget|banner|header|footer|form|card|list)\b/i;

/** Carrying on, finishing or repairing — always about the work that is here. */
const CONTINUES_HERE = /\b(?:continue|resume|finish|fix|repair|complete\s+(?:it|the)|carry\s+on|aage\s+(?:badhao|karo)|jaari|poora\s+karo|pura\s+karo|theek\s+karo|thik\s+karo|sudhaaro|sudharo)\b/i;

/** Words that carry no subject: verbs of making, fillers, connectives, Hindi particles, generic UI and code words. */
const STOP = new Set([
  // making / asking
  'make', 'made', 'making', 'create', 'creating', 'build', 'building', 'generate', 'generating', 'develop', 'design',
  'banao', 'bnao', 'banado', 'bnado', 'bana', 'bna', 'banana', 'banaiye', 'banaye', 'chahiye', 'karo', 'kardo', 'kar', 'karna',
  'please', 'plz', 'want', 'need', 'give', 'write', 'add', 'added', 'adding', 'with', 'without', 'using', 'from', 'into', 'that',
  'this', 'which', 'where', 'what', 'have', 'some', 'like', 'also', 'more', 'than', 'just', 'only', 'very', 'about', 'other',
  'wala', 'wali', 'wale', 'waala', 'waali', 'mein', 'liye', 'saath', 'aur', 'bhi', 'ek', 'kuch', 'koi', 'hai', 'hain', 'mujhe',
  'uploaded', 'upload', 'type', 'types', 'simple', 'basic', 'small', 'big', 'good', 'best', 'beautiful', 'nice', 'modern',
  'full', 'complete', 'working', 'real', 'online', 'free', 'tool', 'tools', 'system', 'page', 'pages', 'screen', 'screens',
  // the whole-thing nouns themselves
  'app', 'apps', 'application', 'website', 'websites', 'site', 'sites', 'webapp', 'game', 'games', 'dashboard', 'portal',
  'store', 'shop', 'pdf', 'pdfs', 'ebook', 'book', 'document', 'documents', 'landing', 'clone', 'software',
  // generic code-file words: every project has them, so they say nothing about WHICH app it is
  'index', 'main', 'utils', 'util', 'helpers', 'helper', 'hooks', 'hook', 'components', 'component', 'context', 'constants',
  'config', 'styles', 'style', 'global', 'globals', 'data', 'services', 'service', 'store', 'state', 'types', 'error',
  'boundary', 'errorboundary', 'layout', 'header', 'footer', 'button', 'buttons', 'modal', 'card', 'list', 'item', 'items',
  'home', 'test', 'tests', 'spec', 'setup', 'vite', 'env', 'readme', 'package', 'tsconfig', 'node',
]);

/** The four-letter stems of the subject words in a text. PURE. */
export function subjectStems(text: string): Set<string> {
  const words = String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  return new Set(words.map((w) => w.slice(0, 4)));
}

/** The words a workspace's own files say about which app it is: user files' names and folders. PURE. */
export function fileIdentityText(paths: readonly string[] | null | undefined): string {
  if (!Array.isArray(paths)) return '';
  const out: string[] = [];
  for (const raw of paths) {
    const p = String(raw ?? '').trim().replace(/^\.?\/+/, '');
    if (!p || SCAFFOLD_PATHS.has(p) || !couldBeAppCode(p)) continue;
    if (!/\.(?:[cm]?[tj]sx?|css|scss|html?|vue|svelte)$/i.test(p)) continue;
    const segs = p.replace(/\.[^.]+$/, '').split('/').filter((s) => !['src', 'app', 'lib', 'public', 'client', 'server', 'pages', 'components'].includes(s.toLowerCase()));
    out.push(...segs);
  }
  return out.join(' ');
}

/** Does the order name a whole thing — not merely a part of one ("game mode", "pdf download")? PURE. */
function namesWholeThing(prompt: string): boolean {
  const re = new RegExp(WHOLE_THING.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    if (!FOLLOWED_BY_PART.test(prompt.slice(m.index + m[0].length))) return true;
  }
  return false;
}

export interface UnrelatedRequestInput {
  prompt: string;
  /** The workspace's file paths (null = unreadable ⇒ we cannot tell). */
  paths: readonly string[] | null | undefined;
  /** Earlier BUILD requests in this workspace, oldest first. */
  earlierBuildRequests: readonly string[];
}

export interface UnrelatedRequestVerdict {
  ask: boolean;
  /** Why not, or what was compared — for the admin line. */
  reason: string;
  /** A few words naming the app that is here, for the question ("Calculator, Keypad"). */
  existingHint: string;
}

/** Should this build order be asked about before it is built into the existing app? PURE. */
export function unrelatedToExistingApp(input: UnrelatedRequestInput, env: NodeJS.ProcessEnv = process.env): UnrelatedRequestVerdict {
  const none = (reason: string): UnrelatedRequestVerdict => ({ ask: false, reason, existingHint: '' });
  if (!askUnrelatedEnabled(env)) return none('switched off');
  const prompt = String(input.prompt ?? '');
  if (!namesWholeThing(prompt)) return none('the order names a part of an app, not a whole thing');
  if (EDIT_VERB.test(prompt)) return none('the order changes something, and a change is to the app that is here');
  if (APP_REFERENCE_HI.test(prompt)) return none('the order refers to the app that is here');
  if (PLATFORM.test(prompt)) return none('the order packages or ports the app that is here');
  if (POINTS_HERE.test(prompt)) return none('the order points at the app that is here');
  if (CONTINUES_HERE.test(prompt)) return none('the order continues or repairs the work that is here');
  if (ABOUT_IT.test(prompt)) return none('the order is about the thing already here');
  if (COMPARISON.test(prompt)) return none('the order compares a style, it does not name a new thing');
  const asked = subjectStems(prompt);
  if (asked.size === 0) return none('the order names no subject');
  const filesText = fileIdentityText(input.paths);
  const earlier = (input.earlierBuildRequests ?? []).filter((r) => typeof r === 'string' && r.trim() && r.trim() !== prompt.trim());
  const here = subjectStems(`${filesText} ${earlier.join(' ')}`);
  if (here.size === 0) return none('nothing says which app is here');
  for (const s of asked) if (here.has(s)) return none(`shares "${s}…" with the app that is here`);
  const hintWords = [...new Set(filesText.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z0-9]{2,}$/.test(w) && !STOP.has(w.toLowerCase())))].slice(0, 5);
  return {
    ask: true,
    reason: `the order is about ${[...asked].slice(0, 6).join(', ')}; the app here is about ${[...here].slice(0, 6).join(', ')} — nothing in common`,
    existingHint: hintWords.join(', '),
  };
}

/**
 * The chat steer for the question. The reply is the model's, so it is in the user's own language (the
 * chat path's LANGUAGE rule); what it must say is fixed here. PURE.
 */
export function unrelatedRequestSteer(existingHint: string, hadAttachment: boolean): string {
  const what = existingHint ? ` (its own files are named ${existingHint})` : '';
  return '\n\nThe user\'s project ALREADY HOLDS AN APP' + what + ', and this message asks for something that has '
    + 'nothing to do with it. Do NOT build anything and do NOT pretend to. In two or three short sentences, in '
    + 'the user\'s own language: say in a few words what their current app is, and ask which they want — '
    + '(1) add this INTO their current app, or (2) make it as a NEW, separate app. Say exactly how to answer: '
    + 'for (1) reply "add it to this app"; for (2) tap "New" in the header (on a phone: More → New chat) and send the '
    + 'same request there, which keeps the current app untouched.'
    + (hadAttachment ? ' They attached a file with this message: tell them to attach it again with their answer, because a file goes only with the message it was sent with.' : '')
    + ' Be warm and brief.';
}

/** The question when the chat model could not answer — never a fall-through into a build. PURE. */
export function unrelatedRequestFallback(existingHint: string): string {
  const what = existingHint ? ` (${existingHint})` : '';
  return `Your project already has an app${what}, and this request is for something different. Should I add it to this app, or make it as a new app? `
    + 'To add it here, reply "add it to this app". To keep this app as it is and make a new one, tap "New" in the header (on a phone: More → New chat) and send the same request there.';
}

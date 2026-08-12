// AgentV3 — did this app actually NEED a server, and did we build one anyway?
//
// ADMIN 2026-08-12, on whether the in-browser preview could replace E2B: "koi to jugad koi to rasta
// hoga?" There is, and it is not the preview — it is the architecture the builder chooses.
//
// THE OBSERVATION THIS MODULE EXISTS TO MEASURE. The dukaan stock app was built as Express + Postgres
// + bcryptjs + multer, which forces a real Linux VM for every preview and every verification. It did
// not need any of it: login, a product list, a search box, a photo, and a daily total are all things a
// browser can do directly against a hosted database. The engine was never asked whether a server was
// necessary, so it built one, and the VM bill followed from a decision nobody made on purpose.
//
// `BackendPresence` already answers "does this built app HAVE a server" — but only after the fact, to
// explain why the in-browser preview cannot run it. This module answers the question one step earlier
// and one step more useful: **did the request require one?** The gap between the two is the prize —
// every app that HAS a server it never NEEDED is an app that could have skipped the sandbox entirely.
//
// PURE and deterministic. Measurement first: before a single line of the builder changes, this is run
// over real past builds to find out whether the gap is worth a large change at all. A plan built on a
// guessed percentage is a guess wearing a roadmap.

export interface ServerNecessity {
  /** True when something in the request genuinely cannot run without a server we control. */
  needed: boolean;
  /** The concrete reasons, most specific first. Empty when no server is required. */
  reasons: string[];
}

/**
 * Capabilities that genuinely require a server, with the reason stated in the user's terms.
 *
 * Each entry earns its place by being IMPOSSIBLE in a browser, not merely easier on a server:
 *  - a webhook needs a public URL that receives a POST — a browser tab has no address to give;
 *  - a secret key put in front-end code is public the moment the app ships;
 *  - a scheduled job must run when nobody has the app open;
 *  - heavy native work (PDF, video, scraping) needs a process, not a tab.
 *
 * Hinglish and Hindi spellings are included because that is how this app's users actually write.
 */
const SERVER_REQUIRED: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\bwebhooks?\b|\bcallback url\b/i, reason: 'a webhook needs a public URL that a browser cannot provide' },
  { re: /\b(cashfree|razorpay|stripe|paytm|phonepe|payu|paypal)\b/i, reason: 'a payment gateway confirms the payment to a server, not to the app' },
  { re: /\b(payment|payments?\s+gateway|checkout|subscription|recurring|refund)\b|\bpaise\s+(lo|lena|kaato)\b|\bbhugtan\b/i, reason: 'taking money needs a server the payment provider can talk to' },
  { re: /\b(cron|scheduled?|daily\s+(report|email|reminder)|every\s+(day|hour|week)|auto.?send)\b|\broz\b.*\b(bheje?|report)\b/i, reason: 'a scheduled job must run when nobody has the app open' },
  { re: /\bsend\s+(an?\s+)?(email|sms|otp|whatsapp)\b|\b(email|sms|otp|whatsapp)\s+(bhej|send)/i, reason: 'sending email/SMS/WhatsApp uses a secret key that cannot ship inside the app' },
  { re: /\b(openai|gemini|anthropic|api\s*key|secret\s*key|private\s*key)\b/i, reason: 'a secret API key becomes public the moment it is put in front-end code' },
  { re: /\b(pdf|invoice\s+generate|scrap(e|ing)|crawl|video\s+(process|convert|encode)|image\s+process)\b/i, reason: 'heavy work like PDF/video/scraping needs a real process, not a browser tab' },
  { re: /\b(server.?side\s+render|ssr|seo\s+(friendly|optimi))\b/i, reason: 'server-side rendering is, by definition, done on a server' },
  { re: /\bsocket\.io\b|\bwebsocket\s+server\b/i, reason: 'a WebSocket SERVER has to run somewhere a browser cannot' },
];

/**
 * Things people often assume need a server and DO NOT — kept here as documentation, because this list
 * is the actual argument of the whole plan. Every one of these is a normal hosted-database feature
 * that a browser talks to directly, and every one of them appeared in the dukaan app.
 *
 * login · signup · sessions · user accounts     → the auth provider (never our own bcrypt + JWT)
 * saving data · lists · search · filter · sort   → the hosted database, queried from the browser
 * photo / file upload                            → the provider's storage, uploaded from the browser
 * realtime updates                               → the provider's realtime channel
 * dashboards · charts · totals                   → computed from the same queries
 *
 * They are deliberately NOT patterns here: their absence from SERVER_REQUIRED is what makes an app
 * browser-native. Listing them would invite someone to "helpfully" add them to the required set.
 */

/** Does this request genuinely require a server? PURE. */
export function needsRealServer(prompt: string | null | undefined): ServerNecessity {
  const text = String(prompt ?? '');
  if (!text.trim()) return { needed: false, reasons: [] };
  const reasons: string[] = [];
  for (const { re, reason } of SERVER_REQUIRED) {
    if (re.test(text) && !reasons.includes(reason)) reasons.push(reason);
  }
  return { needed: reasons.length > 0, reasons };
}

const SERVER_PATH = /(^|\/)(server|backend|api)\//i;
const SERVER_ENTRY = /(^|\/)(server|app|index)\.(m|c)?[jt]s$/i;
const SERVERLESS_PATH = /(^|\/)(functions|netlify\/functions|api)\//i;

/**
 * Did the build actually PRODUCE a server? PURE — reads file paths only, which is all a stored build
 * manifest keeps.
 *
 * Deliberately narrow. `src/api/client.ts` is a browser fetch helper, not a server, and counting it
 * would inflate the very number this measurement exists to establish — so a path only counts when it
 * sits OUTSIDE `src/`, where this repo's own frontend/backend partition puts real server code.
 */
export function builtAServer(paths: ReadonlyArray<string>): boolean {
  return (paths ?? []).some((p) => {
    const path = String(p ?? '');
    if (!path || /^src\//i.test(path)) return false;
    return SERVER_PATH.test(path) || SERVER_ENTRY.test(path) || SERVERLESS_PATH.test(path);
  });
}

export interface NecessityTally {
  /** Builds examined (a build with neither a prompt nor a manifest is skipped, not counted as either). */
  examined: number;
  /** Built a server AND needed one — correct, and E2B is genuinely required. */
  neededAndBuilt: number;
  /** Built a server it did NOT need — the prize: these could have skipped the sandbox entirely. */
  builtButNotNeeded: number;
  /** Needed one and did NOT build it — a correctness gap, not a cost one. Worth knowing separately. */
  neededButMissing: number;
  /** Neither needed nor built — already browser-native today. */
  neitherNeededNorBuilt: number;
  /** The reasons that drove `needed`, counted — so the biggest genuine blocker is visible. */
  reasonCounts: Record<string, number>;
}

/** Roll a set of past builds into the one table this decision needs. PURE. */
export function tallyServerNecessity(
  builds: ReadonlyArray<{ prompt?: string | null; paths?: ReadonlyArray<string> | null }>,
): NecessityTally {
  const t: NecessityTally = {
    examined: 0, neededAndBuilt: 0, builtButNotNeeded: 0,
    neededButMissing: 0, neitherNeededNorBuilt: 0, reasonCounts: {},
  };
  for (const b of builds ?? []) {
    const prompt = (b?.prompt ?? '').trim();
    const paths = Array.isArray(b?.paths) ? b!.paths! : [];
    // A build with no prompt AND no files tells us nothing; counting it as "browser-native" would
    // quietly flatter the result this measurement exists to test.
    if (!prompt && paths.length === 0) continue;
    t.examined += 1;
    const { needed, reasons } = needsRealServer(prompt);
    const built = builtAServer(paths);
    for (const r of reasons) t.reasonCounts[r] = (t.reasonCounts[r] ?? 0) + 1;
    if (needed && built) t.neededAndBuilt += 1;
    else if (!needed && built) t.builtButNotNeeded += 1;
    else if (needed && !built) t.neededButMissing += 1;
    else t.neitherNeededNorBuilt += 1;
  }
  return t;
}

/**
 * The honest headline. States the share that could skip a sandbox AND the caveat that makes it an
 * upper bound — because the decision this number drives is a large one, and a number presented
 * without its limits is how a large change gets approved on a misunderstanding.
 */
export function necessityHeadline(t: NecessityTally): string {
  if (!t || t.examined <= 0) return 'No builds with enough recorded detail to measure yet.';
  const browserNative = t.builtButNotNeeded + t.neitherNeededNorBuilt;
  const pct = Math.round((browserNative / t.examined) * 100);
  return (
    `${pct}% of ${t.examined} builds (${browserNative}) needed no server at all — of those, ${t.builtButNotNeeded} were given one anyway. ` +
    `${t.neededAndBuilt} genuinely needed one. ` +
    `This is an UPPER BOUND on what could skip the sandbox: it reads the request's wording, so an unstated requirement counts as "not needed".`
  );
}

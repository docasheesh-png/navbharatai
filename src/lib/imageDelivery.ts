// How a generated picture reaches the user — from THEIR connection, or from ours
// (admin-mandated 2026-09-21: "free wale me user ki ip, paid me hamari").
//
// 🔑 THE POINT IS A RATE LIMIT, NOT A COST. The free image provider allows one request every 15
// seconds PER IP, and our server is a single caller — so every free user on the platform shares one
// bucket, and at any real scale they queue behind each other. Fetching from the browser puts each
// user on their own address. It buys capacity we cannot buy any other way without a key.
//
// 🔴 AND THE FOUR FEATURES STAY (admin, same message: "yeh sab user ke ip par kaam kar jaye, kisi
// bhi tarah"). Add text, Crop, Copy/Download and History all need the picture's actual BYTES, and a
// browser may not read the bytes of another site's image unless that site allows it (CORS). Whether
// the provider allows it cannot be checked from a Claude session, so this module does not assume an
// answer: it describes BOTH ways of getting the bytes and lets the client find out at runtime.
//
// 🔒 PURE. No DOM, no fetch, no env — the decisions only. The client does the fetching, the server
// does the signing, and both read the same rules from here.

/** The provider hosts a minted link may point at. Anything else is refused, on both sides. */
export const IMAGE_FETCH_HOSTS = ['image.pollinations.ai', 'gen.pollinations.ai'] as const;

/**
 * Is this a link we are willing to hand a browser, and later to fetch back ourselves?
 *
 * 🔴 THIS IS THE SSRF GUARD AND IT IS AN EXACT-HOST ALLOWLIST ON PURPOSE. The relay endpoint takes a
 * URL from the CLIENT, so without this a caller could ask our server to fetch anything it can reach
 * — a cloud metadata address, an internal service, a port scan. A substring or regex check is not
 * enough (`image.pollinations.ai.evil.com` contains the host). The ticket signature is the second
 * lock; this is the first, and neither alone is relied on.
 *
 * PURE.
 */
export function isAllowedImageHost(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  // `hostname` is already normalised and carries no port, no credentials, no path.
  return (IMAGE_FETCH_HOSTS as readonly string[]).includes(parsed.hostname);
}

/** What the generate route hands back. One of the two, never both. */
export type ImageDelivery =
  /** The bytes, fetched by our server — today's behaviour, and what every PAID request gets. */
  | { mode: 'inline'; image: string; mimeType: string }
  /** A signed link the BROWSER fetches, so the provider sees the user's address rather than ours. */
  | { mode: 'client-fetch'; url: string; ticket: string; exp: number };

/**
 * How long a minted link stays usable.
 *
 * Long enough that a user who leaves the tab and comes back can still press "Add text" on the last
 * picture, short enough that a leaked link is not a standing key to our relay. The picture itself is
 * reproducible from its own URL forever (same prompt + same seed = same picture), so nothing is lost
 * when a ticket expires — the link simply has to be minted again.
 */
export const IMAGE_TICKET_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The waits between retries when the provider says "too many requests", in milliseconds.
 *
 * 🔑 THE SHAPE COMES FROM THE PROVIDER'S OWN LIMIT: one request every 15 seconds per address. So the
 * first wait clears that window and the rest give a shared address (a carrier NAT, where many phones
 * sit behind one IP) a few more chances. The admin set the budget explicitly — "user ko result 1 min
 * baad bhi mile chalega" — and this sums to just under it.
 *
 * ⚠️ THE SEED MUST NOT CHANGE BETWEEN RETRIES. The provider bills and caches by URL, so retrying the
 * SAME url returns the same picture and costs nothing extra; changing the seed would make every
 * retry a fresh generation, and the user would get a different picture from the one they waited for.
 */
export function imageRetryDelaysMs(): number[] {
  return [16_000, 16_000, 16_000, 10_000];
}

/** The whole retry budget, for the countdown the user is shown. */
export function imageRetryBudgetMs(): number {
  return imageRetryDelaysMs().reduce((a, b) => a + b, 0);
}

/**
 * How many times a direct browser fetch may THROW before we stop trying it.
 *
 * A throw carries no status: a blocked cross-origin read and a dropped connection look exactly the
 * same to the page. So one retry covers the dropped connection, and a second failure is taken as
 * "this browser cannot read these bytes" — after which the picture is still SHOWN from the user's
 * own connection and only the bytes come through our relay, when a button actually needs them.
 * Retrying a CORS refusal is free for nobody: it never succeeds and the user waits for nothing.
 */
export const DIRECT_FETCH_THROW_LIMIT = 2;

/** True for a status worth waiting out: the provider's rate limit, or a transient server error. */
export function shouldRetryImageStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/** The countdown line under a waiting picture. Branded; never names the provider. */
export function imageWaitMessage(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `NavBharatAI’s engine is busy — trying again (${s}s)`;
}

// Fetching the generated picture from the USER's connection (admin-mandated 2026-09-21).
//
// The server no longer downloads a free picture; it hands the browser a signed link and the browser
// downloads it. That is the whole point: the provider's rate limit is one request every 15 seconds
// PER ADDRESS, and our server is one address — so every free user was queuing behind every other
// one. From the browser, each user has their own.
//
// 🔴 AND THE BYTES MATTER, NOT JUST THE PICTURE. "Add text", "Crop", "Copy" and "Download" all need
// the real pixels, and a browser may not read the pixels of another site's image unless that site
// allows it. Whether this provider allows it could not be checked from a Claude session, so this
// module does not assume: it TRIES, and if the browser cannot read them it says so plainly to its
// caller, which then shows the picture from the link and fetches the bytes through our relay only
// when a button actually needs them. Either way the four features keep working, which is what the
// admin asked for.

import {
  DIRECT_FETCH_THROW_LIMIT, imageRetryDelaysMs, shouldRetryImageStatus,
} from './imageDelivery';

/** What the generate route hands back when the browser is to do the fetching. */
export interface ClientFetchTicket {
  url: string;
  ticket: string;
  exp: number;
}

export interface ClientImageOutcome {
  /** The bytes as a data URL. Present whenever they could be obtained — the ordinary case. */
  dataUrl?: string;
  /** True when this browser could not read the bytes, so a relay call is needed to edit or save. */
  needsRelay?: boolean;
  /** An honest failure. Branded; never names the provider. */
  error?: string;
}

/**
 * Does a direct cross-origin read work here?
 *
 * Remembered for the session, because the answer is a property of the provider and the browser, not
 * of one picture — and two doomed requests per image is a real wait for the user. Module-level
 * rather than stored: a fresh tab asks again, which is right if the provider ever turns it on.
 */
let directReadWorks: boolean | null = null;

/** For tests, and for a user who reloads after a provider change. */
export function resetDirectReadMemo(): void {
  directReadWorks = null;
}

export function directReadKnownBlocked(): boolean {
  return directReadWorks === false;
}

/**
 * Blob → `data:` URL.
 *
 * ⚠️ `FileReader` IS NOT EVERYWHERE. It is the right browser API and the fast path, but it is absent
 * in some runtimes — and a missing API is not a network problem. Falling back to the bytes keeps the
 * two apart, which matters because of what the caller does with the difference: a failed FETCH is
 * evidence that this browser may not read another site's pixels, and a failed CONVERSION is not.
 * Lumping them together would take one picture that could not be decoded and permanently route the
 * whole session through our relay.
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const mime = blob.type || 'image/png';
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('could not read the picture'));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

const wait = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/**
 * Fetch the picture from the browser, waiting out the provider's rate limit.
 *
 * ⚠️ THE URL IS NEVER CHANGED BETWEEN ATTEMPTS. The provider caches and bills by URL — the same link
 * returns the same picture and costs nothing extra — so retrying is free, and the user gets the
 * picture they waited for rather than a different one. Changing the seed to "try again" would be a
 * fresh generation wearing a retry's clothes.
 *
 * `onWait` is called with the milliseconds remaining so the screen can count down instead of just
 * sitting there — the blank-wait failure this repo has already root-caused once on the chat path.
 */
export async function fetchImageFromUser(
  t: ClientFetchTicket,
  opts: { onWait?: (msLeft: number) => void; signal?: AbortSignal } = {},
): Promise<ClientImageOutcome> {
  if (directReadWorks === false) return { needsRelay: true };

  const delays = imageRetryDelaysMs();
  let attempt = 0;
  let throws = 0;
  let budgetLeft = delays.reduce((a, b) => a + b, 0);

  for (;;) {
    if (opts.signal?.aborted) return { error: 'Cancelled.' };
    try {
      const res = await fetch(t.url, { signal: opts.signal });
      // 🔑 A RESOLVED RESPONSE IS THE PROOF, AND IT IS PROOF ON ITS OWN. This is a default-mode
      // (`cors`) request: when a site does not allow the read, the promise REJECTS — it does not
      // hand back an unreadable response. So reaching this line means this browser may read these
      // bytes, and nothing after it can un-prove that. Recording it here rather than after the
      // decode is what stops one undecodable picture from routing the whole session through our
      // relay.
      directReadWorks = true;
      if (res.ok) {
        const blob = await res.blob();
        if (!blob.size) throw new Error('empty');
        return { dataUrl: await blobToDataUrl(blob) };
      }
      if (!shouldRetryImageStatus(res.status) || attempt >= delays.length) {
        return { error: 'NavBharatAI’s engine could not make that image right now — please try again.' };
      }
    } catch (err) {
      if (opts.signal?.aborted) return { error: 'Cancelled.' };
      // 🔴 A THROW CARRIES NO STATUS. A blocked cross-origin read and a dropped connection look
      // identical to the page, so one retry covers the dropped connection and a second failure is
      // taken as "this browser cannot read these bytes". Retrying a refusal never succeeds and the
      // user would wait a full minute for nothing.
      // Only a FETCH that never produced a response can be a blocked read. Once `directReadWorks`
      // is true the response arrived, so a later throw is a decode problem and is reported as one.
      if (directReadWorks === true) {
        return { error: 'That picture could not be opened here — please try again.' };
      }
      throws += 1;
      if (throws >= DIRECT_FETCH_THROW_LIMIT) {
        directReadWorks = false;
        return { needsRelay: true };
      }
      void err;
    }
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    if (attempt > delays.length) {
      return { error: 'NavBharatAI’s engine is very busy — please try again in a minute.' };
    }
    const started = Date.now();
    const tick = setInterval(() => opts.onWait?.(Math.max(0, budgetLeft - (Date.now() - started))), 500);
    opts.onWait?.(budgetLeft);
    try {
      await wait(delay);
    } finally {
      clearInterval(tick);
    }
    budgetLeft = Math.max(0, budgetLeft - delay);
  }
}

/**
 * Ask our server for the bytes, for a link it signed itself.
 *
 * Used ONLY when the browser could not read them — on a button press, not on every picture — so the
 * address our server spends stays a small share of the traffic.
 */
export async function relayImage(
  t: ClientFetchTicket,
  headers: Record<string, string>,
): Promise<ClientImageOutcome> {
  try {
    const res = await fetch('/api/image/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ url: t.url, ticket: t.ticket, exp: t.exp }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.image !== 'string') {
      return { error: (data && typeof data.error === 'string' && data.error)
        || 'That picture could not be downloaded right now — please try again.' };
    }
    return { dataUrl: data.image };
  } catch {
    return { error: 'That picture could not be downloaded right now — please try again.' };
  }
}

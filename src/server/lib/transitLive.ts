// transitLive — REAL live transit data for the chat surfaces (admin 2026-08-25: "train kab hai, bus
// kaha milegi, flight kitna late hai … train ki live location bhi bata de").
//
// 🔒 THE HONESTY LINE THIS MODULE EXISTS TO HOLD. A web-search snippet can tell you a train's
// SCHEDULE; it cannot reliably tell you where the train is RIGHT NOW. Answering "live location" from
// snippets would be a guess dressed up as a fact — exactly what rule 2 forbids. So live position and
// live delay come ONLY from a real data feed, and that feed needs a key:
//
//   • Trains + PNR — RapidAPI (`RAPIDAPI_KEY`), the widely-used IRCTC API (irctc1.p.rapidapi.com):
//     live running status by train number, PNR status. The admin subscribes once (free tier exists).
//   • Flights — AeroDataBox on the SAME RapidAPI key (aerodatabox.p.rapidapi.com): status by flight
//     number. One key, two feeds.
//   • Buses — stated plainly: there is NO reliable pan-India live bus feed to integrate; bus questions
//     stay on the web-search path (timetables, operator pages), never a fake "live" answer.
//
// WITHOUT the key this module returns '' and the caller falls through to ordinary web search — the
// same honest degrade every env-gated feature here uses (RENDER_API_KEY, BRAVE_API_KEY, …).
//
// 🔒 THE FEED'S RESPONSE IS HANDED TO THE MODEL AS BOUNDED RAW DATA, NOT PARSED FIELDS. These
// marketplace APIs drift their shapes; a field-by-field parser would silently break and start
// answering with nothing. Bounded JSON stays true whatever the shape does — the model reads the real
// data and summarizes it, and if the data is thin the block says so. No provider/vendor name is ever
// put in the block (White-Label Law: the user sees NavBharatAI, not our suppliers).
//
// PURE detection + request builders (unit-tested); network wrapped with timeouts, never throws.

const TRANSIT_TIMEOUT_MS = 5_000;
/** Hard cap on the JSON handed to the model — live data, not a payload dump. */
export const TRANSIT_MAX_CHARS = 3_000;

export type TransitQuery =
  | { kind: 'train'; trainNo: string }
  | { kind: 'pnr'; pnr: string }
  | { kind: 'flight'; flightNo: string };

/** Known Indian airline IATA prefixes, so "AI 101" is a flight even without the word "flight". */
const AIRLINE_PREFIX = /(?:AI|6E|UK|IX|SG|QP|G8|I5|9I|S5)/;

/**
 * What live feed, if any, can answer this message? PURE.
 *
 * Deliberately conservative: a 5-digit number is a train number only in a train-ish sentence, a
 * 10-digit number is a PNR only next to the word PNR — because chat is full of numbers that are
 * neither, and a wrong live-status call is latency spent answering a question nobody asked.
 */
export function detectTransitQuery(message: string): TransitQuery | null {
  const m = String(message ?? '');
  const pnr = m.match(/\bpnr\D{0,12}(\d{10})\b/i) ?? m.match(/\b(\d{10})\b\D{0,12}pnr/i);
  if (pnr) return { kind: 'pnr', pnr: pnr[1] };
  if (/\b(train|rail|irctc|gadi|gaadi|ट्रेन|रेल)\b/i.test(m)) {
    const no = m.match(/\b(\d{5})\b/);
    if (no) return { kind: 'train', trainNo: no[1] };
  }
  const flight = m.match(new RegExp(`\\b(${AIRLINE_PREFIX.source})[ -]?(\\d{2,4})\\b`, 'i'));
  if (flight && (/\b(flight|udaan|फ्लाइट|उड़ान|airport|plane)\b/i.test(m) || new RegExp(`^${AIRLINE_PREFIX.source}$`).test(flight[1].toUpperCase()))) {
    return { kind: 'flight', flightNo: `${flight[1].toUpperCase()}${flight[2]}` };
  }
  return null;
}

export interface TransitRequest { url: string; headers: Record<string, string>; }

/** Build the exact request for a transit query. PURE, so the shapes are pinned by tests. */
export function buildTransitRequest(q: TransitQuery, rapidApiKey: string, now: Date = new Date()): TransitRequest {
  const keyHeaders = (host: string) => ({ 'X-RapidAPI-Key': rapidApiKey, 'X-RapidAPI-Host': host });
  switch (q.kind) {
    case 'train':
      return {
        url: `https://irctc1.p.rapidapi.com/api/v1/liveTrainStatus?trainNo=${encodeURIComponent(q.trainNo)}&startDay=0`,
        headers: keyHeaders('irctc1.p.rapidapi.com'),
      };
    case 'pnr':
      return {
        url: `https://irctc1.p.rapidapi.com/api/v3/getPNRStatus?pnrNumber=${encodeURIComponent(q.pnr)}`,
        headers: keyHeaders('irctc1.p.rapidapi.com'),
      };
    case 'flight': {
      const day = now.toISOString().slice(0, 10);
      return {
        url: `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(q.flightNo)}/${day}`,
        headers: keyHeaders('aerodatabox.p.rapidapi.com'),
      };
    }
  }
}

/** The one line the model needs about where the OFFICIAL truth lives, per query kind. PURE. */
export function officialSourceNote(kind: TransitQuery['kind']): string {
  switch (kind) {
    case 'train': return 'Official source for Indian train running status: enquiry.indianrail.gov.in (NTES).';
    case 'pnr': return 'Official source for PNR status: the IRCTC website/app.';
    case 'flight': return "Official source for flight status: the airline's own site/app or the airport's live board.";
  }
}

/**
 * Fetch live transit data for a message, or '' when it does not apply / no key / the feed failed.
 * Never throws; every failure degrades to '' so the caller's web-search fallback runs instead.
 */
export async function liveTransitContext(
  message: string,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: Date; timeoutMs?: number } = {},
): Promise<string> {
  const q = detectTransitQuery(message);
  if (!q) return '';
  const key = String((opts.env ?? process.env).RAPIDAPI_KEY ?? '').trim();
  if (!key) return '';
  const req = buildTransitRequest(q, key, opts.now ?? new Date());
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TRANSIT_TIMEOUT_MS);
  try {
    const res = await doFetch(req.url, { headers: req.headers, signal: controller.signal });
    if (!res.ok) return '';
    const data = await res.json().catch(() => null);
    if (data === null || data === undefined) return '';
    const raw = JSON.stringify(data);
    // An empty-ish body is a non-answer, not grounding — fall through to search rather than hand the
    // model two braces and call it live data.
    if (raw.length < 20) return '';
    const bounded = raw.length > TRANSIT_MAX_CHARS ? `${raw.slice(0, TRANSIT_MAX_CHARS)}…(truncated)` : raw;
    const when = (opts.now ?? new Date()).toISOString();
    return `LIVE TRANSIT DATA (fetched just now, ${when}):
${bounded}

Use this CURRENT data as your PRIMARY source — summarize it plainly for the user (position/delay/times), never dump raw JSON at them. If a field the user asked about is missing from this data, say so honestly. ${officialSourceNote(q.kind)} Do not mention the data feed or that a lookup ran unless the user asks.`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

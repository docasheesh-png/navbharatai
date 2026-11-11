// ONE WhatsApp share link for a published app or an APK the person just built.
//
// Owner request (2026-11-11): a "WhatsApp पर भेजें" button that opens
// https://wa.me/?text=<encoded Hindi message + app URL>, and the APK link only
// when a real public one exists. The Hindi is the message the recipient reads
// in WhatsApp — that is the channel's language — and the visible control also
// carries an English line ("Send on WhatsApp") so the button is readable
// outside Devanagari. No new dependency: wa.me is a normal link.
//
// 🔒 WHAT IS NEVER PUT IN THE MESSAGE. A download ticket, an /api/ path, or a
// non-https URL. Those are either a credential (the App Mart APK ticket is
// signed for one signed-in person and expires) or not a page a friend can open.
// When there is no public link, the message asks the sender to attach the file
// they already downloaded. It does not invent a URL.

export const WHATSAPP_SHARE_LABEL = 'WhatsApp पर भेजें';
export const WHATSAPP_SHARE_LABEL_EN = 'Send on WhatsApp';

const HOME = 'https://navbharatai.com';

export interface WhatsAppShareInput {
  /** Public https page for the app (published site, or /store/app/<id>). */
  appUrl?: string;
  appName?: string;
  /** Public https URL of an APK file. Auth tickets and /api/ paths are dropped. */
  apkUrl?: string;
}

/** A URL a stranger can open. https only, and never an API or a signed ticket. */
export function publicShareUrl(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let u: URL;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';
  if (u.pathname.startsWith('/api/')) return '';
  const q = u.searchParams;
  if (q.has('sig') || q.has('exp') || q.has('token') || q.has('ticket')) return '';
  return u.toString();
}

/** The Hindi text WhatsApp will pre-fill. PURE. */
export function whatsappShareMessage(input: WhatsAppShareInput): string {
  const name = String(input.appName ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const appUrl = publicShareUrl(input.appUrl);
  const apkUrl = publicShareUrl(input.apkUrl);
  const who = name
    ? `मैंने «${name}» ऐप बनाया है — NavBharatAI पर, बिना coding के।`
    : 'मैंने अपना ऐप बनाया है — NavBharatAI पर, बिना coding के।';
  const lines = [who];
  if (appUrl) lines.push(`यहाँ खोलें: ${appUrl}`);
  if (apkUrl && apkUrl !== appUrl) lines.push(`Android APK: ${apkUrl}`);
  if (!appUrl && !apkUrl) lines.push('APK डाउनलोड करके इसी चैट में अटैच करके भेजें।');
  lines.push(`आप भी अपना ऐप 2 मिनट में बना सकते हैं: ${HOME}`);
  return lines.join('\n');
}

/**
 * The wa.me link, or '' when there is nothing honest to send (no name and no
 * public URL). A name alone is enough: the sender attaches the APK by hand.
 */
export function whatsappShareHref(input: WhatsAppShareInput): string {
  const name = String(input.appName ?? '').trim();
  const appUrl = publicShareUrl(input.appUrl);
  const apkUrl = publicShareUrl(input.apkUrl);
  if (!name && !appUrl && !apkUrl) return '';
  return `https://wa.me/?text=${encodeURIComponent(whatsappShareMessage(input))}`;
}

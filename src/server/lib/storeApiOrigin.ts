// WHERE A STORE APP REACHES NAVBHARATAI'S API FROM (online Royale, 2026-11-25).
//
// A store app runs in a srcdoc iframe, so its document.baseURI is the PARENT page's URL. On the web that is
// navbharatai.com and a same-origin address works; in the bundled Android/iOS shell the parent is the local shell
// (`localhost`), so an address built from it dials the phone itself — the exact class tests/webSocketSingleSource
// .test.ts guards for NavBharatAI's own sockets (admin report 2026-08-13, Sonic on phones). The kit's socket cannot
// import lib/apiBase, so the server tells the page its real API origin at serve time: the host THIS request reached,
// which is the API host whether the caller is the website or the app.
//
// PURE. The value goes into a <script>, so only a strict scheme://host[:port] shape is ever written.

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;

export function storeApiOrigin(headers: Record<string, string | string[] | undefined>, protocol?: string): string | null {
  const host = String(headers.host ?? '').trim();
  const protoRaw = String(headers['x-forwarded-proto'] ?? protocol ?? 'https').split(',')[0].trim().toLowerCase();
  const proto = protoRaw === 'http' ? 'http' : 'https';
  const origin = proto + '://' + host;
  return host && ORIGIN.test(origin) ? origin : null;
}

/** Added per response (never to the shared compiled-player cache). No valid origin ⇒ the page is unchanged. */
export function withApiOrigin(html: string, origin: string | null): string {
  if (!origin || !ORIGIN.test(origin)) return html;
  const tag = '<script>window.__NBAI_API_ORIGIN=' + JSON.stringify(origin) + ';</script>';
  return html.includes('<body>') ? html.replace('<body>', '<body>' + tag) : tag + html;
}

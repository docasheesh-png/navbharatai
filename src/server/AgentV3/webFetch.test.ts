import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  htmlToText,
  isReadableContentType,
  capText,
  formatWebFetchResult,
  webFetchUrl,
  WEB_FETCH_MAX_CHARS,
} from './webFetch';

describe('htmlToText — the model needs the words, not the markup', () => {
  it('strips tags and keeps the prose', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  // THE ONE THAT MATTERS: a minified bundle inside <script> would otherwise swamp the real text and eat
  // the whole character budget, so a page's actual content would be truncated away by its own JavaScript.
  it('drops script/style/noscript/svg BODIES, not just their tags', () => {
    const html = '<style>.a{color:red}</style><script>var x=1;alert("hi")</script><p>Real text</p><svg><path d="M0 0"/></svg>';
    const out = htmlToText(html);
    expect(out).toBe('Real text');
    for (const leak of ['color:red', 'var x', 'alert', 'M0 0']) expect(out).not.toContain(leak);
  });

  it('turns block ends and <br> into newlines so headings do not run into paragraphs', () => {
    expect(htmlToText('<h1>Title</h1><p>Body</p>')).toBe('Title\nBody');
    expect(htmlToText('<p>a<br>b</p>')).toBe('a\nb');
  });

  it('decodes the common entities and collapses runaway whitespace', () => {
    expect(htmlToText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
    expect(htmlToText('<p>x</p>\n\n\n\n<p>y</p>')).toBe('x\n\ny');
  });

  it('drops comments (they are not page text)', () => {
    expect(htmlToText('<!-- hidden note --><p>shown</p>')).toBe('shown');
  });
});

describe('isReadableContentType — refuse what we cannot read, never guess at it', () => {
  it('accepts text and the structured text types', () => {
    for (const t of ['text/html; charset=utf-8', 'text/plain', 'application/json', 'application/xml', 'application/ld+json']) {
      expect(isReadableContentType(t), t).toBe(true);
    }
  });

  it('refuses binary — a PDF or an image is a job for another tool', () => {
    for (const t of ['image/png', 'application/pdf', 'video/mp4', 'application/octet-stream', 'font/woff2']) {
      expect(isReadableContentType(t), t).toBe(false);
    }
  });

  it('a MISSING content-type is attempted, not refused (many plain servers omit it)', () => {
    expect(isReadableContentType(null)).toBe(true);
    expect(isReadableContentType(undefined)).toBe(true);
    expect(isReadableContentType('')).toBe(true);
  });
});

describe('capText — half a page must never be handed over as if it were whole', () => {
  it('leaves a short page alone', () => {
    expect(capText('short')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts an over-long page AND reports that it cut it', () => {
    const r = capText('x'.repeat(WEB_FETCH_MAX_CHARS + 500));
    expect(r.text).toHaveLength(WEB_FETCH_MAX_CHARS);
    expect(r.truncated).toBe(true);
  });

  it('the boundary is inclusive — exactly the cap is not a truncation', () => {
    expect(capText('x'.repeat(WEB_FETCH_MAX_CHARS)).truncated).toBe(false);
  });
});

describe('formatWebFetchResult — success reads plainly, failure THROWS like every other tool', () => {
  it('labels the source and returns the text', () => {
    const out = formatWebFetchResult('https://example.com', { ok: true, text: 'Body', status: 200 });
    expect(out).toContain('https://example.com');
    expect(out).toContain('HTTP 200');
    expect(out).toContain('Body');
    expect(out).not.toContain('Truncated');
  });

  it('says so when the page was cut, rather than implying the model saw all of it', () => {
    const out = formatWebFetchResult('https://example.com', { ok: true, text: 'Body', truncated: true });
    expect(out).toContain('not all of it');
  });

  it('throws the honest reason on failure (a returned string would read as SUCCESS to the agent)', () => {
    expect(() => formatWebFetchResult('https://x.test', { ok: false, text: '', reason: 'The site returned HTTP 404.' }))
      .toThrow('HTTP 404');
  });
});

// 🔒 The SSRF surface. These run through the REAL guard (no mock of assertPublicHttpUrl) — mocking the
// thing under test would prove nothing. `fetch` is stubbed and asserted NEVER to be called, because the
// bug worth preventing is the server making the request at all, not what it does with the answer.
describe('webFetchUrl — a server-side fetcher of a user-chosen URL is the textbook SSRF shape', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // A PUBLIC IP LITERAL, deliberately: assertPublicHttpUrl classifies an IP directly and never touches
  // DNS, so the success-path tests below are hermetic. Using a hostname made them depend on the runner
  // resolving it — `api.example.com` does not resolve, which is exactly how this was caught.
  const PUBLIC = 'https://93.184.216.34/';

  function stubFetch() {
    const spy = vi.fn(async () => new Response('should never be reached', { status: 200, headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('refuses loopback, private ranges, and the cloud metadata endpoint — WITHOUT issuing the request', async () => {
    const spy = stubFetch();
    for (const url of [
      'http://localhost:3000/admin',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',   // AWS/GCP metadata — the classic prize
      'http://metadata.google.internal/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.9/',
      'http://[::1]/',
    ]) {
      const r = await webFetchUrl(url);
      expect(r.ok, url).toBe(false);
      expect(r.text, url).toBe('');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses non-http schemes — file:// would read the server\'s own disk', async () => {
    const spy = stubFetch();
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'data:text/html,<b>x</b>']) {
      expect((await webFetchUrl(url)).ok, url).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a malformed URL instead of throwing (the agent must get a sentence, not a stack)', async () => {
    stubFetch();
    const r = await webFetchUrl('not a url');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("asks fetch for redirect:'error' — a public URL is allowed to 302 to a private one", async () => {
    const spy = vi.fn(async () => new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', spy);
    const r = await webFetchUrl(PUBLIC);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'error' });
  });

  it('a redirect rejection becomes advice, not a raw error string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unexpected redirect'); }));
    const r = await webFetchUrl(PUBLIC);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/final URL/i);
  });

  it('a timeout is reported as a timeout, in seconds a person can read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('This operation was aborted'); }));
    const r = await webFetchUrl(PUBLIC);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not respond/i);
  });

  it('an HTTP error is surfaced with its status, not silently treated as an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403, headers: { 'content-type': 'text/html' } })));
    const r = await webFetchUrl(PUBLIC);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toContain('403');
  });

  it('a binary response is refused and points at the right tool instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })));
    const r = await webFetchUrl(`${PUBLIC}doc.pdf`);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/screenshot/i);
  });

  it('a JS-only page (no text) says so and suggests the screenshot tool — not a bare empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body><div id="root"></div><script>boot()</script></body></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const r = await webFetchUrl(`${PUBLIC}app`);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/JavaScript/i);
  });

  it('a real HTML page comes back as readable text with the markup gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><style>b{}</style></head><body><h1>Config</h1><p>Set <code>server.host</code> to true.</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )));
    const r = await webFetchUrl(`${PUBLIC}config`);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Config');
    expect(r.text).toContain('server.host');
    expect(r.text).not.toContain('<h1>');
  });

  it('plain text and JSON are passed through untouched (no HTML mangling of a JSON body)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a": "<b>", "n": 1}', { status: 200, headers: { 'content-type': 'application/json' } })));
    const r = await webFetchUrl(`${PUBLIC}x.json`);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"a": "<b>", "n": 1}');
  });

  it('an over-long page is truncated and FLAGGED as truncated', async () => {
    const long = `<p>${'word '.repeat(20_000)}</p>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(long, { status: 200, headers: { 'content-type': 'text/html' } })));
    const r = await webFetchUrl(`${PUBLIC}long`);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(WEB_FETCH_MAX_CHARS);
  });

  it('never sends cookies or the caller\'s credentials', async () => {
    const spy = vi.fn(async () => new Response('<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', spy);
    await webFetchUrl(PUBLIC);
    const opts = (spy.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(opts.credentials).toBeUndefined();
    expect(Object.keys(opts.headers as object)).not.toContain('cookie');
  });
});

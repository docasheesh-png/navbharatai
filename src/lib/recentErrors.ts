// THE LAST FEW THINGS THAT WENT WRONG IN THIS TAB.
//
// ADMIN 2026-09-12: a user reported "App is not responsive and sometimes it does not work" and there
// was nothing to act on. If the app had thrown, the browser knew — and we threw that away. Twenty
// lines of ring buffer turn "it doesn't work" into a stack-free error message with a place in it.
//
// 🔒 WHY THIS IS NOT A LOGGING SYSTEM, and must not become one. Nothing here is sent anywhere on its
// own. The buffer sits in memory, is capped, is never written to storage, and leaves the device ONLY
// when a signed-in user deliberately presses Send on a report about their own session. An always-on
// error pipeline would be a different product with a different consent question behind it; this is the
// user handing us the note they are already trying to write.

/** Small enough that one bad render cannot push out the error that started it. */
const MAX_ENTRIES = 8;

/** A message, not a novel. Long enough to name the fault, short enough not to carry a payload. */
const MAX_LENGTH = 200;

let entries: string[] = [];

/** Newest last, so it reads like a timeline. Returns a copy — callers must not edit the buffer. */
export function recentErrors(): string[] {
  return [...entries];
}

export function clearRecentErrors(): void {
  entries = [];
}

/**
 * Record one fault. PURE-ish: bounded, de-duplicated against the immediately previous entry so a
 * render loop throwing the same error 200 times does not evict everything that came before it.
 */
export function noteError(message: unknown, where?: unknown): void {
  const text = typeof message === 'string'
    ? message
    : message instanceof Error
      ? `${message.name}: ${message.message}`
      : (() => { try { return String(message); } catch { return ''; } })();
  const place = typeof where === 'string' ? where.trim() : '';
  const line = `${text.trim()}${place ? ` @ ${place}` : ''}`.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  if (!line) return;
  if (entries[entries.length - 1] === line) return;
  entries.push(line);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
}

/** The bits of `window` this needs, so a test can pass a plain object. */
export interface ErrorCaptureTarget {
  addEventListener(type: string, handler: (e: unknown) => void): void;
  removeEventListener?(type: string, handler: (e: unknown) => void): void;
}

/**
 * Start listening. Returns a stop function. Safe to call twice — the second call is a no-op rather
 * than a second listener, because double-recording every error would halve the buffer's real depth.
 */
let installed = false;
export function installErrorCapture(target: ErrorCaptureTarget | null | undefined): () => void {
  if (!target || typeof target.addEventListener !== 'function' || installed) return () => {};
  installed = true;

  const onError = (e: unknown) => {
    const ev = (e || {}) as { message?: unknown; filename?: unknown; lineno?: unknown };
    const file = typeof ev.filename === 'string' ? ev.filename.split('/').pop() || '' : '';
    const at = file && Number.isFinite(Number(ev.lineno)) ? `${file}:${ev.lineno}` : file;
    noteError(ev.message ?? 'Script error', at);
  };
  const onRejection = (e: unknown) => {
    const ev = (e || {}) as { reason?: unknown };
    const r = ev.reason as { message?: unknown } | undefined;
    noteError(
      typeof r === 'object' && r && typeof r.message === 'string' ? r.message : ev.reason ?? 'Promise rejected',
      'unhandled promise',
    );
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    installed = false;
    target.removeEventListener?.('error', onError);
    target.removeEventListener?.('unhandledrejection', onRejection);
  };
}

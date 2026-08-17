// DOES THIS MAIL PASSWORD ACTUALLY WORK? — a real SMTP login, sending nothing (admin 2026-08-17, slice 5).
//
// Slice 3 left this as a recorded open item: every other credential could be checked with an HTTPS read,
// and SMTP could not, so mail credentials were reported honestly as "saved but not checked". That gap
// matters more than it looks. The commonest mail credential a NavBharatAI user pastes is a Gmail app
// password, and the commonest mistake is pasting their ORDINARY Google password instead — which Google
// rejects at login with no other symptom. The app builds, the preview renders, and the first time anybody
// finds out is when a real user never receives their signup email.
//
// ── WHY THIS EXISTS RATHER THAN A DEPENDENCY ────────────────────────────────────────────────────────
// The obvious implementation is nodemailer's `verify()`. nodemailer is NOT a dependency of this server
// (it appears only in the apps we GENERATE), and adding a mail library to the platform to send zero mail
// is a supply-chain surface bought for nothing. SMTP's login handshake is a short line protocol over TLS,
// and Node ships `tls` — so this speaks it directly.
//
// ── IT SENDS NOTHING. EVER. ─────────────────────────────────────────────────────────────────────────
// The conversation stops at AUTH. There is no MAIL FROM, no RCPT TO, no DATA — the three commands that
// would actually put a message into the world. A probe that "just sent a test mail to yourself" would be
// a probe that can spam somebody's real inbox from their own domain, and on a metered provider it would
// cost them money. This one asks the server "would you let me in?", is told yes or no, and hangs up.
//
// ── HONEST VERDICTS (the same rule as credentialProbe) ──────────────────────────────────────────────
// Only the server's own explicit rejection — a 535-class auth failure — means the credential is wrong.
// A connection refused, a TLS failure, a timeout, or any other code is "we could not tell". A user whose
// office network blocks port 587 must not be told their password is invalid.

import { connect as tlsConnect, type TLSSocket } from 'tls';
import { Socket } from 'net';

/** How long the whole handshake may take before we give up and report that we could not tell. */
export const SMTP_PROBE_TIMEOUT_MS = 8_000;

export type SmtpProbeStatus = 'working' | 'rejected' | 'unreachable';

export interface SmtpProbeResult {
  status: SmtpProbeStatus;
  /** For server logs and the admin report only — never shown to the user, never a credential. */
  detail?: string;
}

/**
 * The reply code of an SMTP line, or null when the line is a continuation.
 *
 * SMTP multi-line replies mark every line but the last with a hyphen (`250-STARTTLS` … `250 HELP`), so
 * a naive "first three digits" read would act on a reply the server has not finished sending. PURE.
 */
export function finalReplyCode(line: string): number | null {
  const m = /^(\d{3})(?:\s|$)/.exec(String(line ?? '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * What one SMTP reply code means for the credential.
 *
 * 235 is the only success. The 535/534/530-class codes are the server saying the login itself failed —
 * the one case where we may tell a user their password is wrong. Everything else is unknown: a 421 is
 * the server being too busy, a 454 is a temporary TLS problem, and neither is a verdict on their
 * password. PURE.
 */
export function authCodeMeaning(code: number): SmtpProbeStatus {
  if (code === 235) return 'working';
  // 535 bad credentials · 534/538 a method the account needs (Gmail says this for a non-app password)
  // · 530 authentication required but what was offered was not accepted.
  if (code === 535 || code === 534 || code === 538 || code === 530) return 'rejected';
  return 'unreachable';
}

/** Port 465 speaks TLS from the first byte; 587/25 start in the clear and upgrade with STARTTLS. PURE. */
export function usesImplicitTls(port: number): boolean {
  return port === 465;
}

/**
 * The port to use for a host, given whatever the user saved.
 *
 * `SMTP_PORT` is frequently absent — our own recipe tells people to save only host, user and password —
 * so the default has to be right rather than merely present. 587 (submission + STARTTLS) is what every
 * provider in the recipe catalogue documents. PURE.
 */
export function resolvePort(raw: string | number | null | undefined): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 587;
}

/** A minimal duplex the probe can drive. Injected so the protocol logic is testable without a network. */
export interface SmtpChannel {
  write(data: string): void;
  /** Resolves with the next FINAL reply line (continuations are absorbed), or rejects on failure. */
  readReply(): Promise<string>;
  /** Upgrade an in-the-clear connection to TLS after STARTTLS. */
  upgradeTls(): Promise<void>;
  end(): void;
}

/**
 * The login conversation, with no transport in it.
 *
 * Extracted whole because this is where the real decisions live — when to upgrade, which codes mean
 * what, when to stop — and because a protocol driven only through a live socket is a protocol that only
 * gets tested by pointing it at somebody's mail server.
 */
export async function runSmtpLogin(
  ch: SmtpChannel,
  opts: { host: string; user: string; pass: string; implicitTls: boolean },
): Promise<SmtpProbeResult> {
  const expect = async (allowed: number[], what: string): Promise<number | SmtpProbeResult> => {
    const code = finalReplyCode(await ch.readReply());
    if (code === null) return { status: 'unreachable', detail: `${what}: unparseable reply` };
    if (!allowed.includes(code)) return { status: 'unreachable', detail: `${what}: ${code}` };
    return code;
  };

  const greeting = await expect([220], 'greeting');
  if (typeof greeting !== 'number') return greeting;

  ch.write(`EHLO navbharatai\r\n`);
  const ehlo = await expect([250], 'ehlo');
  if (typeof ehlo !== 'number') return ehlo;

  if (!opts.implicitTls) {
    // NEVER send credentials in the clear. If the server will not upgrade, we stop and report that we
    // could not check — we do not fall back to a plaintext AUTH to get an answer.
    ch.write('STARTTLS\r\n');
    const starttls = await expect([220], 'starttls');
    if (typeof starttls !== 'number') return starttls;
    await ch.upgradeTls();
    ch.write(`EHLO navbharatai\r\n`);
    const ehlo2 = await expect([250], 'ehlo-tls');
    if (typeof ehlo2 !== 'number') return ehlo2;
  }

  ch.write('AUTH LOGIN\r\n');
  const authStart = await expect([334], 'auth-login');
  if (typeof authStart !== 'number') return authStart;

  ch.write(`${Buffer.from(opts.user).toString('base64')}\r\n`);
  const userStep = await expect([334, 535, 534, 538, 530], 'auth-user');
  if (typeof userStep !== 'number') return userStep;
  if (userStep !== 334) return { status: authCodeMeaning(userStep), detail: `auth-user: ${userStep}` };

  ch.write(`${Buffer.from(opts.pass).toString('base64')}\r\n`);
  const code = finalReplyCode(await ch.readReply());
  if (code === null) return { status: 'unreachable', detail: 'auth-pass: unparseable reply' };
  return { status: authCodeMeaning(code), detail: `auth-pass: ${code}` };
}

/** Open a real channel, run the login, and hang up — whatever happens. */
export async function probeSmtp(
  host: string,
  port: number,
  user: string,
  pass: string,
  timeoutMs = SMTP_PROBE_TIMEOUT_MS,
): Promise<SmtpProbeResult> {
  const h = String(host ?? '').trim();
  if (!h || !user || !pass) return { status: 'unreachable', detail: 'incomplete credentials' };

  let channel: (SmtpChannel & { destroy(): void }) | null = null;
  try {
    channel = await openChannel(h, port, timeoutMs);
    const result = await Promise.race([
      runSmtpLogin(channel, { host: h, user, pass, implicitTls: usesImplicitTls(port) }),
      new Promise<SmtpProbeResult>((resolve) => {
        const t = setTimeout(() => resolve({ status: 'unreachable', detail: 'timeout' }), timeoutMs);
        if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
      }),
    ]);
    try { channel.write('QUIT\r\n'); } catch { /* best-effort courtesy to the server */ }
    return result;
  } catch (e) {
    // Their network, our network, a blocked port — all "we could not tell", never "your password is wrong".
    return { status: 'unreachable', detail: (e as { code?: string; name?: string } | null)?.code || (e as { name?: string } | null)?.name || 'connect-failed' };
  } finally {
    try { channel?.destroy(); } catch { /* already gone */ }
  }
}

/** The real socket, wrapped in the tiny interface `runSmtpLogin` drives. */
function openChannel(host: string, port: number, timeoutMs: number): Promise<SmtpChannel & { destroy(): void }> {
  return new Promise((resolve, reject) => {
    const implicit = usesImplicitTls(port);
    let sock: Socket | TLSSocket = implicit
      ? tlsConnect({ host, port, servername: host })
      : new Socket();

    let buffer = '';
    let waiter: ((line: string) => void) | null = null;
    let failer: ((e: Error) => void) | null = null;

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8');
      // Deliver only when a FINAL line has arrived (`250 x`, not `250-x`) — see finalReplyCode.
      const lines = buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3}[ ]/.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const line = lines[i];
          buffer = lines.slice(i + 1).join('\n');
          const w = waiter; waiter = null; failer = null;
          if (w) w(line);
          return;
        }
      }
    };
    const onErr = (e: Error) => { const f = failer; waiter = null; failer = null; if (f) f(e); else reject(e); };

    const attach = () => { sock.on('data', onData); sock.on('error', onErr); };

    const channel: SmtpChannel & { destroy(): void } = {
      write: (data) => { sock.write(data); },
      readReply: () => new Promise<string>((res, rej) => {
        waiter = res; failer = rej;
        const t = setTimeout(() => { if (waiter === res) { waiter = null; failer = null; rej(new Error('reply-timeout')); } }, timeoutMs);
        if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
      }),
      upgradeTls: () => new Promise<void>((res, rej) => {
        sock.removeListener('data', onData);
        sock.removeListener('error', onErr);
        const upgraded = tlsConnect({ socket: sock as Socket, servername: host }, () => { sock = upgraded; attach(); res(); });
        upgraded.once('error', rej);
      }),
      end: () => { try { sock.end(); } catch { /* already closed */ } },
      destroy: () => { try { sock.destroy(); } catch { /* already closed */ } },
    };

    if (implicit) {
      (sock as TLSSocket).once('secureConnect', () => { attach(); resolve(channel); });
      sock.once('error', reject);
    } else {
      (sock as Socket).setTimeout(timeoutMs);
      (sock as Socket).once('timeout', () => reject(new Error('connect-timeout')));
      (sock as Socket).connect(port, host, () => { attach(); resolve(channel); });
      sock.once('error', reject);
    }
  });
}

import { describe, it, expect } from 'vitest';
import {
  runSmtpLogin, finalReplyCode, authCodeMeaning, usesImplicitTls, resolvePort,
  probeSmtp, type SmtpChannel,
} from './smtpProbe';

/** A scripted mail server: hands back queued replies and records every command it was sent. */
function fakeServer(replies: string[]) {
  const sent: string[] = [];
  let i = 0;
  let upgraded = false;
  const ch: SmtpChannel = {
    write: (d) => { sent.push(d.trim()); },
    readReply: async () => {
      if (i >= replies.length) throw new Error('no more replies');
      return replies[i++];
    },
    upgradeTls: async () => { upgraded = true; sent.push('<TLS>'); },
    end: () => {},
  };
  return { ch, sent, wasUpgraded: () => upgraded };
}

// Final lines ONLY — that is the contract `SmtpChannel.readReply` promises (the real transport absorbs
// `250-STARTTLS` continuations and hands over just the closing `250 ok`), so the fake must promise it too.
const OK_TO_AUTH = ['220 ready', '250 ok', '220 go ahead', '250 ok', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6'];
const opts = { host: 'smtp.gmail.com', user: 'a@b.com', pass: 'secret', implicitTls: false };

describe('IT NEVER SENDS MAIL — the property that makes this probe safe at all', () => {
  it('issues no MAIL FROM, no RCPT TO and no DATA', async () => {
    const { ch, sent } = fakeServer([...OK_TO_AUTH, '235 accepted']);
    await runSmtpLogin(ch, opts);
    const blob = sent.join(' ').toUpperCase();
    for (const forbidden of ['MAIL FROM', 'RCPT TO', 'DATA', 'BDAT', 'SEND ']) {
      expect(blob, `probe issued ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('stops at AUTH — the conversation ends once the server answers', async () => {
    const { ch, sent } = fakeServer([...OK_TO_AUTH, '235 accepted']);
    await runSmtpLogin(ch, opts);
    expect(sent.filter((s) => s.startsWith('EHLO')).length).toBe(2); // once plain, once after TLS
    expect(sent).toContain('AUTH LOGIN');
  });
});

describe('credentials never cross the wire in the clear', () => {
  it('upgrades to TLS before AUTH on a submission port', async () => {
    const { ch, sent, wasUpgraded } = fakeServer([...OK_TO_AUTH, '235 ok']);
    await runSmtpLogin(ch, opts);
    expect(wasUpgraded()).toBe(true);
    expect(sent.indexOf('<TLS>')).toBeLessThan(sent.indexOf('AUTH LOGIN'));
  });

  it('REFUSES to authenticate when the server will not upgrade — no plaintext fallback', async () => {
    // A server that rejects STARTTLS is a server we do not log into. Falling back to get an answer
    // would put a real mail password on the wire in the clear.
    const { ch, sent } = fakeServer(['220 ready', '250 ok', '454 TLS not available']);
    const r = await runSmtpLogin(ch, opts);
    expect(r.status).toBe('unreachable');
    expect(sent).not.toContain('AUTH LOGIN');
  });

  it('skips STARTTLS on port 465, which is already encrypted', async () => {
    const { ch, sent, wasUpgraded } = fakeServer(['220 ready', '250 ok', '334 u', '334 p', '235 ok']);
    const r = await runSmtpLogin(ch, { ...opts, implicitTls: true });
    expect(r.status).toBe('working');
    expect(wasUpgraded()).toBe(false);
    expect(sent).not.toContain('STARTTLS');
  });
});

describe('honest verdicts — only the server may call a password wrong', () => {
  it('235 is the only success', async () => {
    const { ch } = fakeServer([...OK_TO_AUTH, '235 2.7.0 Accepted']);
    expect((await runSmtpLogin(ch, opts)).status).toBe('working');
  });

  it('a real auth failure is reported as rejected', async () => {
    for (const code of ['535 5.7.8 Username and Password not accepted', '534 5.7.9 Application-specific password required', '538 x', '530 x']) {
      const { ch } = fakeServer([...OK_TO_AUTH, code]);
      expect((await runSmtpLogin(ch, opts)).status, code).toBe('rejected');
    }
  });

  it('a BUSY or broken server is never a verdict on the password', async () => {
    for (const code of ['421 too many connections', '451 temporary failure', '454 x', '500 x']) {
      const { ch } = fakeServer([...OK_TO_AUTH, code]);
      expect((await runSmtpLogin(ch, opts)).status, code).toBe('unreachable');
    }
  });

  it('a rejection at the USERNAME step is still a rejection, not a protocol error', async () => {
    // Gmail answers 534 right after the username when the account needs an app password — the single
    // most common real failure for our users, and it must not be reported as "could not check".
    const { ch } = fakeServer(['220 ready', '250 ok', '220 go', '250 ok', '334 u', '534 5.7.9 Application-specific password required']);
    expect((await runSmtpLogin(ch, opts)).status).toBe('rejected');
  });

  it('an unparseable or truncated conversation is unknown, never a rejection', async () => {
    const { ch } = fakeServer(['garbage']);
    expect((await runSmtpLogin(ch, opts)).status).toBe('unreachable');
    const dead = fakeServer([]);
    await expect(runSmtpLogin(dead.ch, opts)).rejects.toBeTruthy(); // the transport wrapper catches this
  });
});

describe('the reply parser', () => {
  it('acts only on a FINAL line, never on a continuation', () => {
    expect(finalReplyCode('250 OK')).toBe(250);
    expect(finalReplyCode('250')).toBe(250);
    expect(finalReplyCode('250-STARTTLS')).toBeNull();  // multi-line reply is not finished
    expect(finalReplyCode('')).toBeNull();
    expect(finalReplyCode('hello')).toBeNull();
  });

  it('maps codes the way the honesty rule requires', () => {
    expect(authCodeMeaning(235)).toBe('working');
    expect(authCodeMeaning(535)).toBe('rejected');
    expect(authCodeMeaning(421)).toBe('unreachable');
    expect(authCodeMeaning(250)).toBe('unreachable');
  });
});

describe('port handling', () => {
  it('defaults to submission, because our own recipe does not ask for a port', () => {
    expect(resolvePort(undefined)).toBe(587);
    expect(resolvePort('')).toBe(587);
    expect(resolvePort('not-a-port')).toBe(587);
    expect(resolvePort(0)).toBe(587);
    expect(resolvePort(99999)).toBe(587);
    expect(resolvePort('465')).toBe(465);
    expect(resolvePort(2525)).toBe(2525);
  });

  it('knows which port is encrypted from the first byte', () => {
    expect(usesImplicitTls(465)).toBe(true);
    expect(usesImplicitTls(587)).toBe(false);
    expect(usesImplicitTls(25)).toBe(false);
  });
});

describe('probeSmtp never throws and never guesses', () => {
  it('reports incomplete credentials as unknown rather than attempting a connection', async () => {
    expect((await probeSmtp('', 587, 'u', 'p')).status).toBe('unreachable');
    expect((await probeSmtp('h', 587, '', 'p')).status).toBe('unreachable');
    expect((await probeSmtp('h', 587, 'u', '')).status).toBe('unreachable');
  });

  it('an unresolvable host is unreachable, not a rejected password', async () => {
    const r = await probeSmtp('no-such-host.invalid', 587, 'u', 'p', 2_000);
    expect(r.status).toBe('unreachable');
  });
});

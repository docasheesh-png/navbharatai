import { describe, it, expect } from 'vitest';
import { connectStage, relativeRecordName, cleanDomainInput, visitUrl, publishButton, unpublishArmed, UNPUBLISH_WORD } from './NbaiDomainConnect';

describe('connectStage — plain-language, honest connect stages', () => {
  it('active domain: done, no further action — but only CONNECTED until something SAW it serve', () => {
    // ⚠️ The `/Live/i` this used to assert was the bug (2026-08-21). DNS + certificate active is not
    // evidence the domain SHOWS THE APP: the admin's screen printed "Live!" directly above a browser
    // tab showing "Site Not Found" on that same domain. With no serving verdict, "Connected" is the
    // most we can honestly say. See the `unknown` case below for the full reasoning.
    const s = connectStage({ active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' });
    expect(s.action).toBe('none');
    expect(s.headline).toContain('Connected');
    // …and the moment a check actually sees the app, the word is earned.
    expect(connectStage({
      active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE',
      serving: { state: 'serving', note: '' },
    }).headline).toMatch(/Live/i);
  });

  it('ownership pending: sets an HONEST multi-hour expectation and says progress is saved', () => {
    const s = connectStage({ active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    // The admin's real Hostinger wait was hours, not minutes — the copy must not under-promise, and must
    // reassure that leaving is safe now that records are remembered.
    expect(s.note).toMatch(/hour/i);
    expect(s.note).toMatch(/saved|safely|nothing is lost/i);
    // A regression guard against the old under-promise, which made a normal multi-hour wait look broken.
    expect(s.note).not.toMatch(/usually takes a few minutes \(sometimes longer\)/i);
  });

  it('ownership done, host pending: honest "almost done", safe to leave', () => {
    const s = connectStage({ active: false, ownershipState: 'ACTIVE', hostState: 'PENDING', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    expect(s.headline).toMatch(/Ownership confirmed/i);
    expect(s.note).toMatch(/leave|safe/i);
  });

  it('host done, cert pending: certificate stage, safe to leave', () => {
    const s = connectStage({ active: false, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'PENDING' });
    expect(s.action).toBe('check');
    expect(s.headline).toMatch(/certificate/i);
    expect(s.note).toMatch(/saved|safely|leave/i);
  });

  it('never claims "check" is unnecessary while any stage is pending (stays honest)', () => {
    for (const st of [
      { active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING' },
      { active: false, ownershipState: 'ACTIVE', hostState: 'PENDING', sslState: 'PENDING' },
      { active: false, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'PENDING' },
    ]) {
      expect(connectStage(st).action).toBe('check');
    }
  });
});

describe('relativeRecordName — registrar add-record form names', () => {
  it('maps the apex to "@"', () => {
    expect(relativeRecordName('example.com', 'example.com')).toBe('@');
    expect(relativeRecordName('example.com.', 'example.com')).toBe('@');
  });

  it('strips the domain suffix from a subdomain', () => {
    expect(relativeRecordName('www.example.com', 'example.com')).toBe('www');
    expect(relativeRecordName('_acme-challenge.example.com', 'example.com')).toBe('_acme-challenge');
  });

  it('leaves an unrelated / empty name untouched', () => {
    expect(relativeRecordName('other.org', 'example.com')).toBe('other.org');
    expect(relativeRecordName('', 'example.com')).toBe('');
  });
});

/**
 * 🔒 "LIVE!" MUST BE EARNED (admin 2026-08-21, mitrify.com).
 *
 * The screen said, in green, "✅ Live! Your domain is connected, with HTTPS · ownership: active ·
 * host: active · SSL: active" — while opening mitrify.com gave Firebase's "Site Not Found". Both were
 * true: those three states describe DNS and a CERTIFICATE, not whether anything was ever published to
 * the site the domain points at. A domain connected AFTER the last publish points at an empty site.
 *
 * The old copy DID say "publish your app once" — but under a green ✅ Live headline that reads as a
 * tip, not as "your domain shows an error page until you do this". The headline is what people act
 * on, so the headline is what had to change.
 */
describe('connectStage — the word "Live" is earned by SERVING, not by DNS', () => {
  const ACTIVE = { active: true, ownershipState: 'ACTIVE', hostState: 'ACTIVE', sslState: 'ACTIVE' };

  it('THE BUG: active but nothing published ⇒ NOT "Live", and it names the one step left', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'nothing_published', note: '' } });
    expect(s.headline).not.toMatch(/Live/i);
    expect(s.headline).toMatch(/press Publish/i);
    expect(s.tone).toBe('warn');          // never a green tick over an error page
    expect(s.action).toBe('publish');      // and a real way to get there
  });

  it('active but the domain answers with an error ⇒ also not "Live"', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'error', note: 'HTTP 503' } });
    expect(s.headline).not.toMatch(/^Live/i);
    expect(s.tone).toBe('warn');
  });

  it('active AND serving ⇒ genuinely Live', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'serving', note: '' } });
    expect(s.headline).toMatch(/Live/i);
    expect(s.tone).toBe('ok');
    expect(s.action).toBe('none');
  });

  /**
   * ⚠️ THIS TEST WAS REVERSED ON 2026-08-21, and the old assertion was the bug.
   *
   * It required "Live!" for `unknown` too, reasoning that our own failed check must not demote a
   * working domain. Then the admin sent a screenshot: our check could not reach mitrify.com, and the
   * screen printed "Live!" directly above a browser tab showing Firebase's "Site Not Found" on that
   * exact domain. "Best evidence we have" is not the same as "we saw it work", and only the second
   * one earns the word Live.
   */
  it('UNKNOWN says CONNECTED and admits what it could not check — it never claims Live', () => {
    const s = connectStage({ ...ACTIVE, serving: { state: 'unknown', note: '' } });
    expect(s.headline).not.toMatch(/Live/i);
    expect(s.headline).toContain('Connected');
    expect(s.tone).toBe('ok');            // not a warning — the connection really is done
    expect(s.note).toContain('could not open your domain from here');
  });

  it('an older server that sends no `serving` at all is treated the same way — never a bare Live', () => {
    // Absence of a verdict is exactly the `unknown` case; it must not be luckier than an explicit one.
    expect(connectStage(ACTIVE).headline).not.toMatch(/Live/i);
    expect(connectStage(ACTIVE).tone).toBe('ok');
  });

  it('a domain that is not active yet is unaffected by any serving result', () => {
    const s = connectStage({ active: false, ownershipState: 'PENDING', hostState: 'PENDING', sslState: 'PENDING', serving: { state: 'nothing_published', note: '' } });
    expect(s.action).toBe('check');
  });
});

/**
 * VISIT YOUR DOMAIN (admin 2026-08-21: "jab domain successfully connect ho jaye, to isi page ke niche
 * 'visit mitrify.com' aana chahiye — aur us par click kar sake").
 *
 * The obvious missing ending: everything on that page is setup — records, checks, waiting — and once
 * it is done the one thing a person wants is to GO AND LOOK AT IT. Until now they had to retype their
 * own domain into the address bar.
 */
describe('cleanDomainInput / visitUrl', () => {
  it('reduces whatever was pasted to a bare host', () => {
    for (const raw of ['mitrify.com', ' MITRIFY.com ', 'https://mitrify.com', 'http://mitrify.com/app?x=1']) {
      expect(cleanDomainInput(raw)).toBe('mitrify.com');
    }
  });

  it('🔒 the link is built from the CLEAN host, never the raw input', () => {
    // Pasting a scheme back into an href is how `https://https://…` reaches a user.
    expect(visitUrl('https://mitrify.com')).toBe('https://mitrify.com');
    expect(visitUrl('http://mitrify.com/app')).toBe('https://mitrify.com');
    expect(visitUrl(' Mitrify.COM ')).toBe('https://mitrify.com');
  });

  it('always https — a connected domain has HTTPS by definition, so http would downgrade it', () => {
    expect(visitUrl('mitrify.com').startsWith('https://')).toBe(true);
  });

  it('nothing in, nothing out — never a bare "https://" link', () => {
    expect(visitUrl('')).toBe('');
    expect(visitUrl('   ')).toBe('');
    expect(visitUrl(undefined as never)).toBe('');
  });
});

/**
 * ADMIN, 2026-08-21: "Visit se pahle ek button banao — Publish. Is publish se app edit karne ke bad
 * wapas publish ki jayegi."
 *
 * The button was the request; these tests pin the half that makes it worth having. A fixed "Publish"
 * label answers only "how", and the reason public sites go stale is that nobody answers "do I need
 * to?". So the label states which of the three situations the user is in — and, where it cannot
 * measure, says nothing at all rather than guessing in either direction.
 */
describe('publishButton — the label states the situation, or stays silent', () => {
  const NOW = 1_000_000_000;

  it('never published: this IS the missing step, so it is the loud one', () => {
    const b = publishButton('never_published', null, NOW);
    expect(b.label).toBe('Publish now');
    expect(b.primary).toBe(true);
    expect(b.note).toContain('not been published yet');
  });

  it('THE CASE THAT STARTED THIS: edited after publishing ⇒ says the domain shows the OLDER version', () => {
    // ⚠️ Label changed 'Publish update' → 'Update' (admin 2026-08-22, deliberate). This is not a test
    // bent to match the code: the admin asked for exactly two controls on a connected domain —
    // Unpublish, and "update — jab user app edit kare sirf tab dikhe". The shorter word is the one
    // they named, and the note below still carries the full explanation.
    const b = publishButton('changed', NOW - 4 * 60_000, NOW);
    expect(b.label).toBe('Update');
    expect(b.primary).toBe(true);
    expect(b.note).toContain('older version');
    expect(b.note).toContain('4 minutes ago');   // the real publish time, not a vague "recently"
  });

  it('up to date: NO button now, but it still says when the site last went out', () => {
    // ⚠️ Was 'Republish' (admin 2026-08-22, deliberate reversal): "update — jab user app edit kare
    // SIRF tab dikhe". A quiet Republish still invites a build that changes nothing, and the user has
    // no way to know it is pointless. An empty label is the caller's signal to render no button; the
    // "Last published …" line stays because when the site went out is genuinely useful.
    const b = publishButton('up_to_date', NOW - 2 * 60 * 60_000, NOW);
    expect(b.label).toBe('');
    expect(b.primary).toBe(false);
    expect(b.note).toContain('latest build');
    expect(b.note).toContain('2 hours ago');
  });

  it('🔒 UNKNOWN claims NOTHING — the button still works, the note is empty', () => {
    // A wrong "you have unpublished changes" sends people to re-publish a current site forever; a
    // wrong "up to date" leaves a stale site up while promising it is not. Silence is the honest
    // third option, and it is the one an unmeasurable state gets.
    const b = publishButton('unknown', null, NOW);
    expect(b.label).toBe('Publish');
    expect(b.note).toBe('');
    expect(b.primary).toBe(false);
  });

  it('an OLDER server that sends no publish block at all behaves exactly like unknown', () => {
    const b = publishButton(undefined, undefined, NOW);
    expect(b.label).toBe('Publish');
    expect(b.note).toBe('');
  });

  it('a missing publish TIME never fabricates one', () => {
    // The freshness verdict can be known while the timestamp is not; the note keeps the verdict and
    // silently drops the "Last published …" clause rather than printing a placeholder date.
    const b = publishButton('up_to_date', null, NOW);
    expect(b.note).toContain('latest build');
    expect(b.note).not.toContain('Last published');
  });
});

/**
 * ADMIN, 2026-08-22: "unpublish — user ko bataya jaye website delete ho jayegi (english me), capital
 * me DELETE type kiya jaye tab hi unpublish ho. update — jab user app edit kare SIRF tab dikhe."
 */
describe('unpublishArmed — the word that arms an irreversible action', () => {
  it('the exact word, in capitals, arms it', () => {
    expect(unpublishArmed(UNPUBLISH_WORD)).toBe(true);
    expect(UNPUBLISH_WORD).toBe('DELETE');
  });

  it('🔒 lowercase and mixed case do NOT arm it', () => {
    // Taking a live site down cannot be undone from any visitor's side: every shared link dies the
    // instant it runs. Accepting "delete" would hand back exactly the carelessness this gate exists
    // to prevent — a confirm dialog is dismissed by reflex, a specific word in a specific case is not.
    for (const t of ['delete', 'Delete', 'DELETE!', 'DELET', 'DELETED', 'D E L E T E']) {
      expect(unpublishArmed(t), t).toBe(false);
    }
  });

  it('trims surrounding whitespace, because that is a real paste artefact', () => {
    expect(unpublishArmed('  DELETE  ')).toBe(true);
    expect(unpublishArmed('\nDELETE\n')).toBe(true);
  });

  it('empty and junk never arm it', () => {
    expect(unpublishArmed('')).toBe(false);
    expect(unpublishArmed('   ')).toBe(false);
    expect(unpublishArmed(undefined as never)).toBe(false);
    expect(unpublishArmed(null as never)).toBe(false);
  });
});

describe('publishButton — "Update" appears ONLY when the app was actually edited', () => {
  const NOW = 1_000_000_000;

  it('edited since publishing ⇒ the button says Update', () => {
    expect(publishButton('changed', NOW - 60_000, NOW).label).toBe('Update');
  });

  it('🔒 already up to date ⇒ NO button at all (an empty label)', () => {
    // An "Update" button on a site that is already current invites a build that changes nothing, and
    // the user has no way to know it is pointless — the label promises what it cannot deliver.
    const b = publishButton('up_to_date', NOW - 60_000, NOW);
    expect(b.label).toBe('');
    expect(b.note).toContain('latest build');      // the "when" line still earns its place
  });

  it('never published ⇒ still offers the first publish, or the screen is a dead end', () => {
    expect(publishButton('never_published', null, NOW).label).toBe('Publish now');
  });

  it('unmeasurable ⇒ a plain Publish that claims nothing', () => {
    expect(publishButton('unknown', null, NOW).label).toBe('Publish');
    expect(publishButton('unknown', null, NOW).note).toBe('');
  });
});

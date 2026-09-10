// WHERE DOES THIS WORKSPACE'S DOMAIN ACTUALLY POINT — and what must NOT be written over it?
// (admin 2026-09-07, "ab app publish me koi problem bachi hai??")
//
// 🔴 THE TRAP THIS CLOSES, AND IT IS ONE THE PREVIOUS FIX MADE SHARPER.
//
// A fullstack app's domain is deliberately moved OFF static hosting and onto the backend service: the
// deploy attaches the domain to that service and writes a CNAME at the apex (removing the static
// host's A record first, since DNS forbids both — see conflictingTypesFor).
//
// From that moment the STATIC host's own view of the domain is, correctly, "my records are gone". Its
// ownership/host states stop being `active`. And every screen and route here reads exactly that view:
//
//   • the connect screen decides it is back to "still connecting", so it re-opens the setup
//     instructions and offers "Check & apply records" again;
//   • that button applies the STATIC host's required records — including an A record at the apex;
//   • and the cross-type sweep then deletes the backend CNAME, because an A record and a CNAME cannot
//     share a name.
//
// So the screen would invite the user to press a button that TAKES THEIR LIVE SITE DOWN and hands the
// domain back to a host which — for a fullstack app — can only ever answer "Site Not Found". The
// domain was working; the UI led them out of it.
//
// 🔒 THE FIX IS A FACT, NOT A HEURISTIC. Nothing here infers where a domain points by inspecting DNS
// and guessing. The deploy that moved the domain RECORDS that it did so, and every decision below
// reads that record. A guess would be wrong in exactly the case that matters (a domain mid-move), and
// this module exists because a wrong guess here deletes a working site.
//
// PURE — record in, decision out.

/** The durable fields this module reads. See ConversationRecord.backendDomain. */
export interface DomainPointingRecord {
  /** The domain a backend deploy pointed at the running service, when one did. */
  backendDomain?: string;
}

const norm = (d: string | null | undefined): string =>
  String(d ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/**
 * Is THIS host the one a backend deploy took over for this workspace?
 *
 * Host-specific on purpose: a user may connect a second domain later, and the fact that one of them
 * serves the backend says nothing about the other. PURE.
 */
export function isBackendPointed(rec: DomainPointingRecord | null | undefined, host: string): boolean {
  const pointed = norm(rec?.backendDomain);
  const want = norm(host);
  return pointed !== '' && pointed === want;
}

/**
 * What to tell someone who asks us to (re-)apply the STATIC host's DNS records to a domain that is
 * serving their backend.
 *
 * 🔒 IT REFUSES, AND IT SAYS WHY IN TERMS OF WHAT THEY WOULD LOSE — not "not allowed". The whole
 * reason this refusal exists is that the action looks helpful and is destructive; a message that does
 * not name the consequence would read as an obstruction and invite a workaround. PURE.
 */
export function backendPointedRefusal(host: string): string {
  const h = norm(host) || 'your domain';
  return `${h} is already pointing at your app's own server, which is what makes it work right now. `
    + 'Re-applying the website records here would take it back off that server and your site would '
    + 'stop loading. Nothing has been changed. If you want to move this domain back to website-only '
    + 'hosting, disconnect it first and connect it again.';
}

/**
 * The connect screen's verdict for a backend-pointed domain, from EVIDENCE rather than from the
 * static host's opinion.
 *
 * 🔒 THE STATIC HOST'S STATES ARE NOT THE TRUTH HERE, and reporting them would be the same
 * narrow-view mistake this deploy path keeps having to unlearn: it is answering "are MY records in
 * place?" while the user is asking "does my domain work?". Once the domain has moved, those are
 * different questions with legitimately different answers — its records are genuinely gone, and the
 * site is genuinely live.
 *
 * So the answer comes from whether the domain ANSWERS. `serving` null means we could not tell, which
 * is reported as exactly that — never as failure, and never as success. PURE.
 */
export function backendPointedStage(
  host: string,
  serving: { state: string; status: number } | null | undefined,
): { headline: string; note: string; tone: 'ok' | 'warn' } {
  const h = norm(host) || 'Your domain';
  if (serving?.state === 'serving') {
    return {
      headline: 'Connected — your domain is serving your app.',
      tone: 'ok',
      note: `${h} points at your app's own server, and it is answering. The website records are no `
        + 'longer used for this domain, which is why they are not listed as active.',
    };
  }
  if (serving && serving.state !== 'serving' && serving.status >= 500) {
    return {
      headline: 'Your domain reaches your app, but the app is erroring.',
      tone: 'warn',
      note: `${h} points at your app's own server and that server answered with an error. That is the `
        + 'app failing, not the domain — check its logs, and that every setting it needs is saved.',
    };
  }
  return {
    headline: 'Connected to your app\'s server — still checking that it answers.',
    tone: 'warn',
    note: `${h} points at your app's own server. We could not confirm it is answering yet — a first `
      + 'deploy takes a few minutes, and a free plan sleeps when idle. Open it in a minute to check.',
  };
}

// GRIEVANCE REDRESSAL — the page Indian law actually requires, and the one that protects NavBharatAI.
//
// ADMIN 2026-09-12, on the risk of the platform being shut down: "aise user jo desh/duniya ke liye
// khatra hai … ham samay rahte aise user ko block/ban kar sakte hai."
//
// ── WHY THIS PAGE IS THE FIRST THING WE BUILT, AND NOT A MONITORING ENGINE ───────────────────────
// Under Section 79 of the Information Technology Act, 2000, a platform is not liable for what its
// users do — PROVIDED it performs the due diligence the Intermediary Guidelines (IT Rules, 2021)
// describe. That due diligence is a PROCESS, not omniscience: publish your rules, give people a
// named person to complain to, answer inside fixed timelines, and act fast once you actually know.
//
// So the single cheapest, highest-value thing a platform our size can do is exist properly on
// paper. A surveillance engine with no grievance channel protects nobody; a grievance channel with
// no engine is already most of the legal position.
//
// ── 🔒 WHY THE OFFICER'S NAME COMES FROM THE ENVIRONMENT AND IS NEVER WRITTEN HERE ───────────────
// Rule 3(2)(b) requires the NAME of a real individual. A name is not something this file may guess,
// invent, or default to — a fabricated officer on a compliance page is worse than an absent one,
// because it is a false statement made to a regulator. So the name is configuration the admin sets,
// and until it is set the page names the ROLE honestly and the admin panel says, loudly, that the
// page is incomplete. That is the second absolute rule applied to a legal document: fully working,
// or honestly not finished — never a convincing fake.
//
// ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────────────────────────
// Not legal advice, and not a substitute for a lawyer's review. It states plainly what NavBharatAI
// actually does today; every timeline below is one the platform can genuinely meet.

export const GRIEVANCE_TITLE = 'Grievance Redressal';
export const GRIEVANCE_SUBTITLE = 'How to complain, who reads it, and how fast we must answer (IT Rules, 2021)';
export const GRIEVANCE_UPDATED = '12 September 2026';

/** The public contact details of the Grievance Officer. Public by construction — the law publishes them. */
export interface GrievanceOfficer {
  /** The officer's real name. '' means the admin has not named one yet — NEVER a placeholder person. */
  name: string;
  email: string;
  /** Optional. '' when not published. */
  phone: string;
  /** Optional postal address. '' when not published. */
  address: string;
}

/** The address that already serves as our published contact, used when no dedicated one is configured. */
export const GRIEVANCE_FALLBACK_EMAIL = 'info@navbharatai.com';

/** The canonical public URL of this page. */
export const GRIEVANCE_PATH = '/grievance';

/** Acknowledge a complaint within this many hours (IT Rules, 2021, Rule 3(2)(a)). */
export const ACK_HOURS = 24;
/** Dispose of a complaint within this many days. */
export const RESOLVE_DAYS = 15;
/** The stricter window for intimate-imagery / impersonation complaints. */
export const URGENT_REMOVAL_HOURS = 24;

interface RawOfficer {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
}

/**
 * Normalise whatever the environment (or the public-config route) supplied. PURE.
 *
 * An unreadable value becomes '' rather than being coerced into something printable: a compliance
 * page showing `[object Object]` as the officer's name is exactly the kind of thing a regulator
 * screenshots. The email falls back to our published address, because a page with NO way to
 * complain is worse than one naming the general mailbox.
 */
export function grievanceOfficerFrom(raw: RawOfficer | null | undefined): GrievanceOfficer {
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const email = s(raw?.email);
  return {
    name: s(raw?.name),
    // A value that is not shaped like an address is treated as absent — see the note above.
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : GRIEVANCE_FALLBACK_EMAIL,
    phone: s(raw?.phone),
    address: s(raw?.address),
  };
}

/** True when a real person has been named, which is what Rule 3(2)(b) actually asks for. */
export function officerIsNamed(officer: GrievanceOfficer | null | undefined): boolean {
  return !!officer && officer.name.length > 0;
}

/**
 * The exact sentence the admin panel shows while the page is incomplete.
 *
 * Deliberately specific about the consequence rather than a generic warning: "not configured" gets
 * ignored, "this is what the law requires and we are not meeting it" does not.
 */
export const OFFICER_MISSING_WARNING =
  'The Grievance Officer is not named. IT Rules, 2021 (Rule 3(2)(b)) require a named individual with contact details published. '
  + 'Set GRIEVANCE_OFFICER_NAME (and optionally GRIEVANCE_OFFICER_EMAIL / _PHONE / _ADDRESS) in Cloud Run — '
  + 'until then /grievance names the role only, and complaints still reach ' + GRIEVANCE_FALLBACK_EMAIL + '.';

/**
 * The document. PURE — the same words on the public page and inside the app, built from one source.
 *
 * Every timeline here is one we can genuinely meet with the people we have. Promising a two-hour
 * response would read better and would be a lie the first time someone timed us.
 */
export function grievanceDoc(officer: GrievanceOfficer): string {
  const named = officerIsNamed(officer);
  const who = named ? `**${officer.name}**` : '**The Grievance Officer** (name being appointed)';
  const contactLines = [
    `- **Officer:** ${named ? officer.name : 'Grievance Officer, NavBharatAI'}`,
    `- **Email:** ${officer.email}`,
    officer.phone ? `- **Phone:** ${officer.phone}` : '',
    officer.address ? `- **Address:** ${officer.address}` : '',
  ].filter(Boolean).join('\n');

  return `# Grievance Redressal

NavBharatAI is an intermediary under the **Information Technology Act, 2000** and the
**Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021**.
This page is our grievance mechanism under those Rules. It tells you who to write to, what we will
do, and how long we may take.

---

## 1. Who to contact

${contactLines}

${who} is responsible for receiving and resolving complaints about content on NavBharatAI, about
apps published or hosted through it, and about how we have applied our own rules.

${named ? '' : `> **We are appointing a named officer.** Until that name is published here, complaints sent to
> the address above reach the person who performs this role and are handled under exactly the
> timelines below. We would rather say this plainly than print a name that is not real.

`}---

## 2. What you can complain about

- **Content or an app** on NavBharatAI that you believe is unlawful, harmful, or breaks our
  [Terms of Service](/terms) — including fraud or phishing, malware, sexual content involving
  minors, non-consensual intimate imagery, incitement to violence, or impersonation.
- **Your own data** — access, correction, deletion, or withdrawal of consent under the
  **Digital Personal Data Protection Act, 2023** (see the [Privacy Policy](/privacy)).
- **Our decisions** — an app removed, an account suspended, a charge you believe is wrong.
- **Anything else** about the service that our ordinary support did not resolve.

## 3. How to complain

**By email** — write to the address in Section 1. To let us act quickly, include:

1. what you are complaining about — a link, an app name, or the page where you saw it;
2. what is wrong with it, in your own words;
3. your name and a contact address (we verify identity before acting on data-rights requests, so
   that nobody else can use your rights against you);
4. any screenshot or evidence you have.

**Inside the app** — every published app carries a **Report** button. A report filed there reaches
the same queue and needs no email. You do not have to be signed in to report something you are
worried about.

## 4. What we will do, and how fast

| | |
|---|---|
| **Acknowledge your complaint** | within **${ACK_HOURS} hours** |
| **Resolve it and tell you the outcome** | within **${RESOLVE_DAYS} days** |
| **Remove intimate imagery published without consent, or impersonation** | within **${URGENT_REMOVAL_HOURS} hours** of a valid complaint |
| **Act on a court order or a lawful government direction** | within **36 hours** |

If a complaint needs more time than this — for example because it needs a legal opinion or the
other party's response — we will say so before the deadline rather than let it pass in silence.

We keep a record of what was removed and why, and of the information needed to identify who
published it, for **180 days** after removal, as the Rules require for investigation.

## 5. Sexual content involving minors

**Zero tolerance, no exceptions, and no waiting for a complaint.** Any such content is removed
immediately, the account is closed, and the material and the account records are preserved and
reported to the appropriate authorities under Section 67B of the IT Act and the POCSO Act, 2012.
This is the one category where we act first and correspond afterwards.

## 6. If you are not satisfied

- **Data-protection complaints** — you may escalate to the **Data Protection Board of India** under
  the DPDP Act, 2023.
- **Content complaints** — the IT Rules, 2021 give you a right of appeal to a **Grievance Appellate
  Committee** constituted by the Government of India. You must first bring the complaint to us; if
  our answer does not satisfy you, you may appeal within thirty days. Details of the Committees are
  published by the Ministry of Electronics and Information Technology.
- You may of course also pursue any remedy available to you in law. Nothing here takes away a right
  you have.

## 7. What we are not

NavBharatAI is a software-building platform, not a social-media network. We do not run a public
feed, and we are well below the user threshold at which the Rules impose the additional
"significant social media intermediary" obligations. If that changes, this page changes with it.

---

*This page describes what we actually do. If you think we have not followed it, that itself is a
complaint we want to receive — write to the address in Section 1.*
`;
}

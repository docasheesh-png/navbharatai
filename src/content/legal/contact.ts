// CONTACT US — the public page a payment aggregator, a store reviewer and an ordinary customer all
// look for, and the one NavBharatAI did not have (2026-09-20).
//
// WHY IT IS SEPARATE FROM THE FIVE LEGAL DOCUMENTS, like /delete-account beside it: this page's whole
// job is to be acted on in ten seconds — one address, and which thing to write about where. The
// registry's documents are long-form by contract (4,000+ characters each) and padding a contact page
// to reach that bar would make the one page that must be scannable harder to scan.
//
// 🔒 NOTHING ON THIS PAGE IS INVENTED, and that is the rule that shaped it. A contact page is exactly
// where a fabricated detail does the most damage: a postal address nobody reads, a phone number
// nobody answers, an SLA nobody meets. So every channel here is one that genuinely exists, every
// clock is one the platform already commits to elsewhere (the grievance windows come from the same
// constants the Grievance page is built from), and the postal address and phone appear ONLY when the
// deployment has actually published them. Unconfigured, the page says plainly that we answer by
// email — which is true — instead of showing a convincing blank.
//
// ⚠️ NOT LEGAL ADVICE — for lawyer review before reliance.

import { ACK_HOURS, RESOLVE_DAYS, GRIEVANCE_FALLBACK_EMAIL, type GrievanceOfficer } from './grievance';

export const CONTACT_TITLE = 'Contact NavBharatAI';
export const CONTACT_UPDATED = '20 September 2026';

/** The canonical public URL of this page. */
export const CONTACT_PATH = '/contact';

/** The one address every enquiry reaches. Published, not secret. */
export const CONTACT_EMAIL = GRIEVANCE_FALLBACK_EMAIL;

/**
 * Build the page. PURE — the officer's real details are passed in by the route, exactly as the
 * Grievance page does, so the two can never disagree about how to reach a human.
 *
 * `officer` is optional because the registry has no environment to read: without it the page simply
 * omits the postal and telephone lines rather than printing an empty label.
 */
export function contactDoc(officer?: GrievanceOfficer | null): string {
  const address = officer?.address?.trim() || '';
  const phone = officer?.phone?.trim() || '';

  const postal = address
    ? `\n**Postal address**\n\n${address.split('\n').map((l) => `> ${l.trim()}`).join('\n')}\n`
    : '';
  const telephone = phone ? `\n**Telephone:** ${phone}\n` : '';

  return `# Contact NavBharatAI

**Last updated: ${CONTACT_UPDATED}**

We are a small team and we read everything that arrives. There is **one address**, so nothing you write ever falls between two inboxes:

# ${CONTACT_EMAIL}
${telephone}${postal}
Write in **English or Hindi** — both are read.

---

## What to write about, and where it goes

| If you want to | Write to us with the subject | And please include |
|---|---|---|
| Ask for a **refund** | \`Refund\` | the order ID, or the date and amount (Billing → Invoice Records) |
| Report a **payment problem** — money taken, credit not added, charged twice | \`Payment\` | the order ID(s) and the time it happened |
| Ask about **your account** — sign-in, balance, a build that went wrong | \`Support\` | the email address on the account |
| **Delete your account** | \`Delete my account\` | nothing else — see [Account & data deletion](/delete-account) |
| Make a **formal complaint** | \`Grievance\` | what happened, and what you want done |
| Report a **security vulnerability** | \`SECURITY\` | steps to reproduce it — please do not post it publicly first |
| **Business, partnership or press** | \`Business\` | who you are and what you are proposing |

The subject line is a convenience, not a condition. **An email with the wrong subject is still read** — it may simply take a little longer to reach the right person.

## How quickly we answer

- **Ordinary questions:** we aim to reply within **2 working days**.
- **Refunds:** a decision, with the reason, within **5 working days** — and where we approve one, the money leaves within **7 working days**. The full rules are in our [Refund & Cancellation Policy](/refund).
- **Formal complaints:** acknowledged within **${ACK_HOURS} hours** and resolved within **${RESOLVE_DAYS} days**, which are the timelines the Information Technology (Intermediary Guidelines) Rules, 2021 require of us. Our [Grievance Redressal](/grievance) page names the officer responsible and states your right to escalate.

We do not run a telephone support line, and we would rather say so than publish a number nobody answers.

## Inside the app

You do not have to leave NavBharatAI to reach us. **Settings → Help & Support** carries the same address, and the feedback option sends your message with the technical details we need to investigate already attached — which usually saves a round trip.

---

## Who you are dealing with

**NavBharatAI** — an Indian AI platform for building and publishing software, operating at **navbharatai.com** and as the Android application \`com.navbharat.ai\`.

**Prices are shown in Indian Rupees (₹)** and payments are collected in INR.

---

**Our other pages:** [Terms of Service](/terms) · [Refund & Cancellation Policy](/refund) · [Privacy Policy](/privacy) · [Grievance Redressal](/grievance) · [Account & data deletion](/delete-account)
`;
}

// HOW A REFERRED FRIEND IS NAMED TO THE PERSON WHO REFERRED THEM.
//
// `GET /api/referral/:userId/referred` used to send each friend's FULL email address to the referrer.
// A referrer is entitled to know how far each person who used their code has got — it is their code and
// their reward — but not to collect those people's addresses. The wallet-redesign brief says the same
// ("do not expose referred users' email addresses"), and it is the data-minimisation rule the privacy
// policy already states for every other screen.
//
// So the route sends a MASKED label and never the address.
//
// 🔴 WHY THIS IS NOT `maskEmail` (vaultPin.ts). That function shows up to two leading characters because
// its reader is the ADDRESS'S OWN OWNER, who only needs to recognise it. This reader is a third party:
// for a one- or two-letter name (`b@mail.com`) it would print the whole address. So here the number of
// revealed characters is a THIRD of the name, at most two — `b@mail.com` → `•@mail.com`,
// `friend.b@mail.com` → `fr•••••••@mail.com` — and a test holds that the address is never recoverable
// from the label for any short name. The domain is kept: it says "a Gmail friend", not who.
//
// An unreadable account is named "A friend", never blank.
//
// PURE.

export function referralFriendLabel(email: string | null | undefined): string {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return 'A friend';
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const shown = Math.min(2, Math.floor(name.length / 3));
  return `${name.slice(0, shown)}${'•'.repeat(name.length - shown)}@${domain}`;
}

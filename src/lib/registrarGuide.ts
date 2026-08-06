/**
 * Registrar guide for the nameserver step (admin suggestion 2026-08-06, adapted): after we hand the
 * user two nameservers, their real question is "WHERE do I paste these?" — every registrar hides the
 * form somewhere different. This maps the registrars our users actually buy from (India-first) to
 * their panel URL and a three-line path to the nameserver form.
 *
 * Detection: a domain's registrar is PUBLIC data (RDAP). The client asks rdap.org and matches the
 * registrar's legal name against `match` keywords to preselect the dropdown — best-effort, and the
 * user's own choice always wins. Pure data + pure matcher, fully unit-testable.
 */

export interface RegistrarInfo {
  id: string;
  name: string;
  /** Dashboard entry point — the domains list, from which the user picks their domain. */
  panelUrl: string;
  /** The short path from login to the nameserver form, in that registrar's own menu words. */
  steps: string;
  /** Lowercase keywords matched against the RDAP registrar name. */
  match: string[];
}

export const REGISTRARS: RegistrarInfo[] = [
  { id: 'godaddy', name: 'GoDaddy', panelUrl: 'https://dcc.godaddy.com/domains', steps: 'My Products → your domain → DNS → Nameservers → Change → "I\'ll use my own nameservers"', match: ['godaddy'] },
  { id: 'hostinger', name: 'Hostinger', panelUrl: 'https://hpanel.hostinger.com/domains', steps: 'Domains → your domain → DNS / Nameservers → Change nameservers → Custom', match: ['hostinger'] },
  { id: 'namecheap', name: 'Namecheap', panelUrl: 'https://ap.www.namecheap.com/domains/list/', steps: 'Domain List → Manage → Nameservers → Custom DNS', match: ['namecheap'] },
  { id: 'bigrock', name: 'BigRock', panelUrl: 'https://manage.bigrock.in/', steps: 'List/Search Orders → your domain → Name Servers → update both', match: ['bigrock'] },
  { id: 'hostgator', name: 'HostGator', panelUrl: 'https://portal.hostgator.com/domains', steps: 'Domains → your domain → Name Servers → Manually set', match: ['hostgator', 'launchpad'] },
  { id: 'bluehost', name: 'Bluehost', panelUrl: 'https://my.bluehost.com/hosting/domains', steps: 'Domains → your domain → Nameservers → Custom', match: ['bluehost', 'fastdomain'] },
  { id: 'squarespace', name: 'Squarespace (old Google Domains)', panelUrl: 'https://account.squarespace.com/domains', steps: 'Domains → your domain → DNS → Use custom nameservers', match: ['squarespace', 'google domains'] },
  { id: 'porkbun', name: 'Porkbun', panelUrl: 'https://porkbun.com/account/domainsSpeedy', steps: 'Domain Management → your domain → NS (Authoritative Nameservers) → edit', match: ['porkbun'] },
  { id: 'dynadot', name: 'Dynadot', panelUrl: 'https://www.dynadot.com/account/domain/name-servers', steps: 'My Domains → your domain → Name Servers → set both', match: ['dynadot'] },
  { id: 'namedotcom', name: 'Name.com', panelUrl: 'https://www.name.com/account/domain', steps: 'My Domains → your domain → Nameservers → apply changes', match: ['name.com'] },
  { id: 'ionos', name: 'IONOS', panelUrl: 'https://my.ionos.com/domains', steps: 'Domains & SSL → your domain → Nameserver → Use custom name servers', match: ['ionos', '1&1'] },
  { id: 'ovh', name: 'OVH', panelUrl: 'https://www.ovh.com/manager/#/web/domain', steps: 'Domains → your domain → DNS servers → Change the DNS servers', match: ['ovh'] },
  { id: 'other', name: 'Other / not sure', panelUrl: '', steps: 'Log in where you bought the domain → find your domain → look for "Nameservers" or "DNS servers" → choose custom, paste both, save', match: [] },
];

/** Registrar entry by id (null for unknown ids — a select can never produce a crash). */
export function registrarById(id: string | null | undefined): RegistrarInfo | null {
  return REGISTRARS.find((r) => r.id === id) ?? null;
}

/**
 * Map an RDAP registrar name (e.g. "GoDaddy.com, LLC", "HOSTINGER operations, UAB") to our entry.
 * Case-insensitive keyword match; null when no keyword hits — the dropdown then simply stays manual.
 */
export function detectRegistrarId(rdapName: string | null | undefined): string | null {
  const n = (rdapName ?? '').toLowerCase();
  if (!n) return null;
  for (const r of REGISTRARS) {
    if (r.match.some((k) => n.includes(k))) return r.id;
  }
  return null;
}

/**
 * Pull the registrar's name out of an RDAP domain response (entities with role "registrar", vCard
 * "fn"). Tolerates the format's nesting without trusting it. Pure.
 */
export function registrarNameFromRdap(rdap: unknown): string | null {
  const entities = (rdap as { entities?: Array<{ roles?: string[]; vcardArray?: [string, Array<[string, unknown, string, unknown]>] }> })?.entities;
  if (!Array.isArray(entities)) return null;
  for (const e of entities) {
    if (!e?.roles?.includes('registrar')) continue;
    const props = e.vcardArray?.[1];
    if (!Array.isArray(props)) continue;
    for (const p of props) {
      if (Array.isArray(p) && p[0] === 'fn' && typeof p[3] === 'string' && p[3]) return p[3];
    }
  }
  return null;
}

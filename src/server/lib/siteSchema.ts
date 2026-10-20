// STRUCTURED DATA (schema.org JSON-LD) for NavBharatAI's own site — SEO audit 2026-10-18.
//
// ONE builder, used by the server-rendered public pages and pinned against the static copy in
// index.html by tests/theSiteHasOneIdentity.test.ts, so the homepage and /about can never describe
// two different organisations. PURE.
//
// 🔒 ONLY FACTS: name, URL, logo, the published contact address, the founder as About Us names him,
// and official profiles (sameAs) that exist. No rating, no review, no award, no user count — Google
// treats invented structured data as spam, and it would be a false public claim besides.

import {
  OFFICIAL_NAME, OFFICIAL_ALT_NAMES, OFFICIAL_SITE_URL, OFFICIAL_LOGO_URL, OFFICIAL_CONTACT_EMAIL,
  officialSameAs,
} from '../../content/marketing';

export const ORGANIZATION_ID = `${OFFICIAL_SITE_URL}#organization`;
export const WEBSITE_ID = `${OFFICIAL_SITE_URL}#website`;

export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: OFFICIAL_NAME,
    alternateName: [...OFFICIAL_ALT_NAMES],
    url: OFFICIAL_SITE_URL,
    logo: OFFICIAL_LOGO_URL,
    email: OFFICIAL_CONTACT_EMAIL,
    founder: { '@type': 'Person', name: 'Dr. Asheesh' },
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: OFFICIAL_CONTACT_EMAIL,
      availableLanguage: ['English', 'Hindi'],
      areaServed: 'IN',
    }],
    sameAs: officialSameAs(),
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: OFFICIAL_NAME,
    alternateName: [...OFFICIAL_ALT_NAMES],
    url: OFFICIAL_SITE_URL,
    inLanguage: 'en-IN',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** The homepage graph: the WebSite and the Organization behind it. */
export function homeJsonLd(): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@graph': [websiteJsonLd(), organizationJsonLd()] };
}

/** A public sub-page: its WebPage (or AboutPage), tied to the same WebSite and Organization. */
export function pageJsonLd(input: { url: string; name: string; description: string; type?: 'WebPage' | 'AboutPage' }): Record<string, unknown> {
  const graph: Record<string, unknown>[] = [{
    '@type': input.type ?? 'WebPage',
    '@id': `${input.url}#webpage`,
    url: input.url,
    name: input.name,
    description: input.description,
    inLanguage: 'en-IN',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORGANIZATION_ID },
    ...(input.type === 'AboutPage' ? { about: { '@id': ORGANIZATION_ID } } : {}),
  }];
  // The Organization node itself is stated once per page that is ABOUT it; elsewhere it is referenced.
  if (input.type === 'AboutPage') graph.push(organizationJsonLd(), websiteJsonLd());
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * Serialise for an inline `<script type="application/ld+json">`. `<` is escaped so no string inside
 * the data — an admin-edited About field, say — can close the script element early.
 */
export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

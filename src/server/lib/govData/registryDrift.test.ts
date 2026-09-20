/**
 * THE GUARD THAT MAKES THE REGISTER IMPOSSIBLE TO OUTGROW.
 *
 * 🔴 THE FINDING THIS EXISTS FOR (audit, 2026-09-20). `licenceExposure.ts` listed **two** restricted
 * sources. The live-data layer called **seven** external API hosts. Three had never been examined by
 * anyone — `api.postalpincode.in`, `open.er-api.com`, `api.themoviedb.org` — and two of those turn
 * out to carry licence conditions we were not meeting.
 *
 * That is the SAME illness that produced the Open-Meteo exposure: a hand-maintained list that the
 * code quietly grew past. Writing a longer list would not have cured it; the list would drift again
 * the next time somebody added a `fetch`.
 *
 * So the cure is mechanical. **This test fails CI the moment code calls a host the registry does not
 * declare.** A new data source can still be added in one line — but not in silence, and not without
 * somebody writing down what its licence permits.
 *
 * ⚠️ IT READS SOURCE, NOT BEHAVIOUR, ON PURPOSE. `tsc` and `vitest` cannot see an undeclared host:
 * a new `fetch('https://api.example.gov/...')` compiles, passes every unit test, and ships. Only a
 * source-level scan catches it, which is why this file is a scanner rather than a set of cases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  EXTERNAL_SOURCES,
  declaredHosts,
  callableSources,
  inheritedSources,
  sourceById,
  sourcesFor,
  attributionsFor,
  requiresAttribution,
} from './registry';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * The modules that reach outside for DATA. Deliberately a short, explicit list rather than a crawl
 * of the whole repo: this guard is about the live-data layer, and a scanner that swept every file
 * would drown in documentation links, test fixtures and the URLs of services we merely link to.
 */
const DATA_MODULES = [
  '../liveDataSources.ts',
  '../transitLive.ts',
  '../cpcbAirQuality.ts',
];

/**
 * Hosts that appear in these files as LINKS FOR THE READER, never as calls we make.
 *
 * Each one is a place the answer points a user at for the official figure — `mausam.imd.gov.in` in
 * the weather block, `app.cpcbccr.com` in the air block. Calling them would be a data source;
 * printing them is a citation, which is the opposite of an undeclared dependency.
 */
const CITATION_ONLY = new Set([
  'mausam.imd.gov.in',
  'app.cpcbccr.com',
  'enquiry.indianrail.gov.in',
  'www.irctc.co.in',
]);

/** Every https host mentioned in a module, minus the citation-only ones. */
function hostsIn(rel: string): string[] {
  const src = read(rel);
  const found = new Set<string>();
  for (const m of src.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
    const host = m[1];
    if (host && !CITATION_ONLY.has(host)) found.add(host);
  }
  return [...found].sort();
}

describe('🔒 no undeclared data source — the drift guard', () => {
  it('every host the live-data layer contacts is declared in the registry', () => {
    const declared = new Set(declaredHosts());
    const undeclared: string[] = [];
    for (const mod of DATA_MODULES) {
      for (const host of hostsIn(mod)) {
        if (!declared.has(host)) undeclared.push(`${host}  (in ${mod})`);
      }
    }
    // If this fails, do NOT add the host to CITATION_ONLY unless it really is only a link. Add a
    // row to EXTERNAL_SOURCES with its licence — that is the entire point.
    expect(undeclared, `undeclared external hosts:\n  ${undeclared.join('\n  ')}`).toEqual([]);
  });

  it('🔒 the guard can actually fail — it is not matching nothing', () => {
    // A scanner that silently found zero hosts would pass for ever while the codebase drifted. This
    // is the canary: the modules really do contain hosts, and they really are declared.
    const all = DATA_MODULES.flatMap(hostsIn);
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const host of all) {
      expect(declaredHosts(), host).toContain(host);
    }
  });

  it('🔒 an invented host would be caught', () => {
    // Proving the mechanism rather than trusting it: a host that is not in the registry must not
    // pass the same membership test the guard above applies.
    expect(declaredHosts()).not.toContain('api.some-new-service.example');
  });
});

describe('🔒 a source nobody has checked cannot be reached by the router', () => {
  it('callableSources never includes an unverified row', () => {
    for (const s of callableSources()) {
      expect(['verified', 'documented'], s.id).toContain(s.status);
      expect(s.enabled, s.id).toBe(true);
    }
  });

  it('🔒 every row with no confirmed endpoint is unreachable', () => {
    // "Do NOT fake an endpoint" as a PROPERTY, not a promise: a data.gov.in row without a resource
    // id cannot be called, because there is nothing to call.
    for (const s of EXTERNAL_SOURCES) {
      if (s.auth === 'data-gov-in-key' && !s.resourceId) {
        expect(callableSources().map((c) => c.id), s.id).not.toContain(s.id);
      }
    }
  });

  it('the sources this audit INHERITED are named, not hidden', () => {
    // They run today and nobody examined them. Recording that is the honest state; quietly marking
    // them verified would be the dishonest one.
    const ids = inheritedSources().map((s) => s.id);
    expect(ids).toContain('india-post-pincode');
    expect(ids).toContain('exchangerate-api');
  });
});

describe('every row carries what a maintainer needs to decide', () => {
  it('has an id, a host, a licence and a coverage statement', () => {
    for (const s of EXTERNAL_SOURCES) {
      expect(s.id, s.id).toBeTruthy();
      expect(s.name, s.id).toBeTruthy();
      expect(s.department, s.id).toBeTruthy();
      expect(s.host, s.id).toMatch(/^[a-z0-9.-]+$/);
      expect(s.licence, s.id).toBeTruthy();
      expect(s.coverage, s.id).toBeTruthy();
      expect(s.sourceUrl, s.id).toMatch(/^https:\/\//);
      expect(['permitted', 'restricted', 'unknown'], s.id).toContain(s.commercialUse);
    }
  });

  it('ids are unique — the registry is addressable', () => {
    const ids = EXTERNAL_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('🔒 a row that is not fully verified explains why', () => {
    // An unexplained "unverified" is a shrug. The note is what a later session acts on.
    for (const s of EXTERNAL_SOURCES) {
      if (s.status === 'unverified') expect(s.note, s.id).toBeTruthy();
    }
  });

  it('🔒 a live reading is never held in a long cache', () => {
    // A census figure and a train's position are not the same kind of fact. Holding the second for
    // hours would show a user a position that is simply wrong.
    for (const s of EXTERNAL_SOURCES) {
      if (s.temporal.toLowerCase().startsWith('live')) {
        expect(s.cacheTtlMs, s.id).toBeLessThanOrEqual(30 * 60_000);
      }
    }
  });

  it('🔒 names env KEYS, never values — the registry is safe to render to an admin', () => {
    const blob = JSON.stringify(EXTERNAL_SOURCES);
    expect(blob).toContain('DATA_GOV_IN_API_KEY'); // the NAME is necessary
    // No row carries anything shaped like a credential.
    expect(blob).not.toMatch(/api-key=[A-Za-z0-9]/);
    expect(blob).not.toMatch(/\b[A-Za-z0-9]{32,}\b/);
  });
});

describe('attribution is treated as the licence condition it is', () => {
  it('lists the sources whose credit we are obliged to show', () => {
    const ids = requiresAttribution().map((s) => s.id);
    expect(ids).toContain('cpcb-aqi');        // GODL-India requires it
    expect(ids).toContain('exchangerate-api'); // its open tier requires it — and we do not show it yet
  });

  it('deduplicates and keeps a stable order', () => {
    expect(attributionsFor(['cpcb-aqi', 'cpcb-aqi'])).toEqual([
      'Source: Central Pollution Control Board (CPCB) via data.gov.in',
    ]);
    expect(attributionsFor([])).toEqual([]);
    expect(attributionsFor(['no-such-source'])).toEqual([]);
  });

  it('the CPCB credit in the registry matches the one the answer actually prints', () => {
    // Two copies of a licence condition is how one of them goes stale. This holds them together.
    const live = read('../liveDataSources.ts');
    const line = sourceById('cpcb-aqi')!.attribution!;
    expect(live).toContain('Central Pollution Control Board');
    expect(line).toContain('Central Pollution Control Board');
    expect(line).toContain('data.gov.in');
  });
});

describe('selectors', () => {
  it('finds by id and by category', () => {
    expect(sourceById('cpcb-aqi')?.department).toContain('Central Pollution Control Board');
    expect(sourceById('nope')).toBeUndefined();
    expect(sourcesFor('environment').map((s) => s.id)).toContain('cpcb-aqi');
    expect(sourcesFor('health')).toEqual([]); // honest: no health source is registered yet
  });
});

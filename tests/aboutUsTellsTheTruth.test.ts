/**
 * ABOUT US — every claim on it must be one the product can stand behind (admin 2026-09-20).
 *
 * The admin asked what About Us should contain, and the honest answer had two halves. The page was
 * four thin lines ("Built with ❤️ by a passionate developer"), AND — the part that mattered more —
 * whatever an admin wrote there reached NOBODY: `navbharat_about_v1` was a localStorage key with no
 * server route anywhere in the repo, so an edit lived in one browser while every user saw the
 * shipped default, under a badge reading "Admin Edit Mode Active".
 *
 * This suite guards both halves, plus the risk a marketing page carries for a business that charges
 * money: a sentence nobody can prove. The Privacy Policy is the authority on what we do with data, so
 * the page's data promise is asserted AGAINST that policy rather than written independently — the
 * same discipline `privacyPolicyTruth.test.ts` already applies to the Meta pixel, and for the same
 * reason: on 2026-09-02 this app's policy claimed three things the code had stopped doing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  DEFAULT_ABOUT,
  aboutContent,
  sanitizeAboutOverrides,
  ABOUT_FIELD_LIMITS,
} from '../src/content/about';
import { PRIVACY_POLICY } from '../src/content/legal/privacyPolicy';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const policy = String(PRIVACY_POLICY ?? '');

describe('the data promise cannot contradict the Privacy Policy', () => {
  const dataPromise = DEFAULT_ABOUT.promises.find((p) => /data/i.test(p.title));

  it('there IS a data promise — it is the one a user most wants before paying', () => {
    expect(dataPromise).toBeTruthy();
  });

  it('every clause of it is a clause the policy itself makes', () => {
    // Taken from the policy's own "What we do NOT do" paragraph, deliberately in its words.
    expect(policy).toContain('we do not sell your personal data');
    expect(policy).toContain('we do not show third-party advertising');
    expect(policy.toLowerCase()).toContain('to train any ai model');

    const body = String(dataPromise?.body ?? '').toLowerCase();
    expect(body).toContain('do not sell your personal data');
    expect(body).toContain('third-party advertising');
    expect(body).toContain('train any ai model');
  });

  it('🔴 it never repeats the sentence that was FALSE in 2026-09', () => {
    // The policy once said "We never share your data with advertisers or data brokers" while the
    // Meta pixel was being built. About Us must not resurrect that claim in a friendlier font.
    const all = JSON.stringify(DEFAULT_ABOUT).toLowerCase();
    expect(all).not.toContain('never share your data with advertisers');
    expect(all).not.toContain('we never share your data');
  });
});

describe('no claim that nobody can prove', () => {
  const all = JSON.stringify(DEFAULT_ABOUT).toLowerCase();

  it('no team size, user count, investor, award or certification', () => {
    // Each of these is easy to write, impossible to withdraw, and this account has already taken one
    // Play policy strike. A number on an About page is a public statement by a business.
    for (const forbidden of [
      'team of', 'members', 'employees', 'investor', 'funded', 'backed by', 'valuation',
      'award', 'certified', 'iso ', 'soc2', 'soc 2', 'million users', 'lakh users', 'crore users',
      'trusted by', 'world-class', "world's best", 'number one', '#1',
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('no company name or registered address until one legally exists', () => {
    // The organization (D-U-N-S) account is in progress; naming a company before it exists is the
    // kind of detail Play checks. Deliberately absent, and this case says so.
    for (const forbidden of ['pvt ltd', 'private limited', 'llp', 'inc.', 'registered office', 'cin:']) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('the contact address is the one the product already publishes', () => {
    // An About page carrying a mailbox nobody reads looks like a way to reach a human and is not one.
    expect(DEFAULT_ABOUT.contactEmail).toBe('info@navbharatai.com');
    expect(readFileSync('src/content/legal/privacyPolicy.ts', 'utf8')).toContain('info@navbharatai.com');
  });

  it('the page points at the legal documents India requires', () => {
    const panel = readFileSync('src/components/panels/AboutPanel.tsx', 'utf8');
    expect(panel).toContain('/privacy');
    expect(panel).toContain('/terms');
    expect(panel).toContain('/grievance');
  });
});

describe('the page says what the app actually does', () => {
  it('names the real thing, not only a mission', () => {
    // The old description — "a mission to empower every Indian with the power of Artificial
    // Intelligence" — never said what the app DOES. A visitor could read it and still not know.
    const opening = `${DEFAULT_ABOUT.tagline} ${DEFAULT_ABOUT.description}`.toLowerCase();
    expect(opening).toContain('app');
    expect(opening).toMatch(/build|builds|built/);
  });

  it('carries every section a person needs before trusting it with money', () => {
    expect(DEFAULT_ABOUT.whatWeBuild.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_ABOUT.indiaFirst.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_ABOUT.promises.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_ABOUT.team.length).toBeGreaterThan(80);
    expect(DEFAULT_ABOUT.honesty.length).toBeGreaterThan(80);
  });

  it('English only — Devanagari is not a national script', () => {
    // The admin's own correction (2026-09-14): "south india wale kaise padhenge isko??"
    expect(JSON.stringify(DEFAULT_ABOUT)).not.toMatch(/[ऀ-ॿ]/);
  });
});

describe('an override patches the page — it can never empty it', () => {
  it('a blank or whitespace value falls back to the shipped copy', () => {
    const out = aboutContent({ headline: '   ', description: '', team: undefined });
    expect(out.headline).toBe(DEFAULT_ABOUT.headline);
    expect(out.description).toBe(DEFAULT_ABOUT.description);
    expect(out.team).toBe(DEFAULT_ABOUT.team);
  });

  it('a real value replaces exactly that field and nothing else', () => {
    const out = aboutContent({ headline: 'Naya Bharat AI' });
    expect(out.headline).toBe('Naya Bharat AI');
    expect(out.promises).toEqual(DEFAULT_ABOUT.promises);
    expect(out.honesty).toBe(DEFAULT_ABOUT.honesty);
  });

  it('🔒 an override can never ADD a section, only replace a field', () => {
    const out = aboutContent({ promises: 'we promise anything' } as never);
    expect(out.promises).toEqual(DEFAULT_ABOUT.promises);
  });

  it('a corrupt or missing record still renders the whole page', () => {
    for (const bad of [null, undefined, 'nonsense', 42, []] as unknown[]) {
      expect(aboutContent(bad as never).headline).toBe(DEFAULT_ABOUT.headline);
    }
  });

  it('an over-long value is bounded, not rejected — and never stored whole', () => {
    const long = 'x'.repeat(5000);
    expect(sanitizeAboutOverrides({ headline: long }).headline).toHaveLength(ABOUT_FIELD_LIMITS.headline);
  });

  it('sanitising drops every field an admin may not set', () => {
    const out = sanitizeAboutOverrides({ headline: 'Hi', promises: [], honesty: 'x', ctaLabel: 'y' });
    expect(Object.keys(out)).toEqual(['headline']);
  });
});

describe('the edit reaches every user — the half that was broken', () => {
  // ⚠️ COMMENTS STRIPPED for the "is it gone?" cases. The change deliberately leaves a note naming
  // the localStorage key it replaced and why; a test that could not tell a comment from a live call
  // would force that explanation to be deleted to stay green.
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const app = stripCodeComments(appSource);
  const route = readFileSync('src/server/routes/siteAbout.ts', 'utf8');
  const serverLines = readFileSync('server.ts', 'utf8').split('\n');
  const panel = readFileSync('src/components/panels/AboutPanel.tsx', 'utf8');

  it('🔴 the localStorage-only store is GONE', () => {
    // It was two lines — one read, one write — and no server route in the whole repo. That is what
    // made "Admin Edit Mode Active" a badge over a control nobody else could see the effect of.
    expect(app).not.toContain('navbharat_about_v1');
    expect(readFileSync('src/config/defaultContent.ts', 'utf8')).not.toContain('DEFAULT_ABOUT_DATA:');
  });

  it('the page is fetched from the server, so every user reads the same words', () => {
    expect(app).toContain("fetch('/api/site/about')");
    expect(route).toContain("app.get('/api/site/about'");
  });

  it('the read is PUBLIC and the write is admin-gated by the SHARED guard', () => {
    expect(route).toContain("app.put('/api/admin/site/about', requireAdmin");
    // Never a second hand-rolled check: adminAuth.ts records what happened last time two route files
    // each invented one — one of them compared a password in a query string.
    expect(route).toContain("import { requireAdmin } from '../lib/adminAuth'");
  });

  it('the route is actually registered — an unregistered route answers nobody', () => {
    // ⚠️ A LINE CHECK, AND BOTH HALVES OF THAT WERE PROVEN NECESSARY.
    // (1) A plain `toContain` PASSED with the registration commented out — a route registered only
    //     inside a comment answers nobody, which is the whole point of this case.
    // (2) The shared `stripCodeComments` cannot be used here: run over server.ts it blanks a large
    //     region INCLUDING this line, so the case would fail on correct code. Recorded rather than
    //     worked around silently — see the PR notes.
    const registered = serverLines.some((line) => /^\s*registerSiteAboutRoutes\(app\)/.test(line));
    expect(registered).toBe(true);
  });

  it('🔒 a write that did not land is reported as a failure, never as saved', () => {
    expect(route).toContain('res.status(503)');
    expect(app).toContain("setAboutSaveState('error')");
    expect(panel).toContain('Not saved');
  });

  it('a normal user is never shown an edit control', () => {
    expect(panel).toContain('isAdmin &&');
  });
});

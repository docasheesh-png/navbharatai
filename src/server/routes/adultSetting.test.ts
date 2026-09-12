// The +18 setting, where it meets the server. The rules themselves are tested in
// src/lib/adultContent.test.ts; this pins that the ROUTES actually use them.
//
// ⚠️ Comments stripped before absence assertions — a file's explanation quotes what it refuses to do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const code = (t: string) => t.split('\n').filter((l) => {
  const x = l.trim();
  return !x.startsWith('//') && !x.startsWith('*') && !x.startsWith('/*');
}).join('\n');

const profileRoutes = () => read('server/routes/profile.ts');
const adultRoute = () => {
  const src = profileRoutes();
  const start = src.indexOf("app.put('/api/profile/adult'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("app.get('/api/profile/cost-alerts'", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
};

describe('turning it ON is a recorded consent, not a preference', () => {
  it('requires an explicit confirmation', () => {
    expect(code(adultRoute())).toContain('confirmed !== true');
  });

  it('turning it OFF asks for nothing — withdrawing consent must be easier than giving it', () => {
    // The confirmation check is guarded by `optedIn`, so the off path never reaches it.
    expect(code(adultRoute())).toContain('if (optedIn && req.body?.confirmed !== true)');
  });

  it('stamps the date and writes an audit line either way', () => {
    const h = code(adultRoute());
    expect(h).toContain('new Date().toISOString()');
    expect(h).toContain("audit(optedIn ? 'ADULT_CONTENT_OPT_IN' : 'ADULT_CONTENT_OPT_OUT'");
  });

  it('a refusal hands back the sentences, so the client never hardcodes them', () => {
    expect(code(adultRoute())).toContain('confirmations: ADULT_CONFIRMATIONS');
  });

  it('is its OWN route — saving a bio must not be able to flip it as a side effect', () => {
    const putProfile = profileRoutes().slice(
      profileRoutes().indexOf("app.put('/api/profile',"),
      profileRoutes().indexOf("app.put('/api/profile/budget'"),
    );
    expect(code(putProfile)).not.toContain('adultOptIn');
  });

  it('requires a verified token like every other profile route', () => {
    expect(code(adultRoute())).toContain('verifyFirebaseToken(req)');
    expect(code(adultRoute())).toContain('401');
  });
});

describe('the setting is read back through the shared normaliser, never raw', () => {
  it('GET /api/profile serves it normalised', () => {
    expect(profileRoutes()).toContain('adult: adultPreferenceFrom(');
  });

  it('the admin list and the account sheet use the same normaliser', () => {
    expect(read('server/routes/admin.ts')).toContain('adultPreferenceFrom(');
    expect(read('server/routes/reports.ts')).toContain('adultPreferenceFrom(');
  });
});

describe('🔒 the admin sees SETTINGS, never content', () => {
  const adminList = () => {
    const src = read('server/routes/admin.ts');
    const start = src.indexOf("app.get('/api/admin/adult-optins'");
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("app.post('/api/admin/users/:userId/tokens'", start));
  };

  it('returns who and when, and opens no collection that holds content', () => {
    const h = code(adminList());
    expect(h).toContain('optedInAt');
    // The precise claim: the only collection it touches is the settings one. Asserting on bare
    // words instead would have caught `e?.message` — a server error string, not a user's message —
    // and an assertion that fires on the wrong thing gets loosened until it catches nothing.
    const collections = [...h.matchAll(/collection\(\s*db\s*,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(collections).toEqual(['user_profiles']);
    for (const forbidden of ['chat_sessions', 'pro_memories', 'user_build_history', 'getWebAppFiles']) {
      expect(h).not.toContain(forbidden);
    }
  });

  it('is admin-gated', () => {
    expect(code(adminList())).toContain('verifyAdminToken');
  });

  it('🔒 a failed read is an ERROR, never an empty list', () => {
    // "Nobody has this on" and "the query failed" must not look the same on this screen.
    expect(code(adminList())).toContain('res.status(500)');
  });

  it('names come from the wallet records the Users tab reads, so one person has one name', () => {
    expect(code(adminList())).toContain('resolveUserIdentities(');
  });
});

describe('🔒 the Android app never offers it, and never shows the content', () => {
  it('the toggle renders nothing in the native shell', () => {
    const toggle = read('components/settings/AdultContentToggle.tsx');
    expect(toggle).toContain('adultSettingAvailable(isNativeApp())');
    expect(toggle).toContain('return null');
  });

  it('and the gate refuses adult content on native regardless — two layers, not one', () => {
    const gate = read('lib/adultContent.ts');
    expect(gate).toContain('if (opts.isNative === true) return false');
  });
});

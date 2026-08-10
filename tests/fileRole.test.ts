/**
 * "What is this file?" — the per-file narration (admin 2026-08-10).
 *
 * The risk here is not a crash, it is a CONFIDENT WRONG LABEL on a file the user cannot read. So the
 * tests are mostly about precedence (a Next.js `pages/api/*` file is an API, not a page) and about
 * `null` being a real answer rather than a failure.
 */

import { describe, it, expect } from 'vitest';
import { fileRole, describeFile, _labels, type FileRole } from '../src/lib/fileRole';

describe('fileRole — precedence', () => {
  it('an exact well-known filename beats every other rule', () => {
    expect(fileRole('package.json')).toBe('deps');
    expect(fileRole('src/config/package.json')).toBe('deps');   // not "config"
    expect(fileRole('prisma/schema.prisma')).toBe('schema');    // not "config"
    expect(fileRole('Dockerfile')).toBe('container');
    expect(fileRole('.env.production')).toBe('env');
    expect(fileRole('index.html')).toBe('entry');
  });

  it('reads a Next.js API route as an API, not a page', () => {
    // The precedence bug this ordering exists to prevent.
    expect(fileRole('pages/api/orders.ts')).toBe('api');
    expect(fileRole('app/api/checkout/route.ts')).toBe('api');
    expect(fileRole('pages/dashboard.tsx')).toBe('page');
  });

  it('reads a migration as a migration, not a generic database file', () => {
    expect(fileRole('prisma/migrations/20260101_init/migration.sql')).toBe('migration');
    expect(fileRole('db/migrations/002_add_users.sql')).toBe('migration');
    expect(fileRole('db/query.sql')).toBe('schema');
  });

  it('recognises the common app shapes', () => {
    expect(fileRole('src/components/LoginForm.tsx')).toBe('component');
    expect(fileRole('src/hooks/useCart.ts')).toBe('hook');
    expect(fileRole('src/store/cartSlice.ts')).toBe('store');
    expect(fileRole('src/context/ThemeProvider.tsx')).toBe('context');
    expect(fileRole('src/services/billing.ts')).toBe('service');
    expect(fileRole('src/models/User.ts')).toBe('model');
    expect(fileRole('src/utils/format.ts')).toBe('util');
    expect(fileRole('src/main.tsx')).toBe('entry');
    expect(fileRole('src/App.tsx')).toBe('entry');
    expect(fileRole('src/styles/global.css')).toBe('style');
    expect(fileRole('public/logo.svg')).toBe('asset');
    expect(fileRole('tailwind.config.js')).toBe('config');
    expect(fileRole('.github/workflows/ci.yml')).toBe('ci');
  });

  it('reads a test as a test even when it sits beside the code it tests', () => {
    expect(fileRole('src/components/Login.test.tsx')).toBe('test');
    expect(fileRole('src/utils/date.spec.ts')).toBe('test');
    expect(fileRole('tests/checkout.ts')).toBe('test');
  });

  it('is case- and prefix-insensitive about the path', () => {
    expect(fileRole('./PACKAGE.JSON')).toBe('deps');
    expect(fileRole('./src/Components/Card.tsx')).toBe('component');
  });

  it('returns null — an honest "do not know" — rather than guessing', () => {
    for (const p of ['', '   ', null, undefined, 'weirdfile', 'a/b/c']) {
      expect(fileRole(p as string), String(p)).toBe(null);
    }
  });
});

describe('describeFile', () => {
  it('gives a plain-language label a non-technical user can read', () => {
    expect(describeFile('src/components/LoginForm.tsx')).toBe('a part of a screen');
    expect(describeFile('pages/api/orders.ts')).toBe('an API endpoint');
    expect(describeFile('package.json')).toBe("the app's package list");
  });

  it('answers in Hindi when the platform is speaking Hindi', () => {
    expect(describeFile('src/components/LoginForm.tsx', 'hi')).toBe('स्क्रीन का एक हिस्सा');
    expect(describeFile('pages/api/orders.ts', 'hi')).toBe('एक API एंडपॉइंट');
  });

  it('returns null for an unknown path, so the UI just shows the filename', () => {
    expect(describeFile('weirdfile')).toBe(null);
    expect(describeFile(null)).toBe(null);
  });

  it('falls back to English for a language it does not have, instead of throwing', () => {
    expect(describeFile('package.json', 'ta' as never)).toBe(describeFile('package.json', 'en'));
  });
});

describe('every role is answered in every language', () => {
  const roles = Object.keys(_labels.en) as FileRole[];

  it('has a label for every role in every language — no silent hole', () => {
    for (const lang of Object.keys(_labels) as Array<keyof typeof _labels>) {
      for (const role of roles) {
        expect(_labels[lang][role], `${lang}/${role}`).toBeTruthy();
      }
    }
  });

  it('Hindi is a real translation, not a copy of English', () => {
    for (const role of roles) {
      expect(_labels.hi[role], role).not.toBe(_labels.en[role]);
      expect(/[ऀ-ॿ]/.test(_labels.hi[role]), `hi/${role} has no Devanagari`).toBe(true);
    }
  });

  it('every label is short enough to sit on one row', () => {
    for (const lang of Object.keys(_labels) as Array<keyof typeof _labels>) {
      for (const role of roles) {
        expect(_labels[lang][role].length, `${lang}/${role}`).toBeLessThanOrEqual(34);
      }
    }
  });

  it('🔒 never claims more than the PATH can prove', () => {
    // The label says what KIND of file it is. A description of behaviour ("handles login with OTP")
    // would be fabrication — the path cannot know it, and a confident wrong line on a file the user
    // cannot read is worse than no line at all.
    for (const lang of Object.keys(_labels) as Array<keyof typeof _labels>) {
      for (const role of roles) {
        expect(_labels[lang][role]).not.toMatch(/\b(handles|implements|validates|fetches|calls)\b/i);
      }
    }
  });
});

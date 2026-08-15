/**
 * A PICTURE IS NOT A LIBRARY — the misdiagnosis that kept an APK build blocked.
 *
 * ADMIN REPORT 2026-08-14, from the real APK screen:
 *
 *   "Your app cannot compile yet — it uses a library ("@assets/772B17C5-7738-43B8-B5C0-…png")
 *    that is not set up (and 15 more problems). NavBharatAI tried to repair it automatically
 *    and could not."
 *
 * It is not a library. It is a picture. `@assets/` is an ordinary Vite path alias, and a scoped npm
 * package (`@scope/name`) has exactly the same shape — so `packageNameFromSpecifier` read the alias as
 * a package, `findMissingDependencies` reported it missing, and the automatic repair went looking for
 * an npm package that cannot exist. The build stayed blocked, and every word the user was shown
 * pointed at the wrong problem.
 *
 * 🔒 THE OLD CODE EXCLUDED EXACTLY ONE ALIAS — `@/` — out of a whole family. That is the bug class:
 * one member of a set was handled and the rest were left to be mistaken for packages. These tests pin
 * the family, not the single case that was reported.
 *
 * ⚠️ And the other half is the SENTENCE. Classifying correctly is not enough if the message still
 * calls a missing image "a library", because that is what sends a user (and the repair pass) in the
 * wrong direction.
 */

import { describe, it, expect } from 'vitest';
import {
  packageNameFromSpecifier,
  isLocalFileSpecifier,
  extractImportedPackages,
  findMissingDependencies,
} from '../src/server/AgentV3/DependencyReconciler';
import { preflightUserMessage } from '../src/server/lib/mobileShipPreflight';

const REPORTED = '@assets/772B17C5-7738-43B8-B5C0-04A7F2A6561B_1773842365564.png';

describe('🔒 the exact specifier from the report', () => {
  it('is NOT read as an npm package', () => {
    expect(packageNameFromSpecifier(REPORTED)).toBeNull();
  });

  it('is not reported as a missing dependency, so nothing tries to install it', () => {
    const files = {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/App.tsx': `import logo from "${REPORTED}";\nimport React from "react";\n`,
    };
    expect(findMissingDependencies(files)).toEqual([]);
  });
});

describe('🔒 the whole alias family, not just the one that was handled', () => {
  it('every common Vite/tsconfig alias is treated as a path', () => {
    for (const spec of [
      '@/lib/utils', '~/components/Button', '@assets/logo.png', '@images/hero.jpg',
      '@components/Card', '@lib/api', '@utils/format', '@src/main', '@styles/theme.css',
      '@pages/Home', '@hooks/useAuth', '@config/env', '@fonts/Inter.woff2', '@shared/types',
    ]) {
      expect(packageNameFromSpecifier(spec), spec).toBeNull();
    }
  });

  it('🔒 a REAL scoped package is still recognised — the fix must not blind the detector', () => {
    // This is the failure the reconciler exists for: @dnd-kit/modifiers imported but never declared.
    expect(packageNameFromSpecifier('@dnd-kit/modifiers')).toBe('@dnd-kit/modifiers');
    expect(packageNameFromSpecifier('@dnd-kit/sortable/dist/x')).toBe('@dnd-kit/sortable');
    expect(packageNameFromSpecifier('@tanstack/react-query')).toBe('@tanstack/react-query');
    expect(packageNameFromSpecifier('react-dom/client')).toBe('react-dom');
    expect(packageNameFromSpecifier('lodash/fp')).toBe('lodash');
  });

  it('🔒 @types/* stays a PACKAGE — the over-broad pattern I first wrote broke this', () => {
    // `@types/` is the most common scoped family in TypeScript, not an alias. Adding `types?` to the
    // alias list made every @types/* invisible to the reconciler; the existing devDependencies test
    // caught it. Pinned here so the alias list can never swallow it again.
    expect(packageNameFromSpecifier('@types/react')).toBe('@types/react');
    expect(packageNameFromSpecifier('@types/node')).toBe('@types/node');
    expect(isLocalFileSpecifier('@types/react')).toBe(false);
  });

  it('still finds a genuinely missing package next to an alias import', () => {
    const files = {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/App.tsx': `import logo from "@assets/a.png";\nimport { x } from "@dnd-kit/modifiers";\n`,
    };
    expect(findMissingDependencies(files)).toEqual(['@dnd-kit/modifiers']);
  });
});

describe('🔒 an asset extension means a FILE, whatever the prefix', () => {
  it('covers the formats a generated app actually imports', () => {
    for (const spec of [
      'some/logo.png', 'x/photo.jpeg', 'y/icon.svg', 'z/anim.webp', 'a/clip.mp4',
      'b/tune.mp3', 'c/font.woff2', 'd/doc.pdf', 'e/data.csv',
    ]) {
      expect(isLocalFileSpecifier(spec), spec).toBe(true);
      expect(packageNameFromSpecifier(spec), spec).toBeNull();
    }
  });

  it('handles a query suffix, which bundlers add routinely', () => {
    expect(isLocalFileSpecifier('@assets/logo.svg?url')).toBe(true);
    expect(isLocalFileSpecifier('./hero.png?w=800')).toBe(true);
  });

  it('🔒 does NOT treat an ordinary code import as a file', () => {
    for (const spec of ['react', '@dnd-kit/core', 'lodash', 'date-fns/format']) {
      expect(isLocalFileSpecifier(spec), spec).toBe(false);
    }
  });

  it('survives junk without throwing', () => {
    for (const junk of ['', '   ', null, undefined]) {
      expect(isLocalFileSpecifier(junk as never)).toBe(false);
      expect(packageNameFromSpecifier(junk as never)).toBeNull();
    }
  });
});

describe('🔒 the sentence the user reads', () => {
  it('calls a missing image an image — not a library', () => {
    const msg = preflightUserMessage([
      { kind: 'missing-package', path: 'package.json', message: `the app imports "${REPORTED}" but package.json does not declare it` },
    ] as never);
    expect(msg).toContain('image or file');
    expect(msg).not.toContain('a library');
  });

  it('still calls a real missing library a library', () => {
    const msg = preflightUserMessage([
      { kind: 'missing-package', path: 'package.json', message: 'the app imports "@dnd-kit/modifiers" but package.json does not declare it' },
    ] as never);
    expect(msg).toContain('a library');
    expect(msg).toContain('@dnd-kit/modifiers');
  });

  it('keeps telling the user what to do next', () => {
    const msg = preflightUserMessage([
      { kind: 'missing-package', path: 'package.json', message: 'the app imports "x" but package.json does not declare it' },
    ] as never);
    expect(msg).toContain('NavBharatAI Pro chat');
  });
});

describe('the import scanner as a whole', () => {
  it('🔒 an alias-heavy file yields no phantom packages', () => {
    const src = `
      import React from 'react';
      import logo from '@assets/logo.png';
      import Button from '@components/Button';
      import { cn } from '@/lib/utils';
      import styles from '~/styles/app.css';
      import { motion } from 'framer-motion';
    `;
    expect(extractImportedPackages(src).sort()).toEqual(['framer-motion', 'react']);
  });
});

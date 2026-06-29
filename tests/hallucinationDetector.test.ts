import { describe, it, expect } from 'vitest';
import {
  detectHallucinations, extractSpecifiers, packageName,
} from '../src/server/AgentV3/HallucinationDetector';

/**
 * P-AI.1 — hallucination detection for generated code.
 */
describe('HallucinationDetector — helpers', () => {
  it('extractSpecifiers finds imports/requires/dynamic/re-exports', () => {
    const src = [
      "import React from 'react';",
      "import { x } from './util';",
      "const a = require('axios');",
      "const b = await import('lodash');",
      "export { y } from './y';",
    ].join('\n');
    const specs = extractSpecifiers(src);
    expect(specs).toContain('react');
    expect(specs).toContain('./util');
    expect(specs).toContain('axios');
    expect(specs).toContain('lodash');
    expect(specs).toContain('./y');
  });

  it('packageName handles scoped + subpaths', () => {
    expect(packageName('react')).toBe('react');
    expect(packageName('lodash/debounce')).toBe('lodash');
    expect(packageName('@tanstack/react-query')).toBe('@tanstack/react-query');
    expect(packageName('@scope/pkg/sub')).toBe('@scope/pkg');
  });
});

describe('HallucinationDetector — detectHallucinations', () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

  it('clean app → high confidence, no signals', () => {
    const files = {
      'package.json': pkg({ react: '^18' }),
      'src/App.tsx': "import React from 'react';\nimport { Foo } from './Foo';\nexport const App = () => <Foo/>;",
      'src/Foo.tsx': 'export const Foo = () => null;',
    };
    const r = detectHallucinations(files);
    expect(r.signals).toEqual([]);
    expect(r.confidence).toBe(100);
    expect(r.isLowConfidence).toBe(false);
  });

  it('flags a hallucinated dependency (imported, not in package.json)', () => {
    const files = {
      'package.json': pkg({ react: '^18' }),
      'src/App.tsx': "import React from 'react';\nimport axios from 'axios';",
    };
    const r = detectHallucinations(files);
    expect(r.counts['hallucinated-dependency']).toBe(1);
    expect(r.signals.some((s) => s.kind === 'hallucinated-dependency' && s.detail === 'axios')).toBe(true);
    expect(r.confidence).toBeLessThan(100);
  });

  it('does NOT flag node builtins or declared deps', () => {
    const files = {
      'package.json': pkg({ react: '^18' }),
      'src/server.ts': "import fs from 'fs';\nimport 'node:path';\nimport React from 'react';",
    };
    expect(detectHallucinations(files).counts['hallucinated-dependency']).toBe(0);
  });

  it('flags an unresolved local import', () => {
    const files = {
      'package.json': pkg({}),
      'src/App.tsx': "import { Missing } from './DoesNotExist';",
    };
    const r = detectHallucinations(files);
    expect(r.counts['unresolved-local-import']).toBe(1);
    expect(r.signals.some((s) => s.detail === './DoesNotExist')).toBe(true);
  });

  it('resolves a local import that exists (with extension inference)', () => {
    const files = {
      'package.json': pkg({}),
      'src/App.tsx': "import { Foo } from './components/Foo';",
      'src/components/Foo.tsx': 'export const Foo = 1;',
    };
    expect(detectHallucinations(files).counts['unresolved-local-import']).toBe(0);
  });

  it('flags placeholder / not-implemented stubs', () => {
    const files = {
      'package.json': pkg({}),
      'src/x.ts': "export function pay() { throw new Error('not implemented yet'); } // TODO wire it",
    };
    expect(detectHallucinations(files).counts['placeholder-stub']).toBe(1);
  });

  it('drops below the low-confidence threshold with several signals', () => {
    const files = {
      'package.json': pkg({}),
      'src/App.tsx': "import a from 'axios';\nimport b from 'lodash';\nimport { X } from './missing';",
    };
    const r = detectHallucinations(files, { threshold: 70 });
    expect(r.confidence).toBeLessThan(70);
    expect(r.isLowConfidence).toBe(true);
  });
});

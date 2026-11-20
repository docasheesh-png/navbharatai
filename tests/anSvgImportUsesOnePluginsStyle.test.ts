/**
 * Q-2766 (BR2001): the builder wrote `import { ReactComponent as X } from './x.svg?react'` — Create React App's
 * named export with vite-plugin-svgr v4's `?react` query, which gives only a default export. The preview logged
 * errors until the plugin was reinstalled and rewired. Now the builder hears the exact fix while the file is open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findMixedSvgImports, mixedSvgImportWriteNote } from '../src/server/AgentV3/svgImportShape';

describe('an SVG import uses one plugin\'s style', () => {
  it('the reported line is caught, with the default-import fix', () => {
    const src = "import React from 'react';\nimport { ReactComponent as StartIcon } from './start.svg?react';\n";
    expect(findMixedSvgImports(src)).toEqual([{ line: 2, spec: './start.svg', local: 'StartIcon' }]);
    expect(mixedSvgImportWriteNote('src/Taskbar.tsx', src)).toContain("src/Taskbar.tsx:2 → import StartIcon from './start.svg?react';");
  });

  it('each plugin\'s own correct form is silent', () => {
    expect(mixedSvgImportWriteNote('a.tsx', "import StartIcon from './start.svg?react';")).toBe('');
    expect(mixedSvgImportWriteNote('a.tsx', "import { ReactComponent as Logo } from './logo.svg';")).toBe('');
    expect(mixedSvgImportWriteNote('a.tsx', "import logoUrl from './logo.svg?url';")).toBe('');
  });

  it('every written file passes through the note (wiring)', () => {
    const d = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(d).toContain('security += mixedSvgImportWriteNote(p, files[p]);');
  });
});

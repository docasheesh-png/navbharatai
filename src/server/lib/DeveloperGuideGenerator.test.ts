import { describe, it, expect } from 'vitest';
import { generateDevGuide } from './DeveloperGuideGenerator';

describe('generateDevGuide', () => {
  it('emits DEVELOPER_GUIDE.md with the core onboarding sections', () => {
    const out = generateDevGuide({ name: 'ShopApp', framework: 'react', packageManager: 'npm' });
    const md = out.files['DEVELOPER_GUIDE.md'];
    expect(md).toBeDefined();
    expect(md).toContain('# Developer Guide — ShopApp');
    for (const h of ['## Prerequisites', '## Local setup', '## Common tasks', '## Testing', '## Build & deploy', '## Conventions', '## Troubleshooting']) {
      expect(md).toContain(h);
    }
  });

  it('uses the selected package manager in commands', () => {
    const npm = generateDevGuide({ framework: 'react', packageManager: 'npm', scripts: [{ name: 'dev', cmd: 'vite' }] }).files['DEVELOPER_GUIDE.md'];
    expect(npm).toContain('npm install');
    expect(npm).toContain('npm run dev');

    const pnpm = generateDevGuide({ framework: 'react', packageManager: 'pnpm', scripts: [{ name: 'dev', cmd: 'vite' }] }).files['DEVELOPER_GUIDE.md'];
    expect(pnpm).toContain('pnpm install');
    expect(pnpm).toContain('pnpm dev');
  });

  it('gives framework-aware "add a X" recipes (Next = file routing)', () => {
    const next = generateDevGuide({ framework: 'next' }).files['DEVELOPER_GUIDE.md'];
    expect(next).toContain('Next.js is file-routed');
    expect(next).toContain('app/api/');

    const express = generateDevGuide({ framework: 'express' }).files['DEVELOPER_GUIDE.md'];
    expect(express).toContain('Add an API endpoint');
    expect(express).toContain('app.use(');
  });

  it('lists env vars and a scripts table when provided', () => {
    const out = generateDevGuide({
      framework: 'react',
      envKeys: ['API_URL', 'STRIPE_KEY'],
      scripts: [{ name: 'dev', cmd: 'vite', purpose: 'start dev server' }, { name: 'test', cmd: 'vitest' }],
    });
    const md = out.files['DEVELOPER_GUIDE.md'];
    expect(md).toContain('### Environment variables');
    expect(md).toContain('`API_URL`');
    expect(md).toContain('`STRIPE_KEY`');
    expect(md).toContain('## Scripts');
    expect(md).toContain('start dev server');
    // A test script → real "run the suite" section, not the fallback prose.
    expect(md).toContain('Run the test suite');
    expect(md).toContain('npm run test');
  });

  it('handles a python app without Node-only steps', () => {
    const md = generateDevGuide({ name: 'API', framework: 'python' }).files['DEVELOPER_GUIDE.md'];
    expect(md).toContain('python -m venv');
    expect(md).toContain('pip install -r requirements.txt');
    expect(md).not.toContain('npm install');
  });

  it('is honest for an unknown framework (generic guidance, no invented paths)', () => {
    const md = generateDevGuide({ framework: 'cobol' }).files['DEVELOPER_GUIDE.md'];
    expect(md).toContain('## Common tasks');
    expect(md).toContain('Follow the existing folder layout');
    // never invents a framework-specific file path
    expect(md).not.toMatch(/app\/api\//);
    expect(md).not.toContain('SvelteKit');
  });

  it('escapes pipes in a script purpose so the table never breaks', () => {
    const md = generateDevGuide({
      framework: 'node',
      scripts: [{ name: 'build', cmd: 'tsc', purpose: 'compile | bundle' }],
    }).files['DEVELOPER_GUIDE.md'];
    expect(md).toContain('compile \\| bundle');
  });
});

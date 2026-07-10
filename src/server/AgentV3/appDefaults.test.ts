import { describe, it, expect } from 'vitest';
import { planAppDefaults } from './appDefaults';

// U-2: app-scaffold quality defaults. Pure + idempotent — assert missing tags are added, present ones
// are left alone, and re-running changes nothing.

const bareHtml = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body><div id="root"></div></body>
</html>
`;

describe('planAppDefaults', () => {
  it('adds missing SEO/meta/manifest tags and an html lang', () => {
    const r = planAppDefaults(bareHtml, 'Todo App');
    expect(r.indexHtml).toContain('lang="en"');
    expect(r.indexHtml).toContain('name="viewport"');
    expect(r.indexHtml).toContain('<title>Todo App</title>');
    expect(r.indexHtml).toContain('name="description"');
    expect(r.indexHtml).toContain('property="og:title"');
    expect(r.indexHtml).toContain('rel="manifest"');
    expect(r.added).toContain('viewport');
    expect(r.added).toContain('html lang="en"');
    // did NOT re-add the charset that was already present
    expect(r.added).not.toContain('charset');
    expect((r.indexHtml!.match(/charset/gi) || []).length).toBe(1);
  });

  it('always provides a manifest + robots file', () => {
    const r = planAppDefaults(bareHtml, 'X');
    expect(r.files['manifest.webmanifest']).toContain('"display": "standalone"');
    expect(r.files['robots.txt']).toContain('User-agent: *');
    expect(JSON.parse(r.files['manifest.webmanifest']).name).toBe('X');
  });

  it('is idempotent — running on its own output adds nothing', () => {
    const first = planAppDefaults(bareHtml, 'App');
    const second = planAppDefaults(first.indexHtml, 'App');
    expect(second.added).toEqual([]);
    expect(second.indexHtml).toBe(first.indexHtml);
  });

  it('leaves a fully-configured head untouched', () => {
    const full = `<!doctype html><html lang="en"><head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Done</title>
      <meta name="description" content="d" />
      <meta property="og:title" content="t" />
      <meta property="og:description" content="d" />
      <meta name="twitter:card" content="summary" />
      <link rel="manifest" href="/manifest.webmanifest" />
    </head><body></body></html>`;
    const r = planAppDefaults(full, 'Done');
    expect(r.added).toEqual([]);
    expect(r.indexHtml).toBe(full);
  });

  it('returns null html + standalone files when there is no index.html', () => {
    const r = planAppDefaults(null, 'App');
    expect(r.indexHtml).toBeNull();
    expect(r.files['manifest.webmanifest']).toBeDefined();
    expect(r.added).toEqual([]);
  });
});

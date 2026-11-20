/**
 * failedbr #2133 (2026-11-09, an Astro astrology site): four "stylesheet imported by nothing" warnings. The check
 * read only `.js`/`.ts` imports and `.html` links, so a stylesheet wired by an Astro layout, a Vue SFC or a Svelte
 * component was reported as unwired. And our own `nbai-native.css` was written into an app with no index.html,
 * where nothing could ever link it.
 */
import { describe, expect, it } from 'vitest';
import { findOrphanStylesheets } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';
import { NATIVE_FEEL_HREF } from '../src/server/AgentV3/nativeFeel';

const orphans = (files: Record<string, string>): string[] => findOrphanStylesheets(files).map((o) => o.stylesheet);

describe('a stylesheet wired by a component file is wired', () => {
  it('an Astro layout: a <link> to a public sheet and a frontmatter import', () => {
    expect(orphans({
      'src/layouts/Layout.astro': "---\nimport '../styles/global.css';\n---\n<html><head><link rel=\"stylesheet\" href=\"/styles/global-public.css\" /></head><body><slot /></body></html>",
      'src/styles/global.css': 'body{margin:0}',
      'public/styles/global-public.css': 'h1{color:red}',
    })).toEqual([]);
  });

  it('a Vue SFC style src and a Svelte @import', () => {
    expect(orphans({
      'src/App.vue': '<template><div/></template>\n<style src="./styles/app.css"></style>',
      'src/styles/app.css': 'div{}',
      'src/Card.svelte': "<div/>\n<style>\n  @import './card.css';\n</style>",
      'src/card.css': 'div{}',
    })).toEqual([]);
  });

  it('a sheet nobody wires is still an orphan — in a component app too', () => {
    expect(orphans({ 'src/layouts/Layout.astro': '<html><slot /></html>', 'src/styles/unused.css': 'a{}' })).toEqual(['src/styles/unused.css']);
  });
});

describe('our native-feel sheet is written only where it is linked', () => {
  const file = NATIVE_FEEL_HREF.replace(/^\//, '');
  it('no index.html ⇒ no nbai-native.css', () => {
    expect(Object.keys(planAppDefaults(null, 'Astro site').files)).not.toContain(file);
  });
  it('an index.html ⇒ the file and its <link> together', () => {
    const plan = planAppDefaults('<!doctype html><html><head></head><body></body></html>', 'App');
    expect(plan.files[file]).toBeTruthy(); // on by default (AGENTV3_NATIVE_FEEL)
    expect(plan.indexHtml).toContain(NATIVE_FEEL_HREF);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';
import { injectPreviewBridge } from '../src/server/AgentV3/previewBridge';
import { noJourneyReason, LOOKUP_ONLY_REASON } from '../src/server/AgentV3/journeyDerivation';
import {
  workspaceContentHash,
  identitySource,
  fileContentHashes,
  savedDivergesFromSandbox,
  snapshotConfirmation,
} from '../src/server/AgentV3/snapshotIdentity';

/**
 * AUTOPSY 2d076ce8 (2026-09-30) — a Bhagavad Gita reader built from NavBharatAI's own tested template.
 *
 * 1. The Search probe spoke English only. The template labels its search box in Hindi —
 *    `<label htmlFor="q">खोजें (हिन्दी अर्थ या अध्याय)</label>` — so the probe reported "Search has NO
 *    visible control", a paid repair pass ran on the second rung, moved a working search box (still in
 *    Hindi, so still "absent"), and the false finding became the build's reported root cause.
 * 2. The snapshot said "Both sides hold the same 21 file(s), so a file's CONTENT changed" and could not
 *    say which file, nor whether the sandbox moved or the saved set held something the sandbox never ran.
 */

// The prompt from the report, verbatim (it is the template's own starter-chip prompt).
const PROMPT =
  'Build a Bhagavad Gita reader in Hindi: all eighteen chapters listed with their names, each shloka shown in Devanagari with a simple Hindi meaning below it, a verse of the day chosen from the date so it is the same for everyone all day, bookmarks saved in the browser, search across the Hindi meaning and the chapter name, and next and previous navigation inside a chapter. State clearly and honestly how many shlokas the app carries out of the full seven hundred, so it never implies it holds the whole text. Large readable Devanagari, mobile-first, light/dark mode.';

// The rendered shape of the template's first screen: heading, theme toggle, tabs, the verse, and the
// Hindi-labelled search field.
const GITA_DOM = `<div id="root"><div class="container">
  <div class="row"><h1>श्रीमद् भगवद्गीता</h1><button aria-label="Switch to dark mode">🌙</button></div>
  <div class="alert">इस ऐप में गीता के <strong>40 चुने हुए श्लोक</strong> हैं (कुल 700 में से)</div>
  <div class="row"><button aria-current="page">आज का श्लोक</button><button class="btn-ghost">अध्याय</button><button class="btn-ghost">सहेजे गए</button></div>
  <h2>आज का श्लोक</h2><p>कर्मण्येवाधिकारस्ते मा फलेषु कदाचन</p>
  <div class="field"><label for="q">खोजें (हिन्दी अर्थ या अध्याय)</label>
  <input id="q" value="" placeholder="जैसे: कर्म, भक्ति, 2.47"></div>
</div></div>`;

describe('Search is found when the app labels it in Hindi', () => {
  it('the Gita template’s own search box counts as a Search control', () => {
    const r = checkFeaturePresence(PROMPT, GITA_DOM);
    expect(r.missing).not.toContain('Search');
    expect(r.present).toContain('Search');
  });

  it('a Devanagari placeholder alone is enough', () => {
    const dom = GITA_DOM.replace('<label for="q">खोजें (हिन्दी अर्थ या अध्याय)</label>', '')
      .replace('placeholder="जैसे: कर्म, भक्ति, 2.47"', 'placeholder="श्लोक खोजें…"');
    expect(checkFeaturePresence(PROMPT, dom).present).toContain('Search');
  });

  it('the English forms still count, exactly as before', () => {
    const dom = GITA_DOM.replace('<label for="q">खोजें (हिन्दी अर्थ या अध्याय)</label>', '<label for="q">Search verses</label>')
      .replace('placeholder="जैसे: कर्म, भक्ति, 2.47"', '');
    expect(checkFeaturePresence(PROMPT, dom).present).toContain('Search');
    const typed = GITA_DOM.replace('<input id="q"', '<input type="search" id="q"').replace('खोजें', 'प्रश्न');
    expect(checkFeaturePresence(PROMPT, typed).present).toContain('Search');
  });

  it('a search WORD with no field to type into is still missing — the field is what counts', () => {
    const noField = GITA_DOM
      .replace(/<div class="field">[\s\S]*?<\/div>/, '<p>खोजें — जल्द आ रहा है</p>');
    const r = checkFeaturePresence(PROMPT, noField);
    expect(r.missing).toContain('Search');
  });

  it('a field whose label names something else is not a search box', () => {
    const other = GITA_DOM.replace('खोजें (हिन्दी अर्थ या अध्याय)', 'आपका नाम').replace('placeholder="जैसे: कर्म, भक्ति, 2.47"', 'placeholder="नाम"');
    expect(checkFeaturePresence(PROMPT, other).missing).toContain('Search');
  });
});

describe('Every probe reads Devanagari, not only Search', () => {
  const base = (buttons: string): string =>
    `<div id="root"><h1>मेरे काम</h1><input id="t" placeholder="काम लिखें"><ul><li>दूध लाना ${buttons}</li></ul><button aria-label="Switch to dark mode">🌙</button></div>`;

  it('a Hindi delete button is a delete control', () => {
    const r = checkFeaturePresence('Build a todo list where I can delete tasks, with dark mode', base('<button>हटाएँ</button>'));
    expect(r.present).toContain('Delete / remove');
  });

  it('a Hindi edit button is an edit control', () => {
    const r = checkFeaturePresence('Build a todo list where I can edit tasks, with dark mode', base('<button>संपादित करें</button>'));
    expect(r.present).toContain('Edit / update');
  });

  it('a Hindi add button is an add control', () => {
    const r = checkFeaturePresence('Build a todo list where I can add a task, with dark mode', base('<button>जोड़ें</button>'));
    expect(r.present).toContain('Add / create');
  });

  it('the precomposed nukta form of जोड़ें counts too', () => {
    const r = checkFeaturePresence('Build a todo list where I can add a task, with dark mode', base('<button>जोड़ें</button>'));
    expect(r.present).toContain('Add / create');
  });

  it('a Hindi sign-in button is a login control', () => {
    const r = checkFeaturePresence('Build a notes app with login and dark mode', base('<button>लॉगिन</button>'));
    expect(r.present).toContain('Login / authentication');
  });

  it('what counts as REQUESTED did not widen: a Hindi word in the page cannot create a probe', () => {
    const r = checkFeaturePresence('Build a calculator with dark mode', base('<button>हटाएँ</button><button>खोजें</button>'));
    expect(r.probes.map((p) => p.feature)).toEqual(['theme']);
  });
});

describe('The snapshot names the file that differs, and where the difference came from', () => {
  const copyTree = { 'src/App.tsx': 'A1', 'index.html': '<html></html>', 'package.json': '{}' };

  it('a file the SANDBOX changed after the copy is named as a late write', () => {
    const sandboxNow = { ...copyTree, 'src/App.tsx': 'A2' };
    const saved = { ...sandboxNow };
    const v = snapshotConfirmation({
      taken: { url: 'https://x.web.app', filesHash: workspaceContentHash(identitySource(copyTree)), filePaths: Object.keys(copyTree), fileHashes: fileContentHashes(copyTree) },
      persistedHash: workspaceContentHash(identitySource(saved)),
      persistedPaths: Object.keys(saved),
      persistedFileHashes: fileContentHashes(saved),
      sandboxFileHashes: fileContentHashes(sandboxNow),
    });
    expect(v.action).toBe('stale');
    expect(v.reason).toContain('Changed: src/App.tsx');
    expect(v.reason).toContain('changed in the sandbox AFTER the copy');
    expect(v.reason).not.toContain('never ran');
  });

  it('a SAVED file the sandbox never ran is named as a divergence, not a late write', () => {
    const sandboxNow = { ...copyTree };
    const saved = { ...copyTree, 'package.json': '{"name":"x"}' };
    const v = snapshotConfirmation({
      taken: { url: 'https://x.web.app', filesHash: workspaceContentHash(identitySource(copyTree)), filePaths: Object.keys(copyTree), fileHashes: fileContentHashes(copyTree) },
      persistedHash: workspaceContentHash(identitySource(saved)),
      persistedPaths: Object.keys(saved),
      persistedFileHashes: fileContentHashes(saved),
      sandboxFileHashes: fileContentHashes(sandboxNow),
    });
    expect(v.reason).toContain('Changed: package.json');
    expect(v.reason).toContain('SAVED with content the sandbox never ran');
  });

  it('the preview bridge never counts as a difference', () => {
    const doc = '<html>\n  <head>\n    <title>Gita</title>\n  </head>\n</html>';
    const bridged = { 'index.html': injectPreviewBridge(doc, 'live') };
    expect(bridged['index.html']).not.toBe(doc);
    expect(fileContentHashes(bridged)['index.html']).toBe(fileContentHashes({ 'index.html': doc })['index.html']);
  });

  it('without per-file hashes the old sentence is unchanged — nothing is invented', () => {
    const saved = { ...copyTree, 'src/App.tsx': 'A2' };
    const v = snapshotConfirmation({
      taken: { url: 'https://x.web.app', filesHash: workspaceContentHash(identitySource(copyTree)), filePaths: Object.keys(copyTree) },
      persistedHash: workspaceContentHash(identitySource(saved)),
      persistedPaths: Object.keys(saved),
    });
    expect(v.reason).toContain('same 3 file(s)');
    expect(v.reason).not.toContain('Changed:');
  });

  it('a match is still a match', () => {
    const v = snapshotConfirmation({
      taken: { url: 'https://x.web.app', filesHash: workspaceContentHash(identitySource(copyTree)), filePaths: Object.keys(copyTree), fileHashes: fileContentHashes(copyTree) },
      persistedHash: workspaceContentHash(identitySource(copyTree)),
      persistedPaths: Object.keys(copyTree),
      persistedFileHashes: fileContentHashes(copyTree),
      sandboxFileHashes: fileContentHashes(copyTree),
    });
    expect(v.action).toBe('restamp');
  });
});

describe('savedDivergesFromSandbox — a recorded write that is not what the sandbox runs', () => {
  it('names only paths present on both sides whose content differs', () => {
    expect(savedDivergesFromSandbox({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual(['b']);
  });
  it('an unreadable side is "not measured", never a divergence', () => {
    expect(savedDivergesFromSandbox(null, { a: '1' })).toEqual([]);
    expect(savedDivergesFromSandbox({ a: '1' }, undefined)).toEqual([]);
  });
});

describe('The route carries the evidence (source guard — tsc and vitest cannot see an unwired instrument)', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const diag = readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
  const sugg = readFileSync(join(__dirname, '../src/server/AgentV3/buildFindingSuggestions.ts'), 'utf8');

  it('the copy records per-file hashes', () => {
    expect(route).toMatch(/snapshotTaken = \{[^}]*fileHashes: source \? fileContentHashes\(source\)/);
  });
  it('the confirmation passes the saved and the sandbox per-file hashes', () => {
    expect(route).toContain('persistedFileHashes: fileContentHashes(persisted)');
    expect(route).toContain('sandboxFileHashes: sandboxScan && persisted === toSave ? fileContentHashes(sandboxScan) : undefined');
  });
  it('a divergence is recorded, and is a fact about our engine, never the user’s app', () => {
    expect(route).toContain("code: 'SAVED_SOURCE_DIVERGES'");
    expect(diag).toContain("'SAVED_SOURCE_DIVERGES'");
    expect(sugg).toContain("'SAVED_SOURCE_DIVERGES'");
  });
});

describe('A live search box is not told to fix a label it already has', () => {
  const GITA_APP = {
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
    'src/App.tsx': `export default function App() {
  const [search, setSearch] = useState('');
  return (
    <div className="field">
      <label htmlFor="q">खोजें (हिन्दी अर्थ या अध्याय)</label>
      <input id="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="जैसे: कर्म, भक्ति, 2.47" />
    </div>
  );
}`,
  };

  it('a pure lookup (nothing anywhere saves) gets the lookup-only reason — never "give each field a name and a label"', () => {
    // Since #3401 (autopsy ee0e6de5) met this fix at merge: the reader as written saves nothing, so the
    // most specific true sentence is the lookup-only one, and the gate reads it as none-derivable.
    const reason = noJourneyReason(GITA_APP);
    expect(reason).toBe(LOOKUP_ONLY_REASON);
    expect(reason).not.toContain('`name`');
    expect(reason).not.toContain('no field this check could address');
  });

  it('says the field acts as you type when the app DOES save somewhere but this form has no submit step', () => {
    // The case this sentence is for: addressable fields, no submit, and a save elsewhere (an autosave).
    const saving = { ...GITA_APP, 'src/App.tsx': GITA_APP['src/App.tsx'].replace('setSearch(e.target.value)', "{ setSearch(e.target.value); localStorage.setItem('q', e.target.value); }") };
    const reason = noJourneyReason(saving);
    expect(reason).toContain('act as you type');
    expect(reason).not.toContain('`name`');
    expect(reason).not.toContain('no field this check could address');
  });

  it('a form whose fields genuinely cannot be addressed still gets the remedy', () => {
    const bare = { ...GITA_APP, 'src/App.tsx': GITA_APP['src/App.tsx'].replace('<label htmlFor="q">खोजें (हिन्दी अर्थ या अध्याय)</label>', '').replace(' id="q"', '').replace(' placeholder="जैसे: कर्म, भक्ति, 2.47"', '') };
    expect(noJourneyReason(bare)).not.toContain('act as you type');
  });
});

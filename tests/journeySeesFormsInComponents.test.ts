import { describe, it, expect } from 'vitest';
import {
  deriveJourneys,
  noJourneyReason,
  formSourcesFor,
  resolveLocalImport,
  MAX_IMPORTS_PER_PAGE, NO_DATA_ENTRY_REASON } from '../src/server/AgentV3/journeyDerivation';

/**
 * 🔴 THE EXACT REPORT (build e4ebcb5f, 2026-09-17 — the SECOND occurrence; the first was recorded as
 * an open root cause in PR #2988 rather than fixed).
 *
 * A chat app. The agent read `src/App.tsx`, `src/components/ChatWindow.tsx` and `src/services/ai.ts`
 * in its own timeline. The report then said:
 *
 *     JOURNEY_NOT_DERIVED — "No user journey was run — this app has no form for a journey to fill
 *                            in — nothing here takes user input."
 *
 * …and, 30 seconds earlier in the SAME report:
 *
 *     ACCESSIBILITY — "WCAG 1.3.1: 4 form field(s) with no label"
 *
 * Two of our own scanners, the same files, opposite answers. `deriveJourneys` and `noJourneyReason`
 * read only `files[page]`, and a React page composes its UI from components — so the input lived in
 * `ChatInput.tsx`, one import away, and neither ever looked.
 */
const CHAT_APP: Record<string, string> = {
  'src/App.tsx': `
    import ChatWindow from './components/ChatWindow';
    import ChatInput from './components/ChatInput';
    import { sendMessage } from './services/ai';
    export default function App() {
      return <div className="app"><ChatWindow /><ChatInput /></div>;
    }
  `,
  'src/components/ChatWindow.tsx': `
    export default function ChatWindow({ messages }) {
      return <ul>{messages.map((m) => <li key={m.id}>{m.text}</li>)}</ul>;
    }
  `,
  'src/components/ChatInput.tsx': `
    export default function ChatInput({ onSend }) {
      return (
        <form onSubmit={onSend}>
          <input name="message" placeholder="Type a message" />
          <button type="submit">Send</button>
        </form>
      );
    }
  `,
  'src/services/ai.ts': 'export async function sendMessage(t: string) { return fetch("/api/chat"); }',
  'src/main.tsx': "import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')).render(<App />);",
};

describe('a journey can be derived from a form the page COMPOSES, not only one it contains', () => {
  it('🔴 the chat app: a journey is now derived from ChatInput.tsx', () => {
    const journeys = deriveJourneys({ files: CHAT_APP, marker: 'nbai-xyz', routes: ['/'] });
    expect(journeys.length).toBeGreaterThan(0);
    expect(journeys[0].fields.length).toBeGreaterThan(0);
    expect(journeys[0].submit).not.toBeNull();
  });

  it('🔴 …and the report stops saying the app takes no user input', () => {
    // The verbatim sentence from the report, about an app with four real form fields.
    expect(noJourneyReason(CHAT_APP)).not.toContain('nothing here takes user input');
  });

  it("the journey keeps the PAGE's route, never the component's filename", () => {
    const files = {
      'src/pages/Checkout.tsx': "import Form from '../components/CheckoutForm';\nexport default () => <Form />;",
      'src/components/CheckoutForm.tsx':
        '<form><input name="card" placeholder="Card number" /><button type="submit">Pay</button></form>',
    };
    const [j] = deriveJourneys({ files, marker: 'm1', routes: ['/checkout'] });
    // Derived from CheckoutForm.tsx — but a component has no route, and routeForFile('CheckoutForm')
    // would have resolved to '/' and driven the browser to the wrong page.
    expect(j?.route).toBe('/checkout');
  });

  it('a page with its OWN form is unchanged — its own source still wins', () => {
    const files = {
      'src/pages/Login.tsx':
        '<form><input name="email" placeholder="Email" /><button type="submit">Log in</button></form>',
    };
    const [j] = deriveJourneys({ files, marker: 'm1', routes: ['/login'] });
    expect(j?.fields[0].target.value).toBe('email');
  });

  it('🔒 a genuinely input-free app is still correctly reported as having none', () => {
    // The guard that must not regress: a canvas game has no data entry, and saying it does would be
    // the category error this module was built to prevent.
    const game = {
      'src/App.tsx': "import { draw } from './render';\nexport default () => <canvas id='c' />;",
      'src/render.tsx': 'export const draw = (ctx) => ctx.getContext("2d");',
      'src/main.tsx': "createRoot(document.getElementById('root')).render(<App />);",
    };
    expect(deriveJourneys({ files: game, marker: 'm1' })).toHaveLength(0);
    // ⚠️ THE WORDING MOVED ON 2026-09-20, THE GUARD DID NOT (autopsy f97eb0ec). This used to expect
    // "no form for a journey to fill in", whose second clause reads "— nothing here takes user
    // input" — false of a canvas game with touch handlers, arrow keys and on-screen buttons, which is
    // what the admin's falling-block game was told. A game now gets the neutral sentence that the
    // no-pages branch has always given a canvas game, and the guard this test exists for is unchanged
    // and asserted directly below: no journey is derived, and nothing claims the app has data entry.
    expect(noJourneyReason(game)).toBe(NO_DATA_ENTRY_REASON);
    expect(noJourneyReason(game)).not.toContain('takes user input');
  });
});

describe('formSourcesFor — one level, local only, deterministic', () => {
  it('returns the page first, then the components it imports', () => {
    const paths = formSourcesFor('src/App.tsx', CHAT_APP).map((s) => s.path);
    expect(paths[0]).toBe('src/App.tsx');
    expect(paths).toContain('src/components/ChatInput.tsx');
    expect(paths).toContain('src/components/ChatWindow.tsx');
  });

  it('never follows a PACKAGE import', () => {
    const files = {
      'src/App.tsx': "import React from 'react';\nimport { Button } from '@mui/material';",
      'react': 'not a real file',
    };
    expect(formSourcesFor('src/App.tsx', files).map((s) => s.path)).toEqual(['src/App.tsx']);
  });

  it('does NOT recurse — one level only, so a deep graph cannot explode the search', () => {
    const files = {
      'src/App.tsx': "import A from './A';",
      'src/A.tsx': "import B from './B';",
      'src/B.tsx': '<form><input name="deep" /><button type="submit">Go</button></form>',
    };
    const paths = formSourcesFor('src/App.tsx', files).map((s) => s.path);
    expect(paths).toEqual(['src/App.tsx', 'src/A.tsx']);
    expect(paths).not.toContain('src/B.tsx');
  });

  it('is bounded even on a barrel file', () => {
    const files: Record<string, string> = { 'src/App.tsx': '' };
    let src = '';
    for (let i = 0; i < 40; i++) { src += `import C${i} from './c${i}';\n`; files[`src/c${i}.tsx`] = '<div />'; }
    files['src/App.tsx'] = src;
    expect(formSourcesFor('src/App.tsx', files).length).toBeLessThanOrEqual(MAX_IMPORTS_PER_PAGE + 1);
  });

  it('never throws on junk', () => {
    expect(() => formSourcesFor('', {})).not.toThrow();
    expect(formSourcesFor('src/Missing.tsx', {})).toEqual([]);
  });
});

describe('resolveLocalImport', () => {
  const files = {
    'src/components/Form.tsx': 'x',
    'src/components/Panel/index.tsx': 'x',
    'src/lib/util.ts': 'x',
  };

  it('resolves ./ and ../ and the @/ alias', () => {
    expect(resolveLocalImport('src/App.tsx', './components/Form', files)).toBe('src/components/Form.tsx');
    expect(resolveLocalImport('src/pages/Home.tsx', '../components/Form', files)).toBe('src/components/Form.tsx');
    expect(resolveLocalImport('src/App.tsx', '@/components/Form', files)).toBe('src/components/Form.tsx');
  });

  it('resolves a directory to its index file', () => {
    expect(resolveLocalImport('src/App.tsx', './components/Panel', files)).toBe('src/components/Panel/index.tsx');
  });

  it('honours an explicit extension', () => {
    expect(resolveLocalImport('src/App.tsx', './lib/util.ts', files)).toBe('src/lib/util.ts');
  });

  it('returns null for a package, an unknown path, or junk', () => {
    expect(resolveLocalImport('src/App.tsx', 'react', files)).toBeNull();
    expect(resolveLocalImport('src/App.tsx', './nope', files)).toBeNull();
    expect(resolveLocalImport('', './x', files)).toBeNull();
    expect(resolveLocalImport('src/App.tsx', '', files)).toBeNull();
  });
});

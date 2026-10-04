// Q-362 (autopsy 981ce4cc, admin chose option (a) 2026-10-04) — an app whose own screen shows an error
// message has not done its job, and the report must say so.
//
// The PDF app from that report was called READY (92/100) and published while its page read "Failed to
// load PDF file." — react-pdf's own error element. Every render check asked "did it paint?", and a page
// that paints an error is painted. These tests encode that exact element, the other two shapes the
// detector reads, and the designed pages it must never call broken.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { visibleAppError, appShowsErrorNote, APP_SHOWS_ERROR_CODE } from '../src/server/AgentV3/visibleAppError';
import { FINDING_SUGGESTIONS } from '../src/server/AgentV3/buildFindingSuggestions';

const page = (body: string) => `<html><head><style>.x{color:red}</style></head><body><div id="root">${body}</div></body></html>`;

describe('an app that shows its own error message is caught', () => {
  it('the real 981ce4cc element: react-pdf\'s error message', () => {
    const html = page('<header><h1>PDF Editor</h1></header><main><div class="react-pdf__Document"><div class="react-pdf__message react-pdf__message--error">Failed to load PDF file.</div></div></main>');
    expect(visibleAppError(html)).toEqual({ text: 'Failed to load PDF file.', via: 'error-box' });
  });

  it('an alert whose text says something failed', () => {
    const html = page('<div role="alert" class="toast">Could not connect to the server. Please try again.</div><button>Retry</button>');
    expect(visibleAppError(html)?.via).toBe('alert');
  });

  it('a camelCase error box', () => {
    expect(visibleAppError(page('<div class="errorBox">Unable to fetch prices</div>'))?.via).toBe('error-box');
  });

  it('a runtime exception printed on the page', () => {
    const r = visibleAppError(page("<p>TypeError: Cannot read properties of undefined (reading 'map')</p>"));
    expect(r?.via).toBe('runtime-text');
  });

  it('pdf.js\'s worker failure, wherever it is printed', () => {
    expect(visibleAppError(page('<div>Setting up fake worker failed: "Cannot load script at: https://cdn/pdf.worker.min.mjs"</div>'))).not.toBeNull();
  });

  it('a plain line that opens with "Failed to …", even split by inline tags', () => {
    expect(visibleAppError(page('<div class="card"><p>Failed to <b>load</b> your notes</p></div>'))?.text).toBe('Failed to load your notes');
  });

  it('an alert in Hindi', () => {
    expect(visibleAppError(page('<div role="alert">डेटा लोड करने में त्रुटि हुई</div>'))?.via).toBe('alert');
  });
});

describe('a designed page is never called broken', () => {
  const clean: Array<[string, string]> = [
    ['a designed empty state', '<div class="empty-state"><p>No results found</p><button>Add your first note</button></div>'],
    ['a code editor showing an exception as its content', '<pre class="editor">TypeError: x is not a function</pre>'],
    ['a code sample', '<code>Failed to load module</code>'],
    ['a textarea the user typed into', '<textarea>Something went wrong yesterday</textarea>'],
    ['an error boundary wrapping the whole app', '<div class="error-boundary"><h1>My Tasks</h1><ul><li>Failed to load is not a task</li></ul></div>'],
    ['a hidden error element', '<div class="form-error" hidden>Failed to save</div>'],
    ['an error element hidden by style', '<div class="error-message" style="display: none">Failed to save</div>'],
    ['an empty validation slot', '<span class="field-error"></span><input aria-label="Email">'],
    ['a danger button', '<button class="btn btn-danger">Delete account</button>'],
    ['an alert that reports success', '<div role="alert">Saved!</div>'],
    ['prose that mentions a failure mid-sentence', '<p>Learn why a page failed to load and how to fix it.</p>'],
    ['an error-log screen heading', '<section class="error-log"><h2>Error log</h2><p>Nothing recorded yet.</p></section>'],
    ['a whole article inside an error-named container', `<div class="errors-help">${'An error can happen for many reasons. '.repeat(20)}</div>`],
  ];
  for (const [name, body] of clean) {
    it(name, () => { expect(visibleAppError(page(body))).toBeNull(); });
  }

  it('empty and non-string input', () => {
    expect(visibleAppError('')).toBeNull();
    expect(visibleAppError(undefined as unknown as string)).toBeNull();
  });
});

describe('what the report and the user are given', () => {
  it('the report line is a warning on the APP, never auto-resolved', () => {
    const note = appShowsErrorNote({ text: 'Failed to load PDF file.', via: 'error-box' }, 'preview verify');
    expect(note.code).toBe(APP_SHOWS_ERROR_CODE);
    expect(note.severity).toBe('warning');
    expect(note.autoResolved).toBe(false);
    expect(note.message).toContain('Failed to load PDF file.');
  });

  it('the user has a one-tap offer for it', () => {
    const s = FINDING_SUGGESTIONS.find((f) => f.code === APP_SHOWS_ERROR_CODE);
    expect(s?.title).toBeTruthy();
    expect(s?.prompt).toMatch(/fix the cause/i);
  });

  it('BOTH render checks read it (source guard — a check that is never called catches nothing)', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/noteRenderStyle\(shot, 'render rescue'\); noteVisibleError\(shot, 'render rescue'\);/);
    expect(src).toMatch(/noteRenderStyle\(shot, 'preview verify'\); noteVisibleError\(shot, 'preview verify'\);/);
    expect(src).toMatch(/buildDiag\.resolveOnRecheck\(APP_SHOWS_ERROR_CODE\)/);
  });
});

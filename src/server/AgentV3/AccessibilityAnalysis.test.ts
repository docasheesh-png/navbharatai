import { describe, it, expect } from 'vitest';
import { scanAccessibility, accessibilitySummary } from './AccessibilityAnalysis';

describe('scanAccessibility', () => {
  it('flags an <img> with no alt as high', () => {
    const issues = scanAccessibility('src/Page.tsx', '<img src="/logo.png" />');
    expect(issues.some((x) => x.kind === 'img-missing-alt' && x.severity === 'high')).toBe(true);
  });

  it('does not flag an <img> that has alt (even empty alt is valid)', () => {
    expect(scanAccessibility('src/Page.tsx', '<img src="/logo.png" alt="Company logo" />')).toEqual([]);
    expect(scanAccessibility('src/Page.tsx', '<img src="/d.png" alt="" />')).toEqual([]);
  });

  it('flags <input type="image"> with no alt as high, but not one with alt', () => {
    expect(scanAccessibility('src/Form.tsx', '<input type="image" src="/go.png" />').some((x) => x.kind === 'input-image-missing-alt' && x.severity === 'high')).toBe(true);
    expect(scanAccessibility('src/Form.tsx', '<input type="image" src="/go.png" alt="Submit" />').some((x) => x.kind === 'input-image-missing-alt')).toBe(false);
    // a normal text input is not an image control.
    expect(scanAccessibility('src/Form.tsx', '<input type="text" aria-label="Name" />').some((x) => x.kind === 'input-image-missing-alt')).toBe(false);
  });

  it('flags <html> without lang as medium', () => {
    const issues = scanAccessibility('index.html', '<html>');
    expect(issues.some((x) => x.kind === 'html-missing-lang' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('index.html', '<html lang="en">')).toEqual([]);
  });

  it('flags a <meta http-equiv="refresh"> auto-refresh but not a normal meta', () => {
    expect(scanAccessibility('index.html', '<meta http-equiv="refresh" content="5; url=/next" />').some((x) => x.kind === 'meta-refresh')).toBe(true);
    expect(scanAccessibility('index.html', '<meta name="description" content="x" />').some((x) => x.kind === 'meta-refresh')).toBe(false);
  });

  it('flags a viewport meta that disables zoom (WCAG 1.4.4) but not a normal viewport', () => {
    expect(scanAccessibility('index.html', '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />').some((x) => x.kind === 'zoom-disabled')).toBe(true);
    expect(scanAccessibility('index.html', '<meta name="viewport" content="width=device-width, maximum-scale=1.0" />').some((x) => x.kind === 'zoom-disabled')).toBe(true);
    // a normal, zoomable viewport is fine.
    expect(scanAccessibility('index.html', '<meta name="viewport" content="width=device-width, initial-scale=1" />').some((x) => x.kind === 'zoom-disabled')).toBe(false);
  });

  it('flags autoplaying audio / unmuted autoplay video (WCAG 1.4.2), but not muted video autoplay', () => {
    expect(scanAccessibility('src/P.tsx', '<audio src="/s.mp3" autoplay />').some((x) => x.kind === 'media-autoplay')).toBe(true);
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" autoplay />').some((x) => x.kind === 'media-autoplay')).toBe(true);
    // Muted video autoplay (common background loop) is fine.
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" autoplay muted loop />').some((x) => x.kind === 'media-autoplay')).toBe(false);
    // No autoplay → not flagged.
    expect(scanAccessibility('src/P.tsx', '<video src="/v.mp4" controls />').some((x) => x.kind === 'media-autoplay')).toBe(false);
  });

  it('flags an icon-only <a href> link with no accessible name, but not a text/aria-label link', () => {
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home"><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(true);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home">Home</a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home" aria-label="Home"><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
    // No href → handled by anchor-missing-href, not this rule.
    expect(scanAccessibility('src/Nav.tsx', '<a><svg /></a>').some((x) => x.kind === 'link-no-accessible-name')).toBe(false);
  });

  it('flags aria-hidden="true" on an interactive element (focusable but hidden from AT)', () => {
    expect(scanAccessibility('src/B.tsx', '<button aria-hidden="true" onClick={go}>X</button>').some((x) => x.kind === 'aria-hidden-interactive')).toBe(true);
    expect(scanAccessibility('src/B.tsx', '<a href="/x" aria-hidden="true">link</a>').some((x) => x.kind === 'aria-hidden-interactive')).toBe(true);
    expect(scanAccessibility('src/B.tsx', '<input type="text" aria-hidden="true" aria-label="x" />').some((x) => x.kind === 'aria-hidden-interactive')).toBe(true);
    // aria-hidden on a non-interactive decorative element (e.g. an icon) is fine.
    expect(scanAccessibility('src/B.tsx', '<span aria-hidden="true">★</span>').some((x) => x.kind === 'aria-hidden-interactive')).toBe(false);
    // a button without aria-hidden is fine.
    expect(scanAccessibility('src/B.tsx', '<button onClick={go}>Save</button>').some((x) => x.kind === 'aria-hidden-interactive')).toBe(false);
  });

  it('flags role="none"/"presentation" on an interactive element (semantics stripped)', () => {
    expect(scanAccessibility('src/B.tsx', '<button role="presentation" onClick={go}>X</button>').some((x) => x.kind === 'role-presentation-interactive')).toBe(true);
    expect(scanAccessibility('src/B.tsx', '<a href="/x" role="none">link</a>').some((x) => x.kind === 'role-presentation-interactive')).toBe(true);
    // role="presentation" on a decorative img/table is a legitimate use — not interactive.
    expect(scanAccessibility('src/B.tsx', '<img src="/d.png" alt="" role="presentation" />').some((x) => x.kind === 'role-presentation-interactive')).toBe(false);
    // a button with a real role is fine.
    expect(scanAccessibility('src/B.tsx', '<button onClick={go}>Save</button>').some((x) => x.kind === 'role-presentation-interactive')).toBe(false);
  });

  it('flags <iframe> without a title (medium) but not one with title or aria-label', () => {
    const issues = scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" />');
    expect(issues.some((x) => x.kind === 'iframe-missing-title' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" title="Demo video" />')).toEqual([]);
    expect(scanAccessibility('src/Embed.tsx', '<iframe src="https://x.com/v" aria-label="Demo" />')).toEqual([]);
  });

  it('flags a duplicate static id within a file but not unique or dynamic ids', () => {
    const dup = scanAccessibility('src/Form.tsx', '<input id="email" />\n<label htmlFor="email">E</label>\n<input id="email" />');
    const hit = dup.find((x) => x.kind === 'duplicate-id');
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('medium');
    // unique ids are fine.
    expect(scanAccessibility('src/Form.tsx', '<input id="a" />\n<input id="b" />').some((x) => x.kind === 'duplicate-id')).toBe(false);
    // dynamic ids (id={...}) are expected to vary — not counted.
    expect(scanAccessibility('src/List.tsx', '<li id={`row-${i}`} />\n<li id={`row-${i}`} />').some((x) => x.kind === 'duplicate-id')).toBe(false);
  });

  it('flags a form control with no accessible name (medium) but not one with aria-label or id', () => {
    const bad = scanAccessibility('src/Form.tsx', '<input type="text" />');
    expect(bad.some((x) => x.kind === 'control-unlabeled' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/Form.tsx', '<input type="text" aria-label="Name" />')).toEqual([]);
    // an id may be the target of a <label for> elsewhere — conservative, not flagged.
    expect(scanAccessibility('src/Form.tsx', '<input id="name" type="text" />')).toEqual([]);
    // types that need no label are not flagged.
    expect(scanAccessibility('src/Form.tsx', '<input type="submit" />')).toEqual([]);
  });

  it('flags onClick on a non-interactive element with no role as low', () => {
    const issues = scanAccessibility('src/Btn.tsx', '<div onClick={go}>Go</div>');
    expect(issues.some((x) => x.kind === 'click-on-noninteractive' && x.severity === 'low')).toBe(true);
    // a role makes it acceptable.
    expect(scanAccessibility('src/Btn.tsx', '<div role="button" onClick={go}>Go</div>')).toEqual([]);
    // a real <button> is interactive — not flagged.
    expect(scanAccessibility('src/Btn.tsx', '<button onClick={go}>Go</button>')).toEqual([]);
  });

  it('flags a positive tabindex as low', () => {
    expect(scanAccessibility('src/A.tsx', '<div tabIndex={3}>x</div>').some((x) => x.kind === 'positive-tabindex')).toBe(true);
    expect(scanAccessibility('src/A.tsx', '<div tabindex="2">x</div>').some((x) => x.kind === 'positive-tabindex')).toBe(true);
    // tabIndex 0 or -1 is fine.
    expect(scanAccessibility('src/A.tsx', '<div tabIndex={0}>x</div>')).toEqual([]);
  });

  it('flags an empty icon button with no accessible name as low', () => {
    const issues = scanAccessibility('src/Icon.tsx', '<button><svg /></button>');
    expect(issues.some((x) => x.kind === 'button-no-accessible-name' && x.severity === 'low')).toBe(true);
    // aria-label resolves it.
    expect(scanAccessibility('src/Icon.tsx', '<button aria-label="Close"><svg /></button>')).toEqual([]);
  });

  it('flags an anchor with no href as low', () => {
    expect(scanAccessibility('src/Nav.tsx', '<a onClick={go}>Home</a>').some((x) => x.kind === 'anchor-missing-href')).toBe(true);
    expect(scanAccessibility('src/Nav.tsx', '<a href="/home">Home</a>')).toEqual([]);
  });

  it('flags autofocus on a form control as low (HTML and JSX casing)', () => {
    expect(scanAccessibility('src/F.tsx', '<input autoFocus />').some((x) => x.kind === 'autofocus' && x.severity === 'low')).toBe(true);
    expect(scanAccessibility('src/F.html', '<input type="text" autofocus>').some((x) => x.kind === 'autofocus')).toBe(true);
    // no autofocus → not flagged.
    expect(scanAccessibility('src/F.tsx', '<input type="text" id="name" />').some((x) => x.kind === 'autofocus')).toBe(false);
  });

  it('flags an empty <th> header but not one with text or an aria-label', () => {
    expect(scanAccessibility('src/T.tsx', '<th></th>').some((x) => x.kind === 'empty-table-header' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/T.tsx', '<th><svg /></th>').some((x) => x.kind === 'empty-table-header')).toBe(true);
    expect(scanAccessibility('src/T.tsx', '<th>Name</th>').some((x) => x.kind === 'empty-table-header')).toBe(false);
    expect(scanAccessibility('src/T.tsx', '<th aria-label="Name"><svg /></th>').some((x) => x.kind === 'empty-table-header')).toBe(false);
  });

  it('flags a truly-empty <label for> but not a wrapping or text label', () => {
    expect(scanAccessibility('src/F.tsx', '<label for="email"></label>').some((x) => x.kind === 'empty-label' && x.severity === 'medium')).toBe(true);
    // a label with text is fine.
    expect(scanAccessibility('src/F.tsx', '<label for="email">Email</label>').some((x) => x.kind === 'empty-label')).toBe(false);
    // a wrapping label (has child content) is not flagged.
    expect(scanAccessibility('src/F.tsx', '<label for="email"><input id="email" /></label>').some((x) => x.kind === 'empty-label')).toBe(false);
  });

  it('flags a scope attribute on a <td> but not on a <th>', () => {
    expect(scanAccessibility('src/T.tsx', '<td scope="col">Name</td>').some((x) => x.kind === 'scope-on-td' && x.severity === 'medium')).toBe(true);
    // scope IS valid on a th.
    expect(scanAccessibility('src/T.tsx', '<th scope="col">Name</th>').some((x) => x.kind === 'scope-on-td')).toBe(false);
    // a plain td is fine.
    expect(scanAccessibility('src/T.tsx', '<td>Alice</td>').some((x) => x.kind === 'scope-on-td')).toBe(false);
  });

  it('flags deprecated <marquee>/<blink> elements', () => {
    expect(scanAccessibility('src/M.tsx', '<marquee>Sale!</marquee>').some((x) => x.kind === 'deprecated-marquee-blink' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/M.tsx', '<blink>New</blink>').some((x) => x.kind === 'deprecated-marquee-blink')).toBe(true);
    // a normal element is fine.
    expect(scanAccessibility('src/M.tsx', '<div>Sale!</div>').some((x) => x.kind === 'deprecated-marquee-blink')).toBe(false);
  });

  it('flags an <area href> with no alt as high but not one with alt', () => {
    expect(scanAccessibility('src/Map.tsx', '<area href="/x" coords="0,0,10,10" shape="rect" />').some((x) => x.kind === 'area-missing-alt' && x.severity === 'high')).toBe(true);
    expect(scanAccessibility('src/Map.tsx', '<area href="/x" alt="Region X" coords="0,0,10,10" />').some((x) => x.kind === 'area-missing-alt')).toBe(false);
  });

  it('flags an <input type="button"> with no accessible name but not one with a value', () => {
    expect(scanAccessibility('src/F.tsx', '<input type="button" />').some((x) => x.kind === 'input-button-no-name' && x.severity === 'medium')).toBe(true);
    // a value provides the name; submit/reset have a default label.
    expect(scanAccessibility('src/F.tsx', '<input type="button" value="Go" />').some((x) => x.kind === 'input-button-no-name')).toBe(false);
    expect(scanAccessibility('src/F.tsx', '<input type="submit" />').some((x) => x.kind === 'input-button-no-name')).toBe(false);
    expect(scanAccessibility('src/F.tsx', '<input type="button" aria-label="Go" />').some((x) => x.kind === 'input-button-no-name')).toBe(false);
  });

  it('flags an abstract ARIA role as medium but not a concrete role', () => {
    expect(scanAccessibility('src/A.tsx', '<div role="widget">x</div>').some((x) => x.kind === 'abstract-aria-role' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/A.tsx', '<div role="input">x</div>').some((x) => x.kind === 'abstract-aria-role')).toBe(true);
    // a concrete, usable role is fine.
    expect(scanAccessibility('src/A.tsx', '<div role="button" tabIndex={0}>x</div>').some((x) => x.kind === 'abstract-aria-role')).toBe(false);
  });

  it('flags a redundant role that duplicates the native role but not a non-redundant one', () => {
    expect(scanAccessibility('src/A.tsx', '<button role="button">Go</button>').some((x) => x.kind === 'redundant-role' && x.severity === 'low')).toBe(true);
    expect(scanAccessibility('src/A.tsx', '<nav role="navigation">…</nav>').some((x) => x.kind === 'redundant-role')).toBe(true);
    expect(scanAccessibility('src/A.tsx', '<a href="/x" role="link">Home</a>').some((x) => x.kind === 'redundant-role')).toBe(true);
    // a role that changes/adds semantics is not redundant.
    expect(scanAccessibility('src/A.tsx', '<div role="button" tabIndex={0}>x</div>').some((x) => x.kind === 'redundant-role')).toBe(false);
    // an anchor WITHOUT href has no implicit link role, so role="link" is not redundant.
    expect(scanAccessibility('src/A.tsx', '<a role="link" onClick={go}>x</a>').some((x) => x.kind === 'redundant-role')).toBe(false);
    // FP fix: <ul role="list"> / <ol role="list"> is the legitimate Safari/VoiceOver fix for
    // list-style:none, NOT redundant — flagging it would give harmful advice.
    expect(scanAccessibility('src/A.tsx', '<ul role="list" className="reset">…</ul>').some((x) => x.kind === 'redundant-role')).toBe(false);
    expect(scanAccessibility('src/A.tsx', '<ol role="list">…</ol>').some((x) => x.kind === 'redundant-role')).toBe(false);
  });

  it('flags an empty heading as medium but not a heading with text or an aria-label', () => {
    expect(scanAccessibility('src/P.tsx', '<h1></h1>').some((x) => x.kind === 'empty-heading' && x.severity === 'medium')).toBe(true);
    expect(scanAccessibility('src/P.tsx', '<h2><svg /></h2>').some((x) => x.kind === 'empty-heading')).toBe(true);
    // real text content → not flagged.
    expect(scanAccessibility('src/P.tsx', '<h1>Welcome</h1>').some((x) => x.kind === 'empty-heading')).toBe(false);
    // an aria-label provides the accessible name.
    expect(scanAccessibility('src/P.tsx', '<h2 aria-label="Section"><svg /></h2>').some((x) => x.kind === 'empty-heading')).toBe(false);
  });

  it('returns [] for non-frontend files and test/vendored paths', () => {
    expect(scanAccessibility('src/util.ts', '<img src="x" />')).toEqual([]);
    expect(scanAccessibility('src/Page.test.tsx', '<img src="x" />')).toEqual([]);
    expect(scanAccessibility('node_modules/pkg/Page.tsx', '<img src="x" />')).toEqual([]);
  });

  it('does not flag clean, accessible markup (no false positives)', () => {
    const clean = scanAccessibility(
      'src/Page.tsx',
      '<main>\n  <img src="/a.png" alt="A" />\n  <label htmlFor="q">Search</label>\n  <input id="q" type="text" />\n  <button onClick={go}>Search</button>\n</main>',
    );
    expect(clean).toEqual([]);
  });
});

describe('accessibilitySummary', () => {
  it('reports a clean line when there are no issues', () => {
    expect(accessibilitySummary([])).toContain('No accessibility issues detected');
  });

  it('summarises by severity with file:line lines when non-empty', () => {
    const sum = accessibilitySummary([
      { file: 'a.tsx', line: 1, kind: 'img-missing-alt', severity: 'high', snippet: '<img src="x" />' },
      { file: 'b.tsx', line: 2, kind: 'positive-tabindex', severity: 'low', snippet: '<div tabIndex={3} />' },
    ]);
    expect(sum).toContain('1 high');
    expect(sum).toContain('1 low');
    expect(sum).toContain('a.tsx:1');
    expect(sum).toContain('img-missing-alt');
  });

  it('truncates to 15 lines with a "more" tail', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      file: `f${i}.tsx`,
      line: i + 1,
      kind: 'img-missing-alt' as const,
      severity: 'high' as const,
      snippet: '<img />',
    }));
    expect(accessibilitySummary(many)).toContain('…and 5 more.');
  });
});

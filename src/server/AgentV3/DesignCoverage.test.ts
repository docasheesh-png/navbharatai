import { describe, it, expect } from 'vitest';
import {
  analyzeDesignCoverage, analyzePage, analyzeHtmlPage, isPageFile, countHtmlElements, hasStylingSignal,
  designRepairInstruction, designCoverageSummary, type DesignDefect,
} from './DesignCoverage';

/**
 * THE DEFECT THIS EXISTS FOR (admin report, 2026-08-11): the first page of a generated app is
 * beautiful and the inner pages "bas HTML feel dete hai".
 *
 * Two failure directions matter equally here, and the second is the one that kills a check like this:
 *   1. It must FIRE on the wall of bare divs. That is the whole point.
 *   2. It must STAY SILENT on every legitimately-styled page. A check that nags a good app gets
 *      ignored, and an ignored check is worse than no check — so the false-positive tests below
 *      outnumber the true-positive ones on purpose.
 */

/** The reported defect: a real page, real content, and not a single class. */
const BARE_PAGE = `
export default function SettingsPage() {
  return (
    <div>
      <div>
        <span>Settings</span>
      </div>
      <div>
        <p>Manage your account</p>
        <button onClick={save}>Save</button>
      </div>
      <div>
        <p>Notifications</p>
        <button onClick={toggle}>Toggle</button>
      </div>
    </div>
  );
}`;

/** The same page, built the way the first screen was. */
const DESIGNED_PAGE = `
export default function SettingsPage() {
  return (
    <div className="container stack">
      <h1>Settings</h1>
      <div className="card stack">
        <p className="muted">Manage your account</p>
        <button className="btn-primary" onClick={save}>Save</button>
      </div>
      <div className="card stack">
        <p>Notifications</p>
        <button className="btn-ghost" onClick={toggle}>Toggle</button>
      </div>
    </div>
  );
}`;

describe('it fires on the page the admin actually saw', () => {
  it('flags a page of naked divs', () => {
    const f = analyzePage('src/pages/Settings.tsx', BARE_PAGE);
    expect(f).toBeTruthy();
    expect(f!.defects).toContain('BARE_MARKUP');
  });

  it('and flags that it has no title either', () => {
    expect(analyzePage('src/pages/Settings.tsx', BARE_PAGE)!.defects).toContain('NO_HEADING');
  });

  it('says nothing about the same page once it is designed', () => {
    expect(analyzePage('src/pages/Settings.tsx', DESIGNED_PAGE)).toBeNull();
  });

  it('judges page 5 exactly as strictly as page 1 — that is the whole fix', () => {
    // The real shape of the bug: one good page and several bare ones. Reporting "the app has a
    // stylesheet" (which every existing check does) hides exactly this.
    const report = analyzeDesignCoverage({
      'src/pages/Home.tsx': DESIGNED_PAGE,
      'src/pages/Settings.tsx': BARE_PAGE,
      'src/pages/Billing.tsx': BARE_PAGE,
      'src/pages/Team.tsx': BARE_PAGE,
    });
    expect(report.pagesExamined).toBe(4);
    expect(report.findings.map((f) => f.file)).toEqual([
      'src/pages/Billing.tsx', 'src/pages/Settings.tsx', 'src/pages/Team.tsx',
    ]);
    expect(report.ok).toBe(false);
  });
});

describe('FALSE POSITIVES — the failure that would make this check worthless', () => {
  it('a Tailwind page is styled, even with no kit classes', () => {
    const tailwind = `
      export default function DashboardPage() {
        return (
          <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <div className="rounded-lg border p-4 shadow-sm"><p className="text-sm">Hello</p></div>
            <div className="rounded-lg border p-4"><span className="text-gray-500">More</span></div>
            <button className="bg-blue-600 text-white px-4 py-2 rounded">Go</button>
          </div>
        );
      }`;
    expect(analyzePage('src/pages/Dashboard.tsx', tailwind)).toBeNull();
  });

  it('styled-components is not judged at all — it produces no class names by design', () => {
    const sc = `
      import styled from 'styled-components';
      const Wrap = styled.div\`padding: 24px;\`;
      export default function ProfilePage() {
        return (<Wrap><div><span>a</span><span>b</span><p>c</p><p>d</p><section>e</section></div></Wrap>);
      }`;
    expect(analyzePage('src/pages/Profile.tsx', sc)).toBeNull();
  });

  it('CSS modules are not judged either', () => {
    const mod = `
      import styles from './Profile.module.css';
      export default function ProfilePage() {
        return (<div className={styles.wrap}><div><span>a</span><p>b</p><p>c</p><section>d</section><footer>e</footer></div></div>);
      }`;
    expect(analyzePage('src/pages/Profile.tsx', mod)).toBeNull();
  });

  it('a component library page is not judged', () => {
    for (const lib of ['@mui/material', '@chakra-ui/react', 'antd', '@mantine/core']) {
      const src = `import { Button } from '${lib}';\nexport default function P(){return (<div><div><p>a</p><p>b</p><p>c</p><span>d</span><section>e</section></div></div>);}`;
      expect(analyzePage('src/pages/P.tsx', src), lib).toBeNull();
    }
  });

  it('inline style objects count as styled', () => {
    const inline = `export default function P(){return (<div style={{padding:24}}><h1>T</h1><div><p>a</p><p>b</p><span>c</span><section>d</section></div></div>);}`;
    expect(analyzePage('src/pages/P.tsx', inline)).toBeNull();
  });

  it('a LEAF COMPONENT is never judged — only whole screens', () => {
    // A bare <li> renderer is not a design failure; judging it would flood a good app with noise.
    expect(analyzePage('src/components/Row.tsx', BARE_PAGE)).toBeNull();
    expect(analyzePage('src/lib/helpers.ts', BARE_PAGE)).toBeNull();
  });

  it('a tiny page is not judged — too little markup to conclude anything', () => {
    const redirect = `export default function P(){ return (<div><span>Redirecting…</span></div>); }`;
    expect(analyzePage('src/pages/P.tsx', redirect)).toBeNull();
  });

  it('a test file is never a page', () => {
    expect(isPageFile('src/pages/Home.test.tsx')).toBe(false);
    expect(isPageFile('src/pages/Home.spec.jsx')).toBe(false);
  });

  it('a mostly-unclassed page that still uses the kit is left alone', () => {
    // Designed, but with plain text inside the cards — a very common and perfectly good shape.
    const mixed = `
      export default function P() {
        return (
          <div className="container">
            <h1>Reports</h1>
            <div className="card"><p>one</p><p>two</p><p>three</p><span>four</span><span>five</span></div>
          </div>
        );
      }`;
    const f = analyzePage('src/pages/Reports.tsx', mixed);
    expect(f?.defects ?? []).not.toContain('BARE_MARKUP');
  });
});

describe('which files count as pages', () => {
  it('by directory', () => {
    for (const p of ['src/pages/A.tsx', 'src/screens/B.jsx', 'app/routes/C.tsx', 'src/views/D.tsx']) {
      expect(isPageFile(p), p).toBe(true);
    }
  });

  it('by name, so a flat project still gets checked', () => {
    for (const p of ['src/SettingsPage.tsx', 'src/HomeScreen.tsx', 'src/ReportView.jsx']) {
      expect(isPageFile(p), p).toBe(true);
    }
  });

  it('and nothing else', () => {
    for (const p of ['src/App.tsx', 'src/components/Card.tsx', 'src/index.css', 'src/util.ts']) {
      expect(isPageFile(p), p).toBe(false);
    }
  });
});

describe('the other three defects', () => {
  it('RAW TABLE — an unwrapped table scrolls the whole PAGE sideways on a phone', () => {
    const raw = `export default function P(){return (<div className="container"><h1>T</h1><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>);}`;
    expect(analyzePage('src/pages/P.tsx', raw)!.defects).toContain('RAW_TABLE');
  });

  it('and is satisfied by the kit wrapper', () => {
    const wrapped = `export default function P(){return (<div className="container"><h1>T</h1><div className="nb-table-wrap"><table className="nb-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div></div>);}`;
    expect(analyzePage('src/pages/P.tsx', wrapped)).toBeNull();
  });

  it('LIST WITHOUT EMPTY STATE — a first-time user sees the app on its emptiest day', () => {
    const list = `export default function P(){return (<div className="container"><h1>Items</h1><div className="card"><ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul></div><p>end</p><span>x</span></div>);}`;
    expect(analyzePage('src/pages/P.tsx', list)!.defects).toContain('LIST_WITHOUT_EMPTY_STATE');
  });

  it('every reasonable way of writing an empty state satisfies it', () => {
    const forms = [
      'items.length === 0 ? <p>None yet</p> : ',
      '!items.length ? <p>None yet</p> : ',
      '<div className="nb-empty">Nothing yet</div>',
      'items.length ? <List/> : <Empty/>',
    ];
    for (const guard of forms) {
      const src = `export default function P(){return (<div className="container"><h1>Items</h1><div className="card">{${guard}}{items.map(i => <li key={i}>{i}</li>)}</div><p>a</p><span>b</span><section>c</section></div>);}`;
      expect(analyzePage('src/pages/P.tsx', src)?.defects ?? [], guard).not.toContain('LIST_WITHOUT_EMPTY_STATE');
    }
  });

  it('NO_HEADING is satisfied by a hero or an auth screen, which carry their own title', () => {
    const hero = `export default function P(){return (<div className="nb-hero"><p className="nb-hero-sub">a</p><div className="card"><p>b</p><p>c</p><span>d</span><section>e</section></div></div>);}`;
    expect(analyzePage('src/pages/P.tsx', hero)?.defects ?? []).not.toContain('NO_HEADING');
  });
});

describe('the mechanics', () => {
  it('counts elements and classed elements, ignoring void/utility tags', () => {
    const c = countHtmlElements('<div className="a"><br/><input /><span>x</span><p className="b">y</p></div>');
    expect(c.total).toBe(3); // div, span, p — not br/input
    expect(c.classed).toBe(2);
  });

  it('does not count React components as HTML elements', () => {
    expect(countHtmlElements('<Card><Row><div>x</div></Row></Card>').total).toBe(1);
  });

  it('recognises every styling signal it claims to', () => {
    expect(hasStylingSignal('<div className="card">')).toBe(true);
    expect(hasStylingSignal('<div className="flex gap-4">')).toBe(true);
    expect(hasStylingSignal('<div style={{ padding: 8 }}>')).toBe(true);
    expect(hasStylingSignal('<div className={styles.wrap}>')).toBe(true);
    expect(hasStylingSignal('<div className={clsx("x")}>')).toBe(true);
    expect(hasStylingSignal('<div>')).toBe(false);
    expect(hasStylingSignal('<div className="wrapper-thing">')).toBe(false); // invented, meaningless
  });

  it('never throws on junk input', () => {
    for (const junk of [{}, { 'a.tsx': null as unknown as string }, { 'src/pages/x.tsx': '' }]) {
      expect(() => analyzeDesignCoverage(junk as Record<string, string>)).not.toThrow();
    }
  });

  it('is deterministic — the same project reports the same order twice', () => {
    const files = { 'src/pages/B.tsx': BARE_PAGE, 'src/pages/A.tsx': BARE_PAGE };
    expect(JSON.stringify(analyzeDesignCoverage(files))).toBe(JSON.stringify(analyzeDesignCoverage(files)));
  });
});

describe('the repair instruction — a generic prompt produces a generic restyle', () => {
  const report = analyzeDesignCoverage({ 'src/pages/Home.tsx': DESIGNED_PAGE, 'src/pages/Settings.tsx': BARE_PAGE });

  it('names the offending page and NOT the good one', () => {
    const text = designRepairInstruction(report);
    expect(text).toContain('src/pages/Settings.tsx');
    expect(text).not.toContain('src/pages/Home.tsx');
    expect(text).toContain('do not restyle pages not listed');
  });

  it('points at the design system the project ALREADY has', () => {
    // Otherwise the repair invents a second design language, which is worse than the plain page.
    const text = designRepairInstruction(report);
    expect(text).toContain('.card');
    expect(text).toContain('.nb-empty');
    expect(text).toContain('Do NOT');
    expect(text).toContain('invent a second design language');
  });

  it('is empty when there is nothing to fix, so no pass is ever triggered for nothing', () => {
    expect(designRepairInstruction(analyzeDesignCoverage({ 'src/pages/Home.tsx': DESIGNED_PAGE }))).toBe('');
  });

  it('the summary is honest in all three states', () => {
    expect(designCoverageSummary(analyzeDesignCoverage({}))).toContain('No page-level components');
    expect(designCoverageSummary(analyzeDesignCoverage({ 'src/pages/Home.tsx': DESIGNED_PAGE }))).toContain('use the app');
    expect(designCoverageSummary(report)).toContain('1 of 2');
  });
});

/**
 * PLAIN HTML PAGES — the other half of the report, and the sharpest version of it.
 *
 * A multi-page static site is generated one file at a time, and the classic bug is that index.html
 * links the stylesheet while about.html simply does not. That page renders as Times New Roman on
 * white: the most literal possible "bas HTML feel dete hai". Each file is valid HTML on its own, so
 * nothing in the stack notices.
 */
describe('static HTML pages', () => {
  const STYLED = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>
    <body><header><h1>Shop</h1></header><main><section><p>a</p><p>b</p></section><footer><span>c</span></footer></main></body></html>`;

  const FORGOT_THE_LINK = `<!doctype html><html><head><title>About</title></head>
    <body><header><h1>About</h1></header><main><section><p>a</p><p>b</p></section><footer><span>c</span></footer></main></body></html>`;

  it('flags the inner page that forgot the stylesheet', () => {
    expect(analyzeHtmlPage('about.html', FORGOT_THE_LINK)!.defects).toContain('NO_STYLESHEET');
  });

  it('says nothing about the page that has it', () => {
    expect(analyzeHtmlPage('index.html', STYLED)).toBeNull();
  });

  it('catches the real shape: one good page, two raw ones', () => {
    const report = analyzeDesignCoverage({
      'index.html': STYLED,
      'about.html': FORGOT_THE_LINK,
      'contact.html': FORGOT_THE_LINK,
    });
    expect(report.pagesExamined).toBe(3);
    expect(report.findings.map((f) => f.file).sort()).toEqual(['about.html', 'contact.html']);
  });

  it('does NOT use class coverage for HTML — element selectors are legitimate styling', () => {
    // A simple static page styled entirely through `body {}` / `h1 {}` has almost no classes and is
    // perfectly well designed. Judging it on classes would be a false positive.
    const noClasses = `<!doctype html><html><head><link rel=stylesheet href=s.css></head>
      <body><header><h1>T</h1></header><main><p>a</p><p>b</p><section>c</section><footer>d</footer></main></body></html>`;
    expect(analyzeHtmlPage('page.html', noClasses)).toBeNull();
  });

  it('a <style> block, inline styles or a CDN framework all count as styled', () => {
    const variants = [
      '<style>body{color:red}</style>',
      '',
      '<script src="https://cdn.jsdelivr.net/npm/tailwindcss"></script>',
    ];
    const inlineBody = '<body><div style="padding:8px"><h1>T</h1><p>a</p><p>b</p><span>c</span><section>d</section></div></body>';
    for (const head of variants) {
      const html = head
        ? `<!doctype html><html><head>${head}</head><body><h1>T</h1><p>a</p><p>b</p><span>c</span><section>d</section><footer>e</footer></body></html>`
        : `<!doctype html><html><head></head>${inlineBody}</html>`;
      expect(analyzeHtmlPage('p.html', html), head || 'inline').toBeNull();
    }
  });

  it('a tiny fragment is not judged', () => {
    expect(analyzeHtmlPage('partial.html', '<div><span>x</span></div>')).toBeNull();
  });

  it('the repair instruction explains the forgotten <link>, not a vague restyle', () => {
    const report = analyzeDesignCoverage({ 'index.html': STYLED, 'about.html': FORGOT_THE_LINK });
    const text = designRepairInstruction(report);
    expect(text).toContain('about.html');
    expect(text).not.toContain('index.html');
    expect(text).toContain('forgotten <link>');
  });

  it('every defect has repair text — an unmapped one would print "undefined" to the model', () => {
    const defects: DesignDefect[] = ['BARE_MARKUP', 'NO_HEADING', 'RAW_TABLE', 'LIST_WITHOUT_EMPTY_STATE', 'NO_STYLESHEET'];
    for (const d of defects) {
      const text = designRepairInstruction({
        pagesExamined: 1, ok: false,
        findings: [{ file: 'x.tsx', defects: [d], classedRatio: 0, elements: 10 }],
      });
      expect(text, d).not.toContain('undefined');
      expect(text.length, d).toBeGreaterThan(200);
    }
  });
});

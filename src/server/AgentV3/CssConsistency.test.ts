import { describe, it, expect } from 'vitest';
import { findUndefinedClasses, cssConsistencyError, collectUsedClasses, collectDefinedClasses } from './CssConsistency';

describe('CssConsistency', () => {
  it('flags the DigitalWatch bug: component classes not defined in the stylesheet', () => {
    const files = {
      'src/DigitalWatch.tsx': `export default () => (<div className="watch-container"><div className="watch-screen"><span className="time-display"/><span className="date-display"/></div></div>);`,
      'src/watch.css': `.watch-wrapper { display: flex; } .watch-display { color: red; }`,
    };
    const missing = findUndefinedClasses(files);
    expect(missing).toEqual(['date-display', 'time-display', 'watch-container', 'watch-screen']);
    const err = cssConsistencyError(files);
    expect(err).toContain('CSS class mismatch');
    expect(err).toContain('.watch-container');
  });

  it('is silent when the stylesheet DEFINES the classes the component uses', () => {
    const files = {
      'src/Watch.tsx': `export default () => <div className="watch-container"><span className="time-display"/></div>;`,
      'src/watch.css': `.watch-container { display: grid; } .time-display { font-size: 2rem; }`,
    };
    expect(findUndefinedClasses(files)).toEqual([]);
    expect(cssConsistencyError(files)).toBeNull();
  });

  it('is silent for a Tailwind app (utility classes are not in .css files)', () => {
    const files = {
      'tailwind.config.js': `module.exports = {};`,
      'src/App.tsx': `export default () => <div className="flex-container items-center text-lg">x</div>;`,
      'src/index.css': `@tailwind base; @tailwind utilities;`,
    };
    expect(findUndefinedClasses(files)).toEqual([]);
    expect(cssConsistencyError(files)).toBeNull();
  });

  it('does not flag when there is no CSS file to check against (e.g. CSS-in-JS)', () => {
    const files = { 'src/App.tsx': `export default () => <div className="my-card other-thing third-one">x</div>;` };
    expect(cssConsistencyError(files)).toBeNull();
  });

  it('ignores STATE words a script toggles (active, hidden, open …) — they need no rule of their own', () => {
    const files = {
      'src/App.tsx': `export default () => <div className="active hidden open selected">x</div>;`,
      'src/app.css': `.something { color: blue; }`,
    };
    expect(findUndefinedClasses(files)).toEqual([]);
  });

  // 🔴 Changed deliberately 2026-09-30 (autopsy "Nemi Mart"): this test used to assert that single-word
  // classes are NEVER counted. That is what let a grocery page whose classes were all single words
  // ("header", "price", "mrp") lose every rule while this check stayed silent. They count now; state
  // words and one- and two-letter tokens still do not.
  it('counts a single-word custom class ("header", "price", "mrp") that no stylesheet defines', () => {
    const files = {
      'src/App.tsx': `export default () => <div className="header"><b className="price"/><s className="mrp"/><i className="ok x"/></div>;`,
      'src/app.css': `.something { color: blue; }`,
    };
    expect(findUndefinedClasses(files)).toEqual(['header', 'mrp', 'price']);
  });

  it('stays below the threshold for a lone mismatch (avoids noisy one-offs)', () => {
    const files = {
      'src/App.tsx': `export default () => <div className="lonely-class defined-one">x</div>;`,
      'src/app.css': `.defined-one { color: green; }`,
    };
    expect(findUndefinedClasses(files)).toEqual(['lonely-class']); // 1 < threshold (3)
    expect(cssConsistencyError(files)).toBeNull();
  });

  it('collectUsedClasses / collectDefinedClasses parse the basics', () => {
    expect([...collectUsedClasses({ 'a.tsx': `<i className="a b"/><i className={'c'}/>` })].sort()).toEqual(['a', 'b', 'c']);
    const { defined, cssFiles } = collectDefinedClasses({ 'a.css': `.x{} .y .z{}` });
    expect(cssFiles).toBe(1);
    expect([...defined].sort()).toEqual(['x', 'y', 'z']);
  });
});

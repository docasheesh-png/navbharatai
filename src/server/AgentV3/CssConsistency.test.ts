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

  it('ignores single-word / utility-style tokens (only kebab-case custom classes count)', () => {
    const files = {
      'src/App.tsx': `export default () => <div className="container active hidden">x</div>;`,
      'src/app.css': `.something { color: blue; }`,
    };
    // "container", "active", "hidden" are single words → not treated as custom/generator-defined
    expect(findUndefinedClasses(files)).toEqual([]);
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

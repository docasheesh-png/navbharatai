import { describe, it, expect } from 'vitest';
import { analyzeJsxComponents } from './JsxComponentAnalysis';

const app = (body: string) => ({ 'src/App.tsx': body });

describe('analyzeJsxComponents — clean (no false positives)', () => {
  it('accepts imported components and host elements', async () => {
    const r = await analyzeJsxComponents(app(`
      import { Button } from './Button';
      import Header from './Header';
      export function App() {
        return <div><Header /><Button>ok</Button><span>x</span></div>;
      }
    `));
    expect(r.ok).toBe(true);
    expect(r.undefinedComponents).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  it('accepts a component declared locally in the same file', async () => {
    const r = await analyzeJsxComponents(app(`
      function Card() { return <div />; }
      export function App() { return <Card />; }
    `));
    expect(r.ok).toBe(true);
  });

  it('accepts a component passed as a prop/param', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App({ Icon }) { return <Icon />; }
    `));
    expect(r.ok).toBe(true);
  });

  it('accepts React.Fragment, <>, and Fragment globals', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App() { return <React.Fragment><><span>hi</span></></React.Fragment>; }
    `));
    expect(r.ok).toBe(true);
  });

  it('accepts a member-expression component whose root is imported (motion.div)', async () => {
    const r = await analyzeJsxComponents(app(`
      import { motion } from 'framer-motion';
      export function App() { return <motion.div />; }
    `));
    expect(r.ok).toBe(true);
  });

  it('never flags lowercase host elements even if unusual', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App() { return <main><section><article/></section></main>; }
    `));
    expect(r.ok).toBe(true);
  });
});

describe('analyzeJsxComponents — violations', () => {
  it('flags a capitalized component that is never imported or defined', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App() { return <div><MysteryWidget /></div>; }
    `));
    expect(r.ok).toBe(false);
    expect(r.undefinedComponents).toHaveLength(1);
    expect(r.undefinedComponents[0].component).toBe('MysteryWidget');
    expect(r.undefinedComponents[0].line).toBe(2);
  });

  it('flags a member-expression component whose root is undefined (styled.button)', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App() { return <styled.button>x</styled.button>; }
    `));
    expect(r.ok).toBe(false);
    expect(r.undefinedComponents[0].component).toBe('styled.button');
  });

  it('de-dupes repeated undefined usages within a file', async () => {
    const r = await analyzeJsxComponents(app(`
      export function App() { return <div><Foo /><Foo /><Foo /></div>; }
    `));
    expect(r.undefinedComponents).toHaveLength(1);
  });

  it('finds undefined components across multiple files with correct locations', async () => {
    const r = await analyzeJsxComponents({
      'src/A.tsx': `import { Ok } from './ok';\nexport const A = () => <Ok />;\n`,
      'src/B.tsx': `export const B = () => <Missing />;\n`,
    });
    expect(r.undefinedComponents).toHaveLength(1);
    expect(r.undefinedComponents[0].file).toBe('src/B.tsx');
    expect(r.undefinedComponents[0].component).toBe('Missing');
  });
});

describe('analyzeJsxComponents — robustness', () => {
  it('skips non-JSX files and returns honest zeros', async () => {
    const r = await analyzeJsxComponents({ 'src/util.ts': 'export const x = 1;', 'data.json': '{}' });
    expect(r.filesScanned).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('does not throw on unparseable content', async () => {
    const r = await analyzeJsxComponents({ 'src/broken.tsx': 'export const A = () => <Foo <<< />;' });
    expect(Array.isArray(r.undefinedComponents)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { deriveJourneys, formFeedsList } from '../src/server/AgentV3/journeyDerivation';

/**
 * AUTOPSY b9287f85 (2026-09-25) — "ek desi boyz naam ki ecom website create karo".
 *
 * The site rendered, typechecked, built for production and passed every page route in a real
 * browser. The release gate still said RED — "Not shippable — a real user journey failed" — twice:
 * `/: the item was submitted but never appeared on the page`, reported for BOTH `App.tsx` and
 * `pages/Home.tsx`. The journey had typed an email into the home page's NEWSLETTER box, pressed
 * Subscribe, and looked for that email among the featured PRODUCTS. A form and a list sitting in the
 * same file were taken to be one feature, and one form was counted as two journeys.
 */

const MARKER = 'nbai-3c9d';

const HOME = `import { useState } from 'react';
import { PRODUCTS } from '../data/products';
import ProductCard from '../components/ProductCard';

export default function Home() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const featured = PRODUCTS.filter((p) => p.featured).slice(0, 4);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubscribed(true);
    setEmail('');
    setTimeout(() => setSubscribed(false), 4000);
  };

  return (
    <div className="home">
      <section className="grid">
        {featured.map((p) => (<ProductCard key={p.id} product={p} />))}
      </section>
      <form className="newsletter" onSubmit={handleSubscribe}>
        <input type="email" placeholder="Enter your email" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit">Subscribe</button>
      </form>
      {subscribed && <p>Thanks for subscribing!</p>}
    </div>
  );
}`;

const APP = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Products from './pages/Products';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
      </Routes>
    </BrowserRouter>
  );
}`;

describe('1 · a newsletter box is not an add-item form', () => {
  it('the real shape: one journey, and it is a plain submit, never a create-and-find', () => {
    const js = deriveJourneys({ files: { 'src/App.tsx': APP, 'src/pages/Home.tsx': HOME }, marker: MARKER });
    expect(js).toHaveLength(1);
    expect(js[0].kind).toBe('form-submit');
    expect(js[0].route).toBe('/');
  });

  it('reads the handler the form really runs, and sees it adds nothing', () => {
    expect(formFeedsList(HOME, { kind: 'text', value: 'Subscribe' })).toBe('no');
  });

  it('a toast or a reset is still bookkeeping', () => {
    const src = `function onJoin(e) { e.preventDefault(); toast.success('Joined'); e.currentTarget.reset(); }
      <form onSubmit={onJoin}><input name="email" /><button type="submit">Join</button></form>`;
    expect(formFeedsList(src, null)).toBe('no');
  });

  it('an inline arrow that only forwards is judged by the handler it forwards to', () => {
    const src = `const subscribe = () => { setDone(true); };
      <form onSubmit={(e) => subscribe(e)}><input name="email" /></form>`;
    expect(formFeedsList(src, null)).toBe('no');
  });

  it('a button with no form is found by its own text', () => {
    const src = `const signUp = () => { setOk(true) };
      <input name="email" /><button onClick={signUp}>Sign up</button>`;
    expect(formFeedsList(src, { kind: 'text', value: 'Sign up' })).toBe('no');
  });
});

describe('2 · a form that really adds keeps its persistence check', () => {
  const todo = (handler: string) => `import { useState } from 'react';
export default function Todos() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  ${handler}
  return (
    <form onSubmit={add}>
      <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Add</button>
      <ul>{items.map((t) => (<li key={t.id}>{t.title}</li>))}</ul>
    </form>
  );
}`;

  it.each([
    ['functional update', 'const add = (e) => { e.preventDefault(); setItems((prev) => [...prev, { id: Date.now(), title }]); };'],
    ['spread', 'const add = (e) => { e.preventDefault(); setItems([...items, { id: 1, title }]); };'],
    ['prepend', 'function add(e) { e.preventDefault(); setItems([{ id: 1, title }, ...items]); }'],
    ['concat', 'const add = useCallback((e) => { setItems(items.concat({ title })); }, [items]);'],
  ])('%s → yes, and the journey is create-persists', (_label, handler) => {
    const src = todo(handler);
    expect(formFeedsList(src, { kind: 'text', value: 'Add' })).toBe('yes');
    const js = deriveJourneys({ files: { 'src/pages/Todos.tsx': src }, marker: MARKER });
    expect(js[0].kind).toBe('create-persists');
  });

  it.each([
    ['a hook we cannot see into', 'const add = (e) => { e.preventDefault(); addTask(title); };'],
    ['a dispatch', 'const add = (e) => { dispatch({ type: "ADD", title }); };'],
    ['a POST', 'const add = async (e) => { await fetch("/api/todos", { method: "POST" }); };'],
  ])('%s → unknown, and today\'s create-persists stands', (_label, handler) => {
    const src = todo(handler);
    expect(formFeedsList(src, { kind: 'text', value: 'Add' })).toBe('unknown');
    expect(deriveJourneys({ files: { 'src/pages/Todos.tsx': src }, marker: MARKER })[0].kind).toBe('create-persists');
  });

  it('a handler that is a prop or an import is unknown, never no', () => {
    expect(formFeedsList('<form onSubmit={onAdd}><input name="t" /></form>', null)).toBe('unknown');
    expect(formFeedsList('<form><input name="t" /><button type="submit">Add</button></form>', null)).toBe('unknown');
  });
});

describe('3 · one form, one journey', () => {
  it('a form component imported by two pages is derived once', () => {
    const form = `const add = (e) => { setRows((r) => [...r, e]); };
      export default function AddRow() { return (<form onSubmit={add}><input name="title" /><button type="submit">Add</button></form>); }`;
    const page = (n: string) => `import AddRow from '../components/AddRow';
      export default function ${n}() { return (<div><AddRow /></div>); }`;
    const js = deriveJourneys({
      files: { 'src/components/AddRow.tsx': form, 'src/pages/A.tsx': page('A'), 'src/pages/B.tsx': page('B') },
      marker: MARKER,
    });
    expect(js).toHaveLength(1);
  });
});

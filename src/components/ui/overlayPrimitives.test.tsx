import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { popoverPanelClasses } from './variants';
import { Popover } from './Popover';

/** P-DESIGN.2 — overlay primitives: pure class resolvers + render smoke (no DOM, static markup). */

describe('overlay variant resolvers (pure)', () => {
  it('popover panel is absolute + floating', () => {
    expect(popoverPanelClasses()).toContain('absolute');
    expect(popoverPanelClasses()).toContain('rounded-xl');
  });
});

describe('overlay primitives render', () => {
  it('Popover renders its trigger (panel is closed until clicked)', () => {
    const html = renderToStaticMarkup(<Popover trigger={<button>Open</button>}><div>Menu item</div></Popover>);
    expect(html).toContain('Open');
    expect(html).toContain('aria-haspopup="true"');
    // Closed initially — the panel content is not in the static markup.
    expect(html).not.toContain('Menu item');
  });
});

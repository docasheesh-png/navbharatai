import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { overlayBackdropClasses, popoverPanelClasses, drawerPanelClasses, bottomSheetClasses } from './variants';
import { Drawer } from './Drawer';
import { BottomSheet } from './BottomSheet';
import { Popover } from './Popover';

/** P-DESIGN.2 — overlay primitives: pure class resolvers + render smoke (no DOM, static markup). */

describe('overlay variant resolvers (pure)', () => {
  it('backdrop is a fixed full-screen dim layer', () => {
    expect(overlayBackdropClasses()).toContain('fixed inset-0');
    expect(overlayBackdropClasses()).toContain('bg-black/60');
  });
  it('popover panel is absolute + floating', () => {
    expect(popoverPanelClasses()).toContain('absolute');
    expect(popoverPanelClasses()).toContain('rounded-xl');
  });
  it('drawer side controls which edge it docks to', () => {
    expect(drawerPanelClasses('right')).toContain('right-0');
    expect(drawerPanelClasses('right')).toContain('border-l');
    expect(drawerPanelClasses('left')).toContain('left-0');
    expect(drawerPanelClasses('left')).toContain('border-r');
  });
  it('bottom sheet docks to the bottom', () => {
    expect(bottomSheetClasses()).toContain('bottom-0');
    expect(bottomSheetClasses()).toContain('rounded-t-2xl');
  });
});

describe('overlay primitives render', () => {
  it('Drawer renders title + children when open, nothing when closed', () => {
    const open = renderToStaticMarkup(<Drawer open onClose={() => {}} title="Settings"><p>Body</p></Drawer>);
    expect(open).toContain('Settings');
    expect(open).toContain('Body');
    expect(open).toContain('role="dialog"');
    const closed = renderToStaticMarkup(<Drawer open={false} onClose={() => {}}><p>Body</p></Drawer>);
    expect(closed).toBe('');
  });
  it('BottomSheet renders children when open, nothing when closed', () => {
    const open = renderToStaticMarkup(<BottomSheet open onClose={() => {}} title="Actions"><p>Sheet body</p></BottomSheet>);
    expect(open).toContain('Sheet body');
    expect(renderToStaticMarkup(<BottomSheet open={false} onClose={() => {}}><p>x</p></BottomSheet>)).toBe('');
  });
  it('Popover renders its trigger (panel is closed until clicked)', () => {
    const html = renderToStaticMarkup(<Popover trigger={<button>Open</button>}><div>Menu item</div></Popover>);
    expect(html).toContain('Open');
    expect(html).toContain('aria-haspopup="true"');
    // Closed initially — the panel content is not in the static markup.
    expect(html).not.toContain('Menu item');
  });
});

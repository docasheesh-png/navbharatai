import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { attachMenuPosition } from '../../lib/attachMenuPosition';

/** A content-sized non-modal popup that cannot be clipped by the composer toolbar. */
export function ComposerPopover({ anchorRef, label, width = 300, onClose, children }: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  label: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  const placeRef = useRef<(() => void) | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const place = () => {
      const box = anchor.closest('.nb-composer-box') ?? anchor;
      const vv = window.visualViewport;
      const viewport = { top: vv?.offsetTop ?? 0, left: vv?.offsetLeft ?? 0,
        width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
      // Set width before measuring wrapped content. Do not set bottom: top + bottom
      // stretches short menus into empty sheets on mobile.
      menu.style.width = `${Math.max(0, Math.min(widthRef.current, viewport.width - 16))}px`;
      const rect = box.getBoundingClientRect();
      const position = attachMenuPosition({ top: rect.top, bottom: rect.bottom,
        left: anchor.getBoundingClientRect().left }, viewport, menu.scrollHeight + menu.offsetHeight - menu.clientHeight, widthRef.current);
      for (const [key, value] of Object.entries(position)) menu.style.setProperty(
        key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), `${value}px`);
      menu.style.visibility = 'visible';
    };
    placeRef.current = place;
    place();
    // The element must be visible before focus. Repositioning never steals focus.
    menu.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')?.focus();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(menu);
    observer?.observe(anchor.closest('.nb-composer-box') ?? anchor);
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.contains(event.target) && !anchor.contains(event.target)) closeRef.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      anchor.focus();
      closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    menu.addEventListener('keydown', keydown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      placeRef.current = null;
      observer?.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      menu.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      if (menu.contains(document.activeElement) || document.activeElement === document.body) anchor.focus();
    };
  }, [anchorRef]);
  useLayoutEffect(() => { placeRef.current?.(); }, [width]);
  return createPortal(<div ref={menuRef} role="dialog" aria-label={label}
    data-composer-popover className="rounded-xl border border-line bg-card text-body shadow-xl p-1.5"
    style={{ position: 'fixed', visibility: 'hidden', zIndex: 80, overflowY: 'auto', overscrollBehavior: 'contain' }}>
    {children}
  </div>, document.body);
}

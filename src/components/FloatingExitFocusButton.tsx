// THE FOCUS MODE EXIT BUTTON — floating, and the finger decides where it lives (admin 2026-09-22:
// *"full screen off (collapse) button upper right corner me fix hai. isko moveable banao, user usko
// ungli se khich ke kahi bhi rakh sake!"*). The button that ENTERS focus mode stays in the header
// where it is; this is the one that shows once the header is gone.
//
// It starts exactly where it has always sat — top-right, under the notch — so a user who never drags
// it sees no change; a drag anywhere is remembered per browser and clamped to every screen it is next
// shown on. The drag/tap/clamp/remember mechanics are `useDraggableFloat`, shared with the admin copy
// button, not a second copy.
//
// ⚠️ THE BLUR IS DELIBERATE AND JUSTIFIED IN PLACE (see the note beside its mount in App.tsx and
// `tests/theAppDoesNotBlurWhatNobodyCanSee.test.ts`): 36×36px, rendered only in focus mode, and at a
// scrim opacity where the blur is genuinely visible. It moved here from App.tsx with the button.

import { Minimize2 } from 'lucide-react';
import { useDraggableFloat } from '../hooks/useDraggableFloat';
import { topRightPosition } from '../lib/floatingButtonPosition';

/** Survives a reload; per browser; nothing but two numbers. */
export const FOCUS_EXIT_POSITION_KEY = 'nbai.focusExit.pos';

const SIZE = { width: 36, height: 36 };

/**
 * The notch height, read from the safe-area the browser exposes; the pure default adds it to the top
 * margin so the button never starts under a status bar. Zero wherever the value is unavailable.
 */
function safeAreaTop(): number {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return Number.isFinite(h) ? h : 0;
  } catch {
    return 0;
  }
}

export function FloatingExitFocusButton({ onExit }: { onExit: () => void }) {
  const { pos, dragging, shellRef, handlers } = useDraggableFloat({
    storageKey: FOCUS_EXIT_POSITION_KEY,
    fallbackSize: SIZE,
    initialPosition: (size, view) => topRightPosition(size, view, undefined, safeAreaTop()),
    onTap: onExit,
  });
  if (!pos) return null;
  // BLUR-OVER-SCROLL-OK — the justification, in place (tests/theAppDoesNotBlurWhatNobodyCanSee.test.ts):
  // this is the mirror image of the bottom nav's retired blur. It renders ONLY in focus mode, it is
  // 36×36px rather than the full width of the screen, and at the scrim's opacity the blur is
  // genuinely visible instead of being hidden under a 95%-opaque surface. Cost small, effect real.
  return (
    <div
      ref={shellRef}
      className={`fixed z-[9999] w-9 h-9 flex items-center justify-center rounded-full bg-scrim hover:bg-scrim backdrop-blur-md border border-line text-body hover:text-ink shadow-lg transition-transform select-none cursor-grab ${
        dragging ? 'cursor-grabbing scale-110' : 'active:scale-90'
      }`}
      style={{ left: `${pos.x}px`, top: `${pos.y}px`, touchAction: 'none' }}
      role="button"
      tabIndex={0}
      title="Exit Focus Mode (Esc) · drag to move"
      aria-label="Exit Focus Mode — show header"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExit(); } }}
      {...handlers}
    >
      <Minimize2 className="w-4 h-4" />
    </div>
  );
}

import React from 'react';
import { Smartphone, Tablet, Monitor } from 'lucide-react';
import { DEVICE_WIDTHS, splitForPaneWidth, splitBounds, matchedDevice, paneWidthPx, type DeviceId } from './splitPane';

/**
 * Phone · Tablet · Desktop — one tap each, plus the preview's REAL width in pixels.
 *
 * Why this belongs in the preview's own header rather than on the divider: the divider answers "how
 * should I share the screen", these answer "how wide is my app right now" — the same number seen
 * from opposite ends. Putting them where the user is already looking at their app is what turns a
 * layout control into a check they will actually perform.
 *
 * 🔒 HONEST BY CONSTRUCTION, in three places:
 *   • The px label is MEASURED from the real pane, never from the button that was pressed. Tap
 *     "Tablet" on a narrow laptop and it will read 690px, not 768 — the number is the truth, and the
 *     chip simply does not light up.
 *   • A device that cannot fit is DISABLED with a plain reason, instead of silently doing something
 *     smaller and letting the user believe they checked a tablet.
 *   • Nothing is emulated. There is no fake user-agent, no device frame, no scaling. The app is
 *     genuinely laid out at that width in a real browser, which is why the check is worth anything.
 */
export function PreviewWidthChips({ split, containerPx, onSplit }: {
  /** Chat's share, in percent — the same single number the divider drives. */
  split: number;
  /** The measured width of the row both panes share. 0 while it is unknown. */
  containerPx: number;
  onSplit: (pct: number) => void;
}) {
  const paneWidth = paneWidthPx(split, containerPx);
  const active = matchedDevice(paneWidth, containerPx);

  const chip = (id: DeviceId, label: string, Icon: typeof Smartphone, onTap: () => void, disabled: boolean, title: string) => (
    <button
      key={id}
      type="button"
      onClick={onTap}
      disabled={disabled}
      title={title}
      aria-pressed={active === id}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors
        ${active === id ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}
        ${disabled ? 'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-zinc-400' : ''}`}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  return (
    <div className="flex items-center gap-1 text-[11px]">
      {DEVICE_WIDTHS.map((d) => {
        const { pct, exact } = splitForPaneWidth(d.px, containerPx);
        return chip(d.id, d.label, d.id === 'phone' ? Smartphone : Tablet, () => onSplit(pct), !exact,
          exact
            ? `Show the app at ${d.px}px — a real ${d.label.toLowerCase()} width`
            : `This window is too narrow to show a true ${d.px}px ${d.label.toLowerCase()}`);
      })}
      {chip('desktop', 'Full', Monitor, () => onSplit(splitBounds(containerPx).min), containerPx <= 0,
        'Give the preview all the room this window has')}
      {/* The measured truth, always visible — this is what makes the chips checkable rather than
          decorative, and it is the number that keeps them honest when one cannot be satisfied. */}
      <span className="ml-0.5 font-mono text-zinc-500 tabular-nums" title="The preview's real width right now">
        {paneWidth > 0 ? `${paneWidth}px` : ''}
      </span>
    </div>
  );
}

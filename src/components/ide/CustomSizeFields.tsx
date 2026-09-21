import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  DEFAULT_CUSTOM_SIZE,
  MAX_CUSTOM_PX,
  MIN_CUSTOM_PX,
  clampCustomSide,
  describeSize,
  resolveCustomSize,
  stepCustomSide,
} from '../../lib/imageSize';

/**
 * The user's own width and height (admin-asked 2026-09-21: "sath ek extra custom size bhi add karna",
 * with "+/0/- button add karna").
 *
 * 🔑 IT SHOWS WHAT WILL REALLY BE MADE, NOT WHAT WAS TYPED. `resolveCustomSize` is the SERVER's rule,
 * imported rather than re-implemented, so the line under the fields is the size the generator will
 * actually produce. When those differ — a pair over the area cap is scaled down together to keep the
 * shape — it SAYS so. Silently generating something other than the number on screen is the exact
 * dishonesty `IMAGE_SIZE_PIXELS` already carries a warning about: "every number a user read there
 * was wrong".
 *
 * The three buttons are the admin's own list: − one step down, ⟲ back to the default, + one step up.
 */
export function CustomSizeFields({
  width,
  height,
  onChange,
  className,
}: {
  width: number;
  height: number;
  onChange: (w: number, h: number) => void;
  className?: string;
}) {
  const real = resolveCustomSize(width, height);
  const asked = describeSize(width, height);
  const made = describeSize(real.w, real.h);

  const field = (
    label: string,
    value: number,
    set: (n: number) => void,
    id: string,
  ) => (
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-wider text-muted w-3 shrink-0">{label}</label>
      <button
        type="button"
        aria-label={`${label} smaller`}
        onClick={() => set(stepCustomSide(value, -1))}
        disabled={value <= MIN_CUSTOM_PX}
        className="w-7 h-7 shrink-0 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
      >
        <Minus className="w-3 h-3" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN_CUSTOM_PX}
        max={MAX_CUSTOM_PX}
        step={1}
        value={value}
        /* Typed digits are NOT snapped on every keystroke: rounding to the step while somebody is
           still typing "1" of "1200" would fight them back to 256 on the first character. The snap
           happens on blur, and `resolveCustomSize` guarantees the sent value whatever is on screen. */
        onChange={(e) => set(Number(e.target.value))}
        onBlur={(e) => set(clampCustomSide(e.target.value, DEFAULT_CUSTOM_SIZE.w))}
        className="w-16 shrink-0 px-1.5 py-1 rounded-lg bg-card border border-line text-xs text-ink text-center focus:outline-none focus:border-accent-text"
      />
      <button
        type="button"
        aria-label={`${label} bigger`}
        onClick={() => set(stepCustomSide(value, 1))}
        disabled={value >= MAX_CUSTOM_PX}
        className="w-7 h-7 shrink-0 rounded-lg bg-raised border border-line text-body flex items-center justify-center disabled:opacity-40"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {field('W', width, (n) => onChange(n, height), 'nbai-custom-w')}
        <span aria-hidden="true" className="text-xs text-faint">&#215;</span>
        {field('H', height, (n) => onChange(width, n), 'nbai-custom-h')}
        <button
          type="button"
          aria-label="Reset to the default size"
          title="Back to 1024 × 1024"
          onClick={() => onChange(DEFAULT_CUSTOM_SIZE.w, DEFAULT_CUSTOM_SIZE.h)}
          className="w-7 h-7 shrink-0 rounded-lg bg-raised border border-line text-body flex items-center justify-center"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        {asked === made
          ? `Will be made at ${made} pixels.`
          : `Too large for one picture — it will be made at ${made} pixels, keeping the same shape.`}
      </p>
    </div>
  );
}

export default CustomSizeFields;

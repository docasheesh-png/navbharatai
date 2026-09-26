import React from 'react';
import { ListChecks } from 'lucide-react';
import { featureConfirmDisabled, setFeatureConfirmDisabled } from '../agentv3/featureConfirm';

/**
 * Settings → General: turn the feature card back on after "Don't ask again", or off without waiting for
 * the card. It reads and writes the SAME per-device preference the card's own checkbox does
 * (`featureConfirm.ts`), so the two can never disagree about whether the card is on.
 */
export function FeatureConfirmToggle() {
  const [enabled, setEnabled] = React.useState<boolean>(() => !featureConfirmDisabled());
  const toggle = () => {
    setEnabled((prev) => {
      const next = !prev;
      setFeatureConfirmDisabled(!next);
      return next;
    });
  };
  return (
    <div className="flex items-center justify-between p-4 sm:p-6 bg-surface border border-line rounded-2xl sm:rounded-[1.5rem] shadow-inner">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center shrink-0">
          <ListChecks className="w-5 h-5 text-accent-text" />
        </div>
        <div className="min-w-0">
          <h4 className="text-[11px] font-black text-ink uppercase tracking-widest">Confirm features before building</h4>
          <p className="text-[10px] text-muted mt-1 leading-relaxed max-w-xs">
            Before the first build of a new app, show the list of features I&apos;m about to build so you can untick any you don&apos;t want. Saved on this device.
          </p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label="Confirm the feature list before building a new app"
        onClick={toggle}
        className={`w-12 h-6 rounded-full p-1 flex items-center transition-all shrink-0 ${enabled ? 'bg-indigo-600 justify-end' : 'bg-well justify-start border border-line'}`}
      >
        <div className="w-4 h-4 rounded-full shadow-lg bg-card"></div>
      </button>
    </div>
  );
}

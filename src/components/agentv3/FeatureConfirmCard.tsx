import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { type FeaturePlanView, initialSelection, confirmationFrom } from './featureConfirm';

/**
 * "I'll build: … — OK?" shown before the first build of a new app. Every item starts ticked, so the
 * default is one tap; unticking removes a feature we misread from the request or a suggestion the user
 * does not want. See src/server/AgentV3/featurePlan.ts for why this exists.
 */
export function FeatureConfirmCard(props: {
  plan: FeaturePlanView;
  onBuild: (answer: { include: string[]; exclude: string[] }, dontAskAgain: boolean) => void;
  onCancel: () => void;
}) {
  const { plan, onBuild, onCancel } = props;
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(plan));
  const [dontAsk, setDontAsk] = useState(false);
  const toggle = (label: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const row = (label: string) => {
    const id = `feature-confirm-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    return (
      <li key={label} className="flex items-center gap-2">
        <input id={id} type="checkbox" className="accent-indigo-600" checked={selected.has(label)} onChange={() => toggle(label)} />
        <label htmlFor={id} className="text-[12px] text-body first-letter:uppercase">{label}</label>
      </li>
    );
  };
  return (
    <div className="px-3 py-2.5 bg-indigo-500/10 border border-line rounded" data-testid="feature-confirm-card">
      <div className="flex items-center gap-2 text-xs text-accent-text mb-1">
        <ListChecks className="w-4 h-4" /> Here is what I&apos;ll build — untick anything you don&apos;t want
      </div>
      {plan.named.length > 0 && (
        <>
          <div className="text-[11px] text-muted mt-1 mb-1">From your message</div>
          <ul className="space-y-1">{plan.named.map(row)}</ul>
        </>
      )}
      {plan.suggested.length > 0 && (
        <>
          <div className="text-[11px] text-muted mt-2 mb-1">Usually needed in an app like this</div>
          <ul className="space-y-1">{plan.suggested.map(row)}</ul>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          onClick={() => onBuild(confirmationFrom(plan, selected), dontAsk)}
          className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-on-accent"
        >Build</button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs rounded bg-transparent hover:bg-raised text-faint"
        >Cancel</button>
        <label className="flex items-center gap-1.5 text-[11px] text-muted ml-auto">
          <input type="checkbox" className="accent-indigo-600" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          Don&apos;t ask again
        </label>
      </div>
    </div>
  );
}

// P-UX.5 — Breadcrumb navigation.
//
// A small, dependency-free breadcrumb for deep views (e.g. Database Studio: source → collection →
// document). Pure presentational: pass an ordered list of crumbs; the last is the current location
// (non-interactive), earlier ones are clickable when they carry an onClick. Truncates long labels.

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Crumb {
  label: string;
  onClick?: () => void;
  title?: string;
}

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  const crumbs = (items || []).filter((c) => c && typeof c.label === 'string' && c.label.length > 0);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-xs min-w-0 overflow-hidden', className)}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const clickable = !isLast && typeof c.onClick === 'function';
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" />}
            {clickable ? (
              <button
                type="button"
                onClick={c.onClick}
                title={c.title || c.label}
                className="truncate max-w-[12rem] text-zinc-400 hover:text-white transition-colors"
              >
                {c.label}
              </button>
            ) : (
              <span
                title={c.title || c.label}
                aria-current={isLast ? 'page' : undefined}
                className={cn('truncate max-w-[12rem]', isLast ? 'text-zinc-200 font-medium' : 'text-zinc-400')}
              >
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export default Breadcrumb;

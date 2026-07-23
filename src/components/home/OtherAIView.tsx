import { motion } from 'motion/react';
import { LayoutGrid, ArrowLeft } from 'lucide-react';
import { ThemeMode, getThemeClasses } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { HOME_TOOL_GROUPS } from './homeToolGroups';

interface OtherAIViewProps {
  /** Open a builder tool by its workspace-tab id. */
  onOpenTool: (id: string) => void;
  /** Back to the Home page. */
  onBack?: () => void;
  theme: ThemeMode;
}

/**
 * The "Other AI" page — a full view (like Professionals) opened from the Home page's 4th card.
 * It renders EVERY builder-tool group INSIDE its own page (admin 2026-07-23: the tools must live
 * inside Other AI, not expand below the Home cards). Each tile opens its tool via onOpenTool.
 */
export function OtherAIView({ onOpenTool, onBack, theme }: OtherAIViewProps) {
  const colors = getThemeClasses(theme);
  return (
    <div className={cn('flex-1 w-full overflow-y-auto overflow-x-hidden', colors.bg, colors.text)}>
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs font-bold text-[#8b949e] hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5"
              aria-label="Back to Home"
            >
              <ArrowLeft className="w-4 h-4" /> Home
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-fuchsia-500/15 flex items-center justify-center shrink-0">
              <LayoutGrid className="w-5 h-5 text-fuchsia-400" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight leading-none">Other AI</h1>
              <p className="text-[11px] sm:text-xs text-[#8b949e] mt-0.5">Builder tools &amp; utilities — design, develop, ship &amp; monetize your app</p>
            </div>
          </div>
        </div>

        {/* Tool groups */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {HOME_TOOL_GROUPS.map((group, gi) => {
            const GroupIcon = group.icon;
            return (
              <motion.div
                key={group.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.04 * gi }}
                className="bg-[#161b22] border border-white/5 rounded-2xl p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <GroupIcon className={cn('w-3.5 h-3.5', group.color)} />
                  <span className={cn('text-[10px] font-black uppercase tracking-widest', group.color)}>{group.title}</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {group.items.map((item) => {
                    const ToolIcon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onOpenTool(item.id)}
                        className="flex items-center gap-2 p-3 min-h-[52px] bg-[#0d1117] border border-white/5 rounded-xl hover:border-indigo-500/30 hover:bg-indigo-600/10 active:bg-indigo-600/20 transition-all group text-left"
                      >
                        <ToolIcon className="w-4 h-4 text-[#8b949e] group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                        <span className="text-[11px] font-bold text-[#8b949e] group-hover:text-white transition-colors leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default OtherAIView;

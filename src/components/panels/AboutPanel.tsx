/**
 * Phase 1.7 — App.tsx split, Part 4: AboutPanel
 *
 * Extracted from App.tsx (was the `activeView === 'about'` block, ~118 lines).
 * Shows the "About NavBharatAI" page with admin-editable headline, description,
 * team, and vision fields.
 */
import { motion } from 'motion/react';
import { Shield, Bot, Camera, Edit2, User, Eye } from 'lucide-react';

export interface AboutData {
  logoUrl?: string;
  headline: string;
  description: string;
  team: string;
  vision: string;
}

export interface AboutPanelProps {
  isAdmin: boolean;
  aboutData: AboutData;
  onAboutDataChange: (data: AboutData) => void;
}

export function AboutPanel({ isAdmin, aboutData, onAboutDataChange }: AboutPanelProps) {
  return (
    <div className="flex-1 bg-[#0d1117] overflow-y-auto custom-scrollbar p-6 sm:p-12 relative">
      {isAdmin && (
        <div className="sticky top-0 right-0 z-50 flex justify-end pb-4">
          <div className="bg-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 hover:rotate-12 transition-transform" />
            Admin Edit Mode Active
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto space-y-12 pb-20">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4 relative group/header"
        >
          <div className="inline-block p-4 bg-indigo-600/10 rounded-[2.5rem] border border-indigo-500/20 mb-4 relative">
            <Bot className="w-16 h-16 text-indigo-500" />
            {isAdmin && (
              <button
                onClick={() => {
                  const url = prompt('Enter Logo URL:', aboutData.logoUrl || '');
                  if (url !== null) onAboutDataChange({ ...aboutData, logoUrl: url });
                }}
                className="absolute -bottom-2 -right-2 p-2 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-110 transition-all opacity-0 group-hover/header:opacity-100"
              >
                <Camera className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-center gap-4">
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tighter uppercase">{aboutData.headline}</h1>
            {isAdmin && (
              <button
                onClick={() => {
                  const val = prompt('Edit Headline:', aboutData.headline);
                  if (val) onAboutDataChange({ ...aboutData, headline: val });
                }}
                className="p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/header:opacity-100"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="relative group/desc">
            <p className="text-[#8b949e] text-lg max-w-2xl mx-auto font-medium leading-relaxed">{aboutData.description}</p>
            {isAdmin && (
              <button
                onClick={() => {
                  const val = prompt('Edit Description:', aboutData.description);
                  if (val) onAboutDataChange({ ...aboutData, description: val });
                }}
                className="absolute -top-4 -right-4 p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/desc:opacity-100"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </motion.header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#161b22] border border-white/5 p-8 rounded-[2.5rem] space-y-4 shadow-2xl relative group/card1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-xl font-black text-white tracking-tight uppercase">Our Team</h3>
              </div>
              {isAdmin && (
                <button
                  onClick={() => {
                    const val = prompt('Edit Team Info:', aboutData.team);
                    if (val) onAboutDataChange({ ...aboutData, team: val });
                  }}
                  className="p-2 bg-white/5 hover:bg-indigo-600 rounded-xl text-indigo-400 hover:text-white transition-all opacity-0 group-hover/card1:opacity-100"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[#8b949e] font-medium leading-relaxed">{aboutData.team}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#161b22] border border-white/5 p-8 rounded-[2.5rem] space-y-4 shadow-2xl relative group/card2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center">
                  <Eye className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-xl font-black text-white tracking-tight uppercase">Vision</h3>
              </div>
              {isAdmin && (
                <button
                  onClick={() => {
                    const val = prompt('Edit Vision Info:', aboutData.vision);
                    if (val) onAboutDataChange({ ...aboutData, vision: val });
                  }}
                  className="p-2 bg-white/5 hover:bg-emerald-600 rounded-xl text-emerald-400 hover:text-white transition-all opacity-0 group-hover/card2:opacity-100"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[#8b949e] font-medium leading-relaxed">{aboutData.vision}</p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

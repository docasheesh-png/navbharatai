import React, { useState } from 'react';
import { X, HardDrive, Github, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export type ZipSizeModalVariant = 'too-large' | 'github';

interface ZipSizeModalProps {
  variant: ZipSizeModalVariant;
  fileName: string;
  fileSizeMB: number;
  onClose: () => void;
}

export const ZipSizeModal: React.FC<ZipSizeModalProps> = ({ variant, fileName, fileSizeMB, onClose }) => {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {variant === 'too-large'
              ? <HardDrive className="w-4 h-4 text-red-400" />
              : <Github className="w-4 h-4 text-indigo-400" />
            }
            <span className="text-[11px] font-black uppercase tracking-widest text-white">
              {variant === 'too-large' ? 'File Too Large' : 'Large File — Use GitHub'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-[#8b949e] hover:text-white transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* File info badge */}
        <div className="bg-white/5 border border-white/5 rounded-xl px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] text-[#8b949e] font-mono truncate max-w-[180px]">{fileName}</span>
          <span className="text-[10px] font-black text-amber-400 shrink-0 ml-2">{fileSizeMB.toFixed(0)} MB</span>
        </div>

        {/* too-large variant */}
        {variant === 'too-large' && (
          <>
            <div className="space-y-1.5">
              <p className="text-[12px] text-white font-bold">This file is too large to upload here.</p>
              <p className="text-[11px] text-[#8b949e] leading-relaxed">
                Files over 500 MB cannot be processed in the browser. Use VS Code to work with this project locally.
              </p>
            </div>
            <a
              href="https://code.visualstudio.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[11px] font-black hover:bg-indigo-600/30 transition-all active:scale-95"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Download VS Code
            </a>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[#8b949e] text-[11px] font-black hover:bg-white/10 transition-all active:scale-95"
            >
              Dismiss
            </button>
          </>
        )}

        {/* github variant */}
        {variant === 'github' && (
          <>
            <div className="space-y-1.5">
              <p className="text-[12px] text-white font-bold">Connect via GitHub instead.</p>
              <p className="text-[11px] text-[#8b949e] leading-relaxed">
                Files between 50–500 MB are best imported through GitHub. Push your project to a repo, then connect it here.
              </p>
            </div>

            <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-2.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#8b949e]">Steps</p>
              {[
                { n: '1', text: "Create a free GitHub account if you don't have one." },
                { n: '2', text: 'Create a new repository and push your project files.' },
                { n: '3', text: 'Open the Git panel in navBharatAI and paste your repo URL.' },
                { n: '4', text: 'navBharatAI will clone and open your workspace automatically.' },
              ].map(({ n, text }) => (
                <div key={n} className="flex gap-2.5 items-start">
                  <span className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-[8px] font-black flex items-center justify-center shrink-0 mt-0.5">
                    {n}
                  </span>
                  <p className="text-[10px] text-[#8b949e] leading-snug">{text}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <a
                href="https://github.com/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[10px] font-black hover:bg-indigo-600/30 transition-all active:scale-95"
              >
                <Github className="w-3 h-3" />
                New Repo
              </a>
              <a
                href="https://github.com/join"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/5 border border-white/10 text-[#8b949e] text-[10px] font-black hover:bg-white/10 transition-all active:scale-95"
              >
                <ExternalLink className="w-3 h-3" />
                Sign Up Free
              </a>
            </div>

            {/* Help toggle */}
            <button
              onClick={() => setShowHelp(h => !h)}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#8b949e] hover:text-white transition-all"
            >
              {showHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Help
            </button>

            <AnimatePresence>
              {showHelp && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-2 text-[10px] text-[#8b949e] leading-relaxed">
                    <p className="font-bold text-white text-[10px]">Why not just upload the ZIP?</p>
                    <p>Your browser has a memory limit. Files over 50 MB can crash the tab during extraction. GitHub keeps files in the cloud, so your device doesn't have to hold them all at once.</p>
                    <p className="font-bold text-white text-[10px] mt-2">How do I push to GitHub?</p>
                    <p>Install <a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline">Git</a>, then run these commands in your project folder:</p>
                    <pre className="bg-black/50 rounded-lg p-2 font-mono text-[9px] text-emerald-400 whitespace-pre-wrap overflow-auto">
{`git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main`}
                    </pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[#8b949e] text-[11px] font-black hover:bg-white/10 transition-all active:scale-95"
            >
              Dismiss
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
};

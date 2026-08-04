import React from 'react';
import { X, HardDrive } from 'lucide-react';
import { motion } from 'motion/react';

// 'github' retired (2026-08-04): it told 50-500 MB users to go push to GitHub because our own
// transport could not carry their file. The transport is chunked now (up to 5 GB), so the only honest
// thing left to say is the real ceiling — and how to get under it.
export type ZipSizeModalVariant = 'too-large';

interface ZipSizeModalProps {
  variant: ZipSizeModalVariant;
  fileName: string;
  fileSizeMB: number;
  onClose: () => void;
}

export const ZipSizeModal: React.FC<ZipSizeModalProps> = ({ variant, fileName, fileSizeMB, onClose }) => {
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
            <HardDrive className="w-4 h-4 text-red-400" />
            <span className="text-[11px] font-black uppercase tracking-widest text-white">File Too Large</span>
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

        {/* The one honest gate: the real 5 GB ceiling, and how a real project gets under it. */}
        {variant === 'too-large' && (
          <>
            <div className="space-y-1.5">
              <p className="text-[12px] text-white font-bold">This file is over the 5 GB import limit.</p>
              <p className="text-[11px] text-[#8b949e] leading-relaxed">
                No app&apos;s source code is this big — the size is almost always <span className="text-white">node_modules</span>,
                <span className="text-white"> build output</span> and <span className="text-white">media files</span>, none of which
                need importing (dependencies are re-installed automatically).
              </p>
            </div>
            <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-2.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#8b949e]">Shrink it in one minute</p>
              {[
                { n: '1', text: 'Delete the node_modules, dist, build and .git folders from your project copy.' },
                { n: '2', text: 'Move large videos/images out — add them back after the import if needed.' },
                { n: '3', text: 'Zip the folder again and upload — it will usually be under 100 MB.' },
              ].map(({ n, text }) => (
                <div key={n} className="flex gap-2.5 items-start">
                  <span className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-[8px] font-black flex items-center justify-center shrink-0 mt-0.5">
                    {n}
                  </span>
                  <p className="text-[10px] text-[#8b949e] leading-snug">{text}</p>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-[#8b949e] text-[11px] font-black hover:bg-white/10 transition-all active:scale-95"
            >
              Got it
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
};

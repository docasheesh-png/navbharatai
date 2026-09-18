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
      className="fixed inset-0 z-[9999] bg-scrim backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-card border border-line rounded-2xl p-6 shadow-2xl space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-danger" />
            <span className="text-[11px] font-black uppercase tracking-widest text-ink">File Too Large</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-raised rounded-lg text-muted hover:text-ink transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* File info badge */}
        <div className="bg-raised border border-line rounded-xl px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] text-muted font-mono truncate max-w-[180px]">{fileName}</span>
          <span className="text-[10px] font-black text-warn shrink-0 ml-2">{fileSizeMB.toFixed(0)} MB</span>
        </div>

        {/* The one honest gate: the real 5 GB ceiling, and how a real project gets under it. */}
        {variant === 'too-large' && (
          <>
            <div className="space-y-1.5">
              <p className="text-[12px] text-ink font-bold">This file is over the 5 GB import limit.</p>
              <p className="text-[11px] text-muted leading-relaxed">
                No app&apos;s source code is this big — the size is almost always <span className="text-ink">node_modules</span>,
                <span className="text-ink"> build output</span> and <span className="text-ink">media files</span>, none of which
                need importing (dependencies are re-installed automatically).
              </p>
            </div>
            <div className="bg-well border border-line rounded-xl p-3 space-y-2.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted">Shrink it in one minute</p>
              {[
                { n: '1', text: 'Delete the node_modules, dist, build and .git folders from your project copy.' },
                { n: '2', text: 'Move large videos/images out — add them back after the import if needed.' },
                { n: '3', text: 'Zip the folder again and upload — it will usually be under 100 MB.' },
              ].map(({ n, text }) => (
                <div key={n} className="flex gap-2.5 items-start">
                  <span className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-accent-text text-[8px] font-black flex items-center justify-center shrink-0 mt-0.5">
                    {n}
                  </span>
                  <p className="text-[10px] text-muted leading-snug">{text}</p>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-raised border border-line text-muted text-[11px] font-black hover:bg-raised-hover transition-all active:scale-95"
            >
              Got it
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
};

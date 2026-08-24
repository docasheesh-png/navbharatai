/**
 * Phase 1.7 — App.tsx split, Part 3: DeploySuccessPanel
 *
 * Extracted from App.tsx (was the `activeView === 'deploy'` block, ~32 lines).
 * Shows the "App is Live!" success screen with the deployment URL.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { Rocket, Globe, Copy, Check } from 'lucide-react';

export interface DeploySuccessPanelProps {
  deployUrl: string;
  onOpenPreview: () => void;
  onBackToCode: () => void;
}

export function DeploySuccessPanel({ deployUrl, onOpenPreview, onBackToCode }: DeploySuccessPanelProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex-1 p-8 bg-[#0d1117] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-[#161b22] border border-white/10 rounded-3xl p-10 text-center shadow-3xl overflow-hidden relative"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 animate-pulse" />
        <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-emerald-500/20">
          <Rocket className="w-10 h-10 text-emerald-500" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">App is Live!</h3>
        <p className="text-sm text-[#8b949e] mb-8">Your application has been deployed to the edge network.</p>
        {/* I1: Clickable URL + copy button */}
        <div className="bg-[#0d1117] border border-white/10 rounded-2xl p-4 flex items-center gap-2 mb-8">
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 truncate text-left underline underline-offset-2"
          >
            {deployUrl}
          </a>
          <button
            onClick={() => { navigator.clipboard.writeText(deployUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 p-2 hover:bg-white/5 rounded-lg transition-colors"
            title="Copy URL"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#8b949e] hover:text-white" />}
          </button>
          <button
            onClick={() => window.open(deployUrl, '_blank')}
            className="shrink-0 p-2 hover:bg-white/5 rounded-lg transition-colors"
            title="Open in new tab"
          >
            <Globe className="w-4 h-4 text-[#8b949e] hover:text-white" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button onClick={onOpenPreview} className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold transition-all">Preview App</button>
          <button onClick={onBackToCode} className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20">Back to Code</button>
        </div>
      </motion.div>
    </div>
  );
}

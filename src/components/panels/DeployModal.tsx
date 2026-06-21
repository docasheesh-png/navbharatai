/**
 * Phase 1.7 — App.tsx split, Part 9: DeployModal
 *
 * Extracted from App.tsx (was the G8 one-click deploy overlay inside the
 * `nbi_pro_chat` view, ~110 lines). Self-contained modal: platform selector,
 * token input, platform-specific fields, and the Deploy Now action.
 *
 * Pure render — deploy state + the deploy action stay in App.tsx, threaded in
 * via explicit props. The parent decides when to render it (was `showDeployPanel`).
 */
import React from 'react';
import { cn } from '../../lib/utils';
import { Rocket, X, Loader2 } from 'lucide-react';

type DeployPlatform = 'vercel' | 'netlify' | 'github';

export interface DeployModalProps {
  platform: DeployPlatform;
  token: string;
  projectName: string;
  owner: string;
  repo: string;
  error: string;
  isDeploying: boolean;
  onClose: () => void;
  onPlatformChange: (p: DeployPlatform) => void;
  onTokenChange: (v: string) => void;
  onProjectNameChange: (v: string) => void;
  onOwnerChange: (v: string) => void;
  onRepoChange: (v: string) => void;
  onClearError: () => void;
  onDeploy: () => void;
}

export function DeployModal({
  platform, token, projectName, owner, repo, error, isDeploying,
  onClose, onPlatformChange, onTokenChange, onProjectNameChange,
  onOwnerChange, onRepoChange, onClearError, onDeploy,
}: DeployModalProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm mx-4 bg-[#161b22] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-widest">Deploy App</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-[#8b949e]" />
          </button>
        </div>

        {/* Platform selector */}
        <div className="grid grid-cols-3 gap-2">
          {(['vercel', 'netlify', 'github'] as const).map(p => (
            <button
              key={p}
              onClick={() => { onPlatformChange(p); onClearError(); }}
              className={cn(
                "py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all",
                platform === p
                  ? "bg-emerald-900/40 border-emerald-500/50 text-emerald-300"
                  : "bg-white/5 border-white/10 text-[#8b949e] hover:border-white/20 hover:text-white"
              )}
            >
              {p === 'github' ? 'GitHub' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Token input */}
        <div className="space-y-1">
          <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">
            {platform === 'vercel' ? 'Vercel Token' : platform === 'netlify' ? 'Netlify Token' : 'GitHub Token'}
          </label>
          <input
            type="password"
            value={token}
            onChange={e => { onTokenChange(e.target.value); onClearError(); }}
            placeholder={platform === 'vercel' ? 'Get at vercel.com/account/tokens' : platform === 'netlify' ? 'Get at app.netlify.com/user/applications' : 'github.com → Settings → Tokens'}
            className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        {/* Platform-specific fields */}
        {platform === 'vercel' && (
          <div className="space-y-1">
            <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => { onProjectNameChange(e.target.value); onClearError(); }}
              placeholder="my-app"
              className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500/50"
            />
          </div>
        )}
        {platform === 'netlify' && (
          <div className="space-y-1">
            <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">Site ID (optional)</label>
            <input
              type="text"
              value={projectName}
              onChange={e => { onProjectNameChange(e.target.value); onClearError(); }}
              placeholder="Leave blank to create new site"
              className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500/50"
            />
          </div>
        )}
        {platform === 'github' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">Owner</label>
              <input
                type="text"
                value={owner}
                onChange={e => { onOwnerChange(e.target.value); onClearError(); }}
                placeholder="username"
                className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[#8b949e] uppercase tracking-widest">Repo</label>
              <input
                type="text"
                value={repo}
                onChange={e => { onRepoChange(e.target.value); onClearError(); }}
                placeholder="repo-name"
                className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-[10px] text-red-400 bg-red-900/20 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
        )}

        <button
          onClick={onDeploy}
          disabled={isDeploying}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
        >
          {isDeploying ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deploying...</> : <><Rocket className="w-3.5 h-3.5" /> Deploy Now</>}
        </button>
      </div>
    </div>
  );
}

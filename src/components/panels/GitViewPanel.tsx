/**
 * Phase 1.7 — App.tsx split, Part 2: GitViewPanel
 *
 * Extracted from App.tsx (was the `activeView === 'git'` block, ~82 lines).
 * Wraps the GitPanel component in the DevOps Engine header + layout shell.
 * Phase 2.1 (git-native versioning) will modify this file, not App.tsx.
 */
import { Rocket, List, Github, Search } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { GitPanel } from '../ide/GitPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GitViewPanelProps {
  selectedRepo: { name: string; owner: { login: string } } | null;
  currentBranch: string;
  githubToken: string;
  githubUser: any;
  githubRepoContext: { owner: string; repo: string; branch: string } | null;
  isGHSyncing: boolean;
  isPushing: boolean;
  firebaseToken: string;
  firebaseUser: any;
  files: Record<string, string>;
  currentSessionId: string;
  sessions: { id: string; title?: string }[];
  onNavigateToGitHubRepos: () => void;
  onNavigateToConnections: () => void;
  onImportRepo: (repo: any, branch: string) => void;
  onConnectGitHub: () => void;
  onDisconnectGitHub: () => void;
  onPushToRepo: ((msg: string) => void) | null;
  onConnectFirebase: () => void;
  onDisconnectFirebase: () => void;
  onFilesChange: (files: Record<string, string>) => void;
  onAgentChange: (agent: string) => void;
  onToggleView: (view: string) => void;
  onActivatePreview: () => void;
  onActivateWorkspace: (agent: string) => void;
  onDeployViaV5: (provider: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GitViewPanel({
  selectedRepo,
  currentBranch,
  githubToken,
  githubUser,
  githubRepoContext,
  isGHSyncing,
  isPushing,
  firebaseToken,
  firebaseUser,
  files,
  currentSessionId,
  sessions,
  onNavigateToGitHubRepos,
  onNavigateToConnections,
  onImportRepo,
  onConnectGitHub,
  onDisconnectGitHub,
  onPushToRepo,
  onConnectFirebase,
  onDisconnectFirebase,
  onFilesChange,
  onAgentChange,
  onToggleView,
  onActivatePreview,
  onActivateWorkspace,
  onDeployViaV5,
}: GitViewPanelProps) {
  const resolvedRepoContext = githubRepoContext
    ?? (selectedRepo ? { owner: selectedRepo.owner.login, repo: selectedRepo.name, branch: currentBranch } : null);

  return (
    <div className="flex-1 bg-[#0d1117] p-4 lg:p-6 text-left min-h-screen flex flex-col items-center">
      <div className="max-w-4xl w-full h-[88vh] flex flex-col bg-[#161b22] border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="p-4 bg-[#0d1117] border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600/10 border border-indigo-600/20 rounded-xl flex items-center justify-center">
              <Rocket className="w-4.5 h-4.5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-widest leading-none font-sans">navBharatAI DevOps Engine</h3>
              <p className="text-[9px] text-[#8b949e] font-serif uppercase tracking-widest mt-1">
                {selectedRepo
                  ? `Active Repo: ${selectedRepo.name} (${currentBranch})`
                  : 'Sandbox Simulator Mode (GitHub Unconnected)'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {githubToken ? (
              <button
                onClick={onNavigateToGitHubRepos}
                className="px-3 py-1 bg-indigo-600/10 border border-indigo-500/25 hover:bg-indigo-600/20 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-indigo-400 flex items-center gap-1.5 cursor-pointer"
              >
                <List className="w-3 h-3" />
                {selectedRepo ? 'Switch Repo' : 'Select Repo'}
              </button>
            ) : (
              <button
                onClick={onNavigateToConnections}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Github className="w-3 h-3 text-white" />
                Connect GitHub
              </button>
            )}
            {selectedRepo && (
              <button
                onClick={() => onImportRepo(selectedRepo, currentBranch)}
                disabled={isGHSyncing}
                className="px-3 py-1 bg-white/5 border border-white/5 hover:border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                {isGHSyncing
                  ? <TirangaLoader className="w-3 h-3 text-white" />
                  : <Search className="w-3 h-3 text-white" />}
                Review Files
              </button>
            )}
          </div>
        </div>

        {/* GitPanel body */}
        <div className="flex-1 overflow-hidden">
          <GitPanel
            token={githubToken}
            user={githubUser}
            repoContext={resolvedRepoContext}
            isSyncing={isGHSyncing}
            isPushing={isPushing}
            onConnect={onConnectGitHub}
            onDisconnect={onDisconnectGitHub}
            // GitPanel's real push goes through its own executeRealGitHubPush → /api/github/push-enhanced;
            // `onPush` is not invoked by GitPanel. When no real handler is supplied, pass a no-op (never a
            // faked "[Sandbox Commit]" alert that pretends to commit).
            onPush={onPushToRepo ?? (() => { /* no-op — GitPanel pushes via its own real path */ })}
            files={files}
            projectId={currentSessionId}
            projectName={sessions.find(s => s.id === currentSessionId)?.title}
            firebaseToken={firebaseToken}
            firebaseUser={firebaseUser}
            onFirebaseConnect={onConnectFirebase}
            onFirebaseDisconnect={onDisconnectFirebase}
            onFilesChange={onFilesChange}
            onAgentChange={onAgentChange}
            onToggleView={onToggleView}
            onActivatePreview={onActivatePreview}
            onActivateWorkspace={onActivateWorkspace}
            onDeployViaV5={onDeployViaV5}
          />
        </div>
      </div>
    </div>
  );
}

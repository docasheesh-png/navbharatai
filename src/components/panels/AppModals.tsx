import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, ShieldCheck, Sparkles, X, Clock, Link as LinkIcon, AlertCircle, Settings, Globe, Lock } from 'lucide-react';
import { Github } from '../ui/BrandIcons';
import { TirangaLoader } from '../ui/TirangaLoader';
import { cn } from '../../lib/utils';
import { AuthComponent } from '../AuthComponent';
import { PROVIDER_CONFIG } from '../../types';
import { triggerCashfreeCheckout } from '../../services/paymentService';
import type { User as FirebaseUser } from 'firebase/auth';

export interface AppModalsProps {
  // Auth
  showAuth: boolean;
  auth: any;
  setUser: (user: FirebaseUser | null) => void;
  onCloseAuth: () => void;
  // GitHub redirect diagnostics
  githubRedirectingMessage: string | null;
  githubDebugData: { oauthUrl?: string; redirectUri?: string; currentDomain?: string; callbackUrl?: string } | null;
  setGithubRedirectingMessage: (v: string | null) => void;
  // UCI continuation modal
  showContinueModal: boolean;
  setShowContinueModal: (v: boolean) => void;
  setRestoreUciError: (v: string) => void;
  setResumeUciInputState: (v: string) => void;
  resumeUciInputState: string;
  restoreUciError: string;
  handleRestoreByUci: () => void;
  isRestoringUci: boolean;
  // Firebase OAuth error
  firebaseOauthError: { errorType: string; message: string; suggestions: string } | null;
  setFirebaseOauthError: (v: { errorType: string; message: string; suggestions: string } | null) => void;
  // API key modal
  pendingProvider: string | null;
  setPendingProvider: (v: string | null) => void;
  pendingKey: string;
  setPendingKey: (v: string) => void;
  handleKeySave: (provider: string, key: string) => void;
  // Checkout modal
  showCheckoutModal: boolean;
  setShowCheckoutModal: (v: boolean) => void;
  paymentSession: any;
  user: FirebaseUser | null;
  verifyBillingPayment: (status: string) => void;
  // Workspace preparing overlay
  isWorkspacePreparing: boolean;
  // Workspace prep error
  workspacePrepError: string | null;
  setWorkspacePrepError: (v: string | null) => void;
  // Preview builder overlay
  isPreviewBuilding: boolean;
  previewBuildStage: string;
  detectedFramework: string;
  // Preview failure popup
  previewBuildError: string | null;
  setPreviewBuildError: (v: string | null) => void;
}

export function AppModals({
  showAuth, auth, setUser, onCloseAuth,
  githubRedirectingMessage, githubDebugData, setGithubRedirectingMessage,
  showContinueModal, setShowContinueModal, setRestoreUciError, setResumeUciInputState,
  resumeUciInputState, restoreUciError, handleRestoreByUci, isRestoringUci,
  firebaseOauthError, setFirebaseOauthError,
  pendingProvider, setPendingProvider, pendingKey, setPendingKey, handleKeySave,
  showCheckoutModal, setShowCheckoutModal, paymentSession, user, verifyBillingPayment,
  isWorkspacePreparing,
  workspacePrepError, setWorkspacePrepError,
  isPreviewBuilding, previewBuildStage, detectedFramework,
  previewBuildError, setPreviewBuildError,
}: AppModalsProps) {
  return (
    <>
      {/* Auth Modal */}
      <AnimatePresence>
        {showAuth && (
          <AuthComponent
            auth={auth}
            setUser={setUser}
            onClose={onCloseAuth}
          />
        )}
      </AnimatePresence>

      {/* GitHub Redirect Diagnostics Overlay */}
      <AnimatePresence>
        {githubRedirectingMessage && (
          <div className="fixed inset-0 bg-surface backdrop-blur-md flex items-center justify-center p-4 z-[99999]">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-md bg-card border border-indigo-500/30 rounded-3xl p-6 space-y-4 shadow-2xl relative"
            >
              <div className="flex items-center gap-3 border-b border-line pb-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/35 flex items-center justify-center text-accent-text shrink-0">
                  <Github className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-ink">GitHub OAuth Shield</h4>
                  <p className="text-[9px] text-muted font-sans uppercase tracking-widest font-black">navBharat AI Authentication Diagnostics</p>
                </div>
              </div>

              <div className="space-y-3.5">
                <div className="flex items-center gap-2.5 bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-2xl">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                  <p className="text-[11px] font-bold text-accent-text leading-snug">{githubRedirectingMessage}</p>
                </div>

                <div className="space-y-2 text-left bg-well border border-line rounded-2xl p-4 font-mono text-[10px]">
                  <div className="flex justify-between border-b border-line pb-1.5 mb-1.5 font-sans">
                    <span className="text-muted font-bold uppercase text-[9px]">Diagnostic Key</span>
                    <span className="text-muted font-bold uppercase text-[9px]">Configured Status</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-muted block text-[9px] uppercase tracking-wider font-extrabold font-sans">Current Domain Origin</span>
                    <span className="text-ink block truncate">{githubDebugData?.currentDomain || window.location.origin}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-muted block text-[9px] uppercase tracking-wider font-extrabold font-sans">Assigned Callback URL</span>
                    <span className="text-accent-text block truncate">{githubDebugData?.redirectUri || 'Determining...'}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-muted block text-[9px] uppercase tracking-wider font-extrabold font-sans">Final Safe Redirection Link</span>
                    <span className="text-success block break-all leading-normal max-h-16 overflow-y-auto pr-1">
                      {githubDebugData?.oauthUrl || 'Awaiting API Handshake...'}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-muted leading-relaxed text-center font-medium">
                  We use the official native URL() parsing engine to prevent address parsing conflicts. Under mobile browser boundaries, check pop-up allowances.
                </p>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={() => {
                      if (githubDebugData?.oauthUrl) {
                        window.open(githubDebugData.oauthUrl, 'GitHub Auth', 'width=600,height=700');
                      }
                    }}
                    className="flex-1 py-3 bg-[#1f6feb] hover:bg-[#388bfd] hover:scale-[1.01] active:scale-95 text-on-accent rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Launch Popup Directly
                  </button>
                  <button
                    onClick={() => setGithubRedirectingMessage(null)}
                    className="px-4 py-3 bg-raised hover:bg-raised active:scale-95 border border-line text-ink rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UCI Continuation Modal */}
      <AnimatePresence>
        {showContinueModal && (
          <div className="absolute inset-0 bg-surface backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-sm bg-card border border-indigo-500/15 rounded-3xl p-6 space-y-4 shadow-3xl relative select-none"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-accent-text animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-ink">Restore Previous Session</span>
                </div>
                <button
                  onClick={() => {
                    setShowContinueModal(false);
                    setRestoreUciError('');
                    setResumeUciInputState('');
                  }}
                  className="p-1.5 hover:bg-raised rounded-lg text-muted hover:text-ink transition-all text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-muted leading-relaxed">
                  Enter your encrypted representation chat ID. This restores complete historic context, matching memory parameters, and file configurations in an instant.
                </p>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Paste Universal Chat ID (UCI) ..."
                  value={resumeUciInputState}
                  onChange={(e) => setResumeUciInputState(e.target.value)}
                  className="w-full bg-surface border border-line rounded-xl p-3 text-xs font-mono text-accent-text placeholder:text-faint focus:border-indigo-500 outline-none transition-all shadow-inner"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRestoreByUci();
                  }}
                  autoFocus
                />

                {restoreUciError && (
                  <p className="text-[9px] text-danger font-bold tracking-wide animate-pulse flex items-center gap-1">
                    ⚠️ {restoreUciError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setShowContinueModal(false);
                      setRestoreUciError('');
                      setResumeUciInputState('');
                    }}
                    className="px-3.5 py-2 hover:bg-raised text-muted hover:text-ink rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRestoreByUci}
                    disabled={isRestoringUci || !resumeUciInputState.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-on-accent rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 flex items-center gap-1"
                  >
                    {isRestoringUci ? <TirangaLoader className="w-3.5 h-3.5" /> : <LinkIcon className="w-3.5 h-3.5" />}
                    Restore Workspace
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GCP/Firebase OAuth Error Intervention Modal */}
      <AnimatePresence>
        {firebaseOauthError && (
          <div className="absolute inset-0 bg-scrim backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              className="w-full max-w-md bg-card border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-[0_0_50px_rgba(239,68,68,0.25)] relative text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-danger shrink-0">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-danger block">
                    GCP/Firebase Auth Interrupted
                  </span>
                  <h4 className="text-sm font-black uppercase tracking-tight text-ink leading-tight truncate">
                    {firebaseOauthError.errorType}
                  </h4>
                </div>
              </div>

              <div className="p-3.5 bg-red-950/20 border border-red-500/15 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-danger uppercase tracking-wider block">OAuth Failure Context:</span>
                <p className="text-[11px] text-danger font-mono leading-relaxed break-words font-medium">
                  {firebaseOauthError.message}
                </p>
              </div>

              <div className="p-3.5 bg-raised border border-line rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-muted uppercase tracking-wider block flex items-center gap-1">
                  <Settings className="w-3 h-3 text-accent-text" />
                  Recommended Correction Procedure:
                </span>
                <p className="text-[11px] text-muted leading-normal font-medium">
                  {firebaseOauthError.suggestions}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setFirebaseOauthError(null)}
                  className="px-5 py-2.5 bg-card hover:bg-raised border border-line text-ink rounded-xl text-[10px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center"
                >
                  Dismiss Error
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* API Key Required Intervention Modal */}
      <AnimatePresence>
        {pendingProvider && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingProvider(null)}
              className="absolute inset-0 bg-scrim backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-card border border-line rounded-3xl shadow-3xl w-full max-w-sm relative z-[1001] overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-indigo-500/20">
                  <ShieldCheck className="w-10 h-10 text-accent-text" />
                </div>

                <h3 className="text-xl font-bold text-ink mb-2">Key Required</h3>
                <p className="text-sm text-muted mb-8">
                  To use <span className="text-ink font-bold">{pendingProvider.toUpperCase()}</span>, you must provide your own API key.
                </p>

                <div className="space-y-4">
                  <div className="relative">
                    <input
                      autoFocus
                      type="password"
                      value={pendingKey}
                      onChange={(e) => setPendingKey(e.target.value)}
                      placeholder={`Enter ${pendingProvider.toUpperCase()} key`}
                      className="w-full bg-surface border border-line rounded-2xl px-5 py-4 text-sm font-mono text-accent-text outline-none focus:border-indigo-500 transition-all placeholder:opacity-50"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleKeySave(pendingProvider, pendingKey);
                          setPendingKey('');
                        }
                      }}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20">
                      <Lock className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => {
                        handleKeySave(pendingProvider, pendingKey);
                        setPendingKey('');
                      }}
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-on-accent rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20"
                    >
                      Save & Continue
                    </button>
                    <button
                      onClick={() => window.open(PROVIDER_CONFIG[pendingProvider]?.link, '_blank')}
                      className="w-full py-3 bg-raised border border-line hover:bg-raised text-ink rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Globe className="w-4 h-4" />
                      Get API Key
                    </button>
                    <button
                      onClick={() => setPendingProvider(null)}
                      className="text-[11px] font-bold text-faint hover:text-ink transition-colors py-2"
                    >
                      Cancel Selection
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Secure Cashfree Simulator / Status Modal */}
      <AnimatePresence>
        {showCheckoutModal && paymentSession && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCheckoutModal(false)}
              className="absolute inset-0 bg-scrim backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-card border border-line rounded-[2.5rem] shadow-3xl w-full max-w-md relative z-[1001] overflow-hidden p-6 sm:p-8"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-indigo-500 to-indigo-600"></div>

              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 text-accent-text font-mono text-[10px] font-bold uppercase tracking-wider mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {paymentSession.isSimulator ? "Development Simulation Gateway" : "Cashfree Secure Gateway"}
                  </div>
                  <h3 className="text-xl font-black text-ink uppercase tracking-tight">
                    {paymentSession.isSimulator ? "Simulate Payment Integration" : "Cashfree Order Active"}
                  </h3>
                </div>
                <button
                  onClick={() => setShowCheckoutModal(false)}
                  className="p-1.5 hover:bg-raised rounded-xl text-muted hover:text-ink transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-well border border-line rounded-2xl p-5 mb-6 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted font-semibold">Order ID:</span>
                  <span className="text-ink font-mono font-bold">#{paymentSession.orderId}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted font-semibold">Customer ID:</span>
                  <span className="text-ink font-mono">{user?.uid?.substring(0, 8)}...</span>
                </div>
                <div className="border-t border-line pt-3 flex justify-between items-center">
                  <span className="text-xs text-muted font-semibold">Recharge Amount:</span>
                  <span className="text-success font-mono font-black text-lg">₹{parseFloat(paymentSession.orderAmount || paymentSession.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {paymentSession.isSimulator ? (
                <div className="space-y-4">
                  <p className="text-xs text-muted leading-relaxed">
                    You are running without client or secret keys. We have loaded the NavBharat simulated gateway so that you can verify transactions, credit user wallets, and inspect telemetry.
                  </p>

                  <div className="space-y-2.5 pt-2">
                    <button
                      onClick={() => verifyBillingPayment('SUCCESS')}
                      className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-on-accent rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/15 transition-all text-center"
                    >
                      👍 Simulate PASS (Credit ₹{paymentSession.orderAmount})
                    </button>
                    <button
                      onClick={() => verifyBillingPayment('FAILED')}
                      className="w-full py-3 bg-surface border border-red-500/20 text-danger hover:bg-red-500/10 rounded-xl font-bold uppercase tracking-widest text-xs transition-all text-center"
                    >
                      👎 Simulate FAIL (Decline)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <p className="text-xs text-muted leading-relaxed">
                    The payment gateway script is initializing. You are being redirected to Cashfree's secure site where you can finalize the recharge transaction securely.
                  </p>

                  <div className="py-2.5 flex items-center justify-center space-x-2.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>

                  <button
                    onClick={() => triggerCashfreeCheckout(paymentSession.paymentSessionId, paymentSession.environment)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-on-accent rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-indigo-600/15 transition-all"
                  >
                    🚀 If not redirected, click here
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Premium AI Workspace Builder Overlay */}
      <AnimatePresence>
        {isWorkspacePreparing && (
          <div className="fixed inset-0 bg-surface backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-card border border-indigo-500/40 rounded-3xl p-6 space-y-6 text-center shadow-3xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-4 pt-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500/25 rounded-full blur-xl animate-pulse" />
                  <div className="relative w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/40 flex items-center justify-center text-accent-text">
                    <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-ink text-base font-black uppercase tracking-wider font-sans">🔥 Opening AI Workspace</h4>
                  <p className="text-[10px] text-accent-text font-bold uppercase tracking-widest font-mono font-black">Cognitive Pipeline Authorization</p>
                </div>
              </div>

              <div className="bg-well border border-line rounded-2xl p-4 text-center">
                <div className="flex items-center justify-center space-x-2.5 mb-2">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-muted text-[11px] font-semibold leading-relaxed">
                  Preparing synced project context for <span className="text-ink font-black">navBharatAI</span>...
                </p>
              </div>

              <p className="text-[8.5px] text-faint font-bold uppercase tracking-wider font-mono">
                Sovereign Model Intercept active • Do not refresh
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Workspace Binding Error Popup */}
      <AnimatePresence>
        {workspacePrepError && (
          <div className="fixed inset-0 bg-scrim backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-card border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-danger font-bold text-xl font-mono">
                  ✕
                </div>
                <div>
                  <h4 className="text-ink text-sm font-black uppercase tracking-wider font-sans">❌ Failed to open AI Workspace</h4>
                  <p className="text-[9px] text-danger font-bold uppercase tracking-widest font-mono font-black">Workspace session error</p>
                </div>
              </div>

              <div className="p-3.5 bg-well border border-line rounded-2xl text-[11px] text-muted leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-danger font-extrabold">Detailed Reason:</div>
                <p className="font-mono text-danger block text-[10px] break-words">{workspacePrepError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkspacePrepError(null)}
                  className="w-full py-2.5 bg-raised hover:bg-raised active:scale-95 border border-line text-ink rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Dismiss / Rectify Error
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Premium Real-Time Preview Builder Overlay */}
      <AnimatePresence>
        {isPreviewBuilding && (
          <div className="fixed inset-0 bg-surface backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-card border border-indigo-500/35 rounded-3xl p-6 space-y-5 shadow-3xl relative"
            >
              <div
                className="absolute top-0 left-0 h-[3px] bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-500"
                style={{
                  width: previewBuildStage === 'preparing' ? '20%' :
                         previewBuildStage === 'installing' ? '45%' :
                         previewBuildStage === 'building' ? '70%' :
                         previewBuildStage === 'starting' ? '90%' : '100%'
                }}
              />

              <div className="flex items-center gap-3.5 border-b border-line pb-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-accent-text relative">
                  <Globe className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-ink text-sm font-black uppercase tracking-wider font-sans">Building Preview</h4>
                  </div>
                  <p className="text-[10px] text-accent-text font-bold uppercase tracking-widest font-mono font-black">
                    Runtime: <span className="text-body font-extrabold">{detectedFramework}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {[
                  { key: 'preparing', label: 'Validating workspace files' },
                  { key: 'installing', label: 'Checking dependencies & file structure' },
                  { key: 'building', label: 'Bundling HTML + CSS + JS assets' },
                  { key: 'starting', label: 'Launching preview' },
                ].map((step, idx) => {
                  const stages = ['preparing', 'installing', 'building', 'starting', 'ready'];
                  const stageIdx = stages.indexOf(previewBuildStage);
                  const stepIdx = stages.indexOf(step.key);
                  const isFinished = stageIdx > stepIdx;
                  const isActive = previewBuildStage === step.key;

                  return (
                    <div
                      key={step.key}
                      className={cn(
                        "flex items-center gap-3 p-2.5 rounded-xl border transition-all text-xs font-semibold",
                        isFinished ? "bg-emerald-500/5 border-emerald-500/15 text-success" :
                        isActive ? "bg-indigo-600/10 border-indigo-500/25 text-ink animate-pulse" :
                        "bg-well border-line opacity-40 text-muted"
                      )}
                    >
                      <div className="shrink-0">
                        {isFinished ? (
                          <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500 flex items-center justify-center text-[10px] text-success font-black">
                            ✓
                          </div>
                        ) : isActive ? (
                          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-[9px] font-black animate-spin">
                            ⏳
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-card border border-line flex items-center justify-center text-[9px] font-mono text-muted">
                            {idx + 1}
                          </div>
                        )}
                      </div>
                      <p className="flex-1 min-w-0 truncate">{step.label}</p>
                    </div>
                  );
                })}
              </div>

              <div className="text-center font-mono text-[9px] text-faint uppercase font-bold tracking-widest leading-none pt-1">
                NavBharat Preview Runtime • Static HTML + CSS + JS
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-Time Preview Failure Popup */}
      <AnimatePresence>
        {previewBuildError && (
          <div className="fixed inset-0 bg-scrim backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-card border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-danger font-mono text-xl font-bold">
                  ✕
                </div>
                <div>
                  <h4 className="text-ink text-sm font-black uppercase tracking-wider font-sans">❌ Preview Failed</h4>
                  <p className="text-[9px] text-danger font-bold uppercase tracking-widest font-mono font-black">Development build halted</p>
                </div>
              </div>

              <div className="p-3.5 bg-well border border-line rounded-2xl text-[11px] text-muted leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-danger font-extrabold">Error Exception Logs:</div>
                <p className="font-mono text-danger block text-[10px] break-words">{previewBuildError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPreviewBuildError(null)}
                  className="w-full py-2.5 bg-raised hover:bg-raised active:scale-95 border border-line text-ink rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Dismiss Error / Repair Code
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

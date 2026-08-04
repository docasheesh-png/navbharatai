import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Github, ExternalLink, ShieldCheck, Sparkles, X, CreditCard, Loader2,
  Clock, Link as LinkIcon, AlertCircle, Settings, Globe, Lock,
} from 'lucide-react';
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
  // Vishwakarma unlock modal
  showVishwakarmaUnlockModal: boolean;
  setShowVishwakarmaUnlockModal: (v: boolean) => void;
  wallet: any;
  vkMode: 'basic' | 'pro' | 'vip';
  vkPromoCode: string;
  setVkPromoCode: (v: string) => void;
  redeemVishwakarmaPromo: () => void;
  isRedeemingVkPromo: boolean;
  couponError: string;
  couponSuccess: string;
  vkTokenInput: string;
  setVkTokenInput: (v: string) => void;
  isRecharging: boolean;
  createVishwakarmaOrder: (buyPass: boolean, tokens: number) => void;
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
  showVishwakarmaUnlockModal, setShowVishwakarmaUnlockModal,
  wallet, vkMode, vkPromoCode, setVkPromoCode, redeemVishwakarmaPromo,
  isRedeemingVkPromo, couponError, couponSuccess, vkTokenInput, setVkTokenInput,
  isRecharging, createVishwakarmaOrder,
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
          <div className="fixed inset-0 bg-[#0d1117]/90 backdrop-blur-md flex items-center justify-center p-4 z-[99999]">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-indigo-500/30 rounded-3xl p-6 space-y-4 shadow-2xl relative"
            >
              <div className="flex items-center gap-3 border-b border-white/5 pb-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/35 flex items-center justify-center text-indigo-400 shrink-0">
                  <Github className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-white">GitHub OAuth Shield</h4>
                  <p className="text-[9px] text-[#8b949e] font-sans uppercase tracking-widest font-black">navBharat AI Authentication Diagnostics</p>
                </div>
              </div>

              <div className="space-y-3.5">
                <div className="flex items-center gap-2.5 bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-2xl">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                  <p className="text-[11px] font-bold text-indigo-300 leading-snug">{githubRedirectingMessage}</p>
                </div>

                <div className="space-y-2 text-left bg-black/40 border border-white/5 rounded-2xl p-4 font-mono text-[10px]">
                  <div className="flex justify-between border-b border-white/5 pb-1.5 mb-1.5 font-sans">
                    <span className="text-[#8b949e] font-bold uppercase text-[9px]">Diagnostic Key</span>
                    <span className="text-[#8b949e] font-bold uppercase text-[9px]">Configured Status</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Current Domain Origin</span>
                    <span className="text-white block truncate">{githubDebugData?.currentDomain || window.location.origin}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Assigned Callback URL</span>
                    <span className="text-indigo-400 block truncate">{githubDebugData?.redirectUri || 'Determining...'}</span>
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-[#8b949e] block text-[9px] uppercase tracking-wider font-extrabold font-sans">Final Safe Redirection Link</span>
                    <span className="text-emerald-400 block break-all leading-normal max-h-16 overflow-y-auto pr-1">
                      {githubDebugData?.oauthUrl || 'Awaiting API Handshake...'}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-[#8b949e] leading-relaxed text-center font-medium">
                  We use the official native URL() parsing engine to prevent address parsing conflicts. Under mobile browser boundaries, check pop-up allowances.
                </p>

                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={() => {
                      if (githubDebugData?.oauthUrl) {
                        window.open(githubDebugData.oauthUrl, 'GitHub Auth', 'width=600,height=700');
                      }
                    }}
                    className="flex-1 py-3 bg-[#1f6feb] hover:bg-[#388bfd] hover:scale-[1.01] active:scale-95 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Launch Popup Directly
                  </button>
                  <button
                    onClick={() => setGithubRedirectingMessage(null)}
                    className="px-4 py-3 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Agent Vishwakarma Premium Access Modal */}
      <AnimatePresence>
        {showVishwakarmaUnlockModal && (
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-start md:items-center justify-center p-3 pt-24 md:pt-4 z-[9999] overflow-y-auto modal-scroll-lock">
            <motion.div
              initial={{ scale: 0.96, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 15, opacity: 0 }}
              className="w-full max-w-md md:max-w-[400px] bg-[#161b22] border border-amber-500/35 rounded-2xl p-4 sm:p-5 space-y-4 shadow-2xl relative max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
            >
              <div className="flex justify-between items-center shrink-0 border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-1.5 text-amber-500 font-bold uppercase tracking-wider text-[9px] sm:text-[10px] font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  Premium Sec-Ops Active Workspace
                </div>
                <button
                  type="button"
                  onClick={() => setShowVishwakarmaUnlockModal(false)}
                  className="p-1 px-2 bg-white/5 hover:bg-amber-500 hover:text-black rounded-lg text-[#8b949e] border border-white/10 hover:border-amber-500 transition-all font-mono text-[9px] sm:text-[10px] uppercase font-bold flex items-center gap-1 cursor-pointer select-none"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  Close
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 scrollbar-thin scrollbar-thumb-white/10 pr-0.5">
                <div className="flex gap-3 items-center bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 p-3 rounded-xl transition-all">
                  <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white tracking-tight uppercase leading-none">
                      🔥 Unlock Agent Vishwakarma
                    </h3>
                    <p className="text-[10px] text-[#8b949e] mt-1 leading-normal">
                      Your portal is locked. Complete checkout to activate dynamic modeling access.
                    </p>
                  </div>
                </div>

                <div className="bg-white/5 rounded-xl p-3 border border-white/5 space-y-1.5">
                  <h4 className="text-[9px] font-mono font-bold text-amber-400 tracking-wider uppercase mb-0.5">
                    ✓ Core System Capabilities
                  </h4>
                  <div className="space-y-1 text-[11px] text-[#8b949e]">
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>Full Codebase Creations & Visual Design</span>
                    </div>
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>OWASP Defenses & Exploit Scanning</span>
                    </div>
                    <div className="flex items-center gap-2 text-white">
                      <span className="text-emerald-400 font-extrabold">✓</span>
                      <span>Sovereign Multi-Model Reasoning Layers</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
                    <div>
                      <span className="text-[11px] font-bold text-white block uppercase tracking-wide">
                        Lifetime Entry Pass
                      </span>
                      <span className="text-[9px] text-[#8b949e]">
                        Mandatory one-time gateway fee
                      </span>
                    </div>
                    <div className="text-right">
                      {wallet?.hasVishwakarmaPass ? (
                        <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/10">
                          Activated
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-black text-amber-500 block">
                          ₹{(vkMode === 'pro' ? 100 : 50).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {!wallet?.hasVishwakarmaPass && (
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Have a promo code?"
                          value={vkPromoCode}
                          onChange={(e) => setVkPromoCode(e.target.value)}
                          className="flex-1 bg-[#0d1117] border border-blue-500/30 rounded-lg p-1.5 px-2 text-xs font-mono text-white placeholder:text-[#484f58] focus:border-blue-400 outline-none transition-all"
                        />
                        <button
                          onClick={redeemVishwakarmaPromo}
                          disabled={isRedeemingVkPromo}
                          className="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold tracking-wider transition-colors"
                        >
                          {isRedeemingVkPromo ? '...' : 'Apply'}
                        </button>
                      </div>
                      {couponError && <p className="text-[9px] text-red-500 mt-1">{couponError}</p>}
                      {couponSuccess && <p className="text-[9px] text-emerald-400 mt-1">{couponSuccess}</p>}
                    </div>
                  )}

                  <div className="space-y-1 p-3 bg-white/5 border border-white/5 rounded-xl relative">
                    <label className="text-[11px] font-bold text-white block uppercase tracking-wide">
                      Advance AI Tokens (₹)
                    </label>
                    <span className="text-[9px] text-[#8b949e] block leading-none font-mono">
                      Formula: ₹1.00 = 100 AI Tokens (Min: ₹10)
                    </span>

                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-white font-mono font-bold text-xs">₹</span>
                      <input
                        type="number"
                        placeholder="Enter amount (e.g. 50)"
                        value={vkTokenInput}
                        onChange={(e) => setVkTokenInput(e.target.value)}
                        className="w-full bg-[#0d1117] border border-white/10 rounded-lg p-1.5 px-2 text-xs font-mono text-white placeholder:text-[#484f58] focus:border-amber-500 outline-none transition-all shadow-inner"
                      />
                    </div>

                    <div className="mt-1 text-right">
                      <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full">
                        Estimated: {(parseFloat(vkTokenInput) ? Math.floor(parseFloat(vkTokenInput) * 100) : 0).toLocaleString()} Tokens
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-[#0d1117] border border-white/5 rounded-xl space-y-1 text-[11px]">
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Entry Pass Fee:</span>
                      <span>{wallet?.hasVishwakarmaPass ? '₹0.00 (Owned)' : `₹${(vkMode === 'pro' ? 100 : 50).toFixed(2)}`}</span>
                    </div>
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Tokens Purchase Amount:</span>
                      <span>₹{parseFloat(vkTokenInput) ? parseFloat(vkTokenInput).toFixed(2) : '0.00'}</span>
                    </div>
                    <div className="border-t border-white/5 pt-1.5 flex justify-between text-xs font-black text-white tracking-tight">
                      <span>TOTAL PAYABLE AMOUNT:</span>
                      <span className="text-amber-500 font-mono">
                        ₹{((wallet?.hasVishwakarmaPass ? 0 : (vkMode === 'pro' ? 100 : 50)) + (parseFloat(vkTokenInput) || 0)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 space-y-2 border-t border-white/5 pt-3">
                <button
                  type="button"
                  disabled={isRecharging || (
                    wallet?.hasVishwakarmaPass
                      ? !(parseFloat(vkTokenInput) >= 10 && parseFloat(vkTokenInput) <= 999999)
                      : (vkTokenInput.trim() !== '' && !(parseFloat(vkTokenInput) >= 10 && parseFloat(vkTokenInput) <= 999999))
                  )}
                  onClick={() => {
                    const buyPass = !wallet?.hasVishwakarmaPass;
                    const tokens = parseFloat(vkTokenInput) || 0;
                    createVishwakarmaOrder(buyPass, tokens);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-black font-black uppercase text-[11px] tracking-[0.1em] transition-all duration-200 active:scale-[0.98] shadow-lg shadow-amber-500/10 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer relative overflow-hidden group"
                >
                  <span className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  {isRecharging ? (
                    <>
                      <TirangaLoader className="w-3.5 h-3.5" />
                      Connecting Gateway...
                    </>
                  ) : wallet?.hasVishwakarmaPass ? (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Recharge Tokens (₹{(parseFloat(vkTokenInput) || 0).toFixed(2)})
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 animate-bounce" />
                      Buy Pass & Activate Vishwakarma (₹{((vkMode === 'pro' ? 100 : 50) + (parseFloat(vkTokenInput) || 0)).toFixed(2)})
                    </>
                  )}
                </button>
              </div>

              <div className="text-[8px] text-center text-[#8b949e] font-mono leading-relaxed select-none shrink-0 border-t border-white/5 pt-2">
                By purchasing, you accept our sovereign pay-and-use SLA terms.
                <br />
                Secured dynamically by navBharat SRE billing stack.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UCI Continuation Modal */}
      <AnimatePresence>
        {showContinueModal && (
          <div className="absolute inset-0 bg-[#0d1117]/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="w-full max-w-sm bg-[#161b22] border border-indigo-500/15 rounded-3xl p-6 space-y-4 shadow-3xl relative select-none"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white">Restore Previous Session</span>
                </div>
                <button
                  onClick={() => {
                    setShowContinueModal(false);
                    setRestoreUciError('');
                    setResumeUciInputState('');
                  }}
                  className="p-1.5 hover:bg-white/5 rounded-lg text-[#8b949e] hover:text-white transition-all text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-[#8b949e] leading-relaxed">
                  Enter your encrypted representation chat ID. This restores complete historic context, matching memory parameters, and file configurations in an instant.
                </p>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Paste Universal Chat ID (UCI) ..."
                  value={resumeUciInputState}
                  onChange={(e) => setResumeUciInputState(e.target.value)}
                  className="w-full bg-[#0d1117] border border-white/5 rounded-xl p-3 text-xs font-mono text-indigo-300 placeholder:text-[#484f58] focus:border-indigo-500 outline-none transition-all shadow-inner"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRestoreByUci();
                  }}
                  autoFocus
                />

                {restoreUciError && (
                  <p className="text-[9px] text-red-500 font-bold tracking-wide animate-pulse flex items-center gap-1">
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
                    className="px-3.5 py-2 hover:bg-white/5 text-[#8b949e] hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRestoreByUci}
                    disabled={isRestoringUci || !resumeUciInputState.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 flex items-center gap-1"
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
          <div className="absolute inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-[0_0_50px_rgba(239,68,68,0.25)] relative text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shrink-0">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#ff8080] block">
                    GCP/Firebase Auth Interrupted
                  </span>
                  <h4 className="text-sm font-black uppercase tracking-tight text-white leading-tight truncate">
                    {firebaseOauthError.errorType}
                  </h4>
                </div>
              </div>

              <div className="p-3.5 bg-red-950/20 border border-red-500/15 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#fda4af] uppercase tracking-wider block">OAuth Failure Context:</span>
                <p className="text-[11px] text-red-200/90 font-mono leading-relaxed break-words font-medium">
                  {firebaseOauthError.message}
                </p>
              </div>

              <div className="p-3.5 bg-zinc-950/40 border border-white/5 rounded-xl space-y-1">
                <span className="text-[8px] font-extrabold text-[#a1a1aa] uppercase tracking-wider block flex items-center gap-1">
                  <Settings className="w-3 h-3 text-indigo-400" />
                  Recommended Correction Procedure:
                </span>
                <p className="text-[11px] text-zinc-300 leading-normal font-medium">
                  {firebaseOauthError.suggestions}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setFirebaseOauthError(null)}
                  className="px-5 py-2.5 bg-zinc-900 hover:bg-[#21262d] border border-white/10 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-widest transition-all cursor-pointer text-center"
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
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-[#161b22] border border-white/10 rounded-3xl shadow-3xl w-full max-w-sm relative z-[1001] overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-indigo-500/20">
                  <ShieldCheck className="w-10 h-10 text-indigo-500" />
                </div>

                <h3 className="text-xl font-bold text-white mb-2">Key Required</h3>
                <p className="text-sm text-[#8b949e] mb-8">
                  To use <span className="text-white font-bold">{pendingProvider.toUpperCase()}</span>, you must provide your own API key.
                </p>

                <div className="space-y-4">
                  <div className="relative">
                    <input
                      autoFocus
                      type="password"
                      value={pendingKey}
                      onChange={(e) => setPendingKey(e.target.value)}
                      placeholder={`Enter ${pendingProvider.toUpperCase()} key`}
                      className="w-full bg-[#0d1117] border border-white/10 rounded-2xl px-5 py-4 text-sm font-mono text-indigo-400 outline-none focus:border-indigo-500 transition-all placeholder:opacity-50"
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
                      className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-600/20"
                    >
                      Save & Continue
                    </button>
                    <button
                      onClick={() => window.open(PROVIDER_CONFIG[pendingProvider]?.link, '_blank')}
                      className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Globe className="w-4 h-4" />
                      Get API Key
                    </button>
                    <button
                      onClick={() => setPendingProvider(null)}
                      className="text-[11px] font-bold text-[#484f58] hover:text-white transition-colors py-2"
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
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="bg-[#161b22] border border-white/10 rounded-[2.5rem] shadow-3xl w-full max-w-md relative z-[1001] overflow-hidden p-6 sm:p-8"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-indigo-500 to-indigo-600"></div>

              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 text-indigo-400 font-mono text-[10px] font-bold uppercase tracking-wider mb-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {paymentSession.isSimulator ? "Development Simulation Gateway" : "Cashfree Secure Gateway"}
                  </div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight">
                    {paymentSession.isSimulator ? "Simulate Payment Integration" : "Cashfree Order Active"}
                  </h3>
                </div>
                <button
                  onClick={() => setShowCheckoutModal(false)}
                  className="p-1.5 hover:bg-white/5 rounded-xl text-[#8b949e] hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-black/30 border border-white/5 rounded-2xl p-5 mb-6 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#8b949e] font-semibold">Order ID:</span>
                  <span className="text-white font-mono font-bold">#{paymentSession.orderId}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#8b949e] font-semibold">Customer ID:</span>
                  <span className="text-white font-mono">{user?.uid?.substring(0, 8)}...</span>
                </div>
                <div className="border-t border-white/5 pt-3 flex justify-between items-center">
                  <span className="text-xs text-[#8b949e] font-semibold">Recharge Amount:</span>
                  <span className="text-emerald-400 font-mono font-black text-lg">₹{parseFloat(paymentSession.orderAmount || paymentSession.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {paymentSession.isSimulator ? (
                <div className="space-y-4">
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    You are running without client or secret keys. We have loaded the NavBharat simulated gateway so that you can verify transactions, credit user wallets, and inspect telemetry.
                  </p>

                  <div className="space-y-2.5 pt-2">
                    <button
                      onClick={() => verifyBillingPayment('SUCCESS')}
                      className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-emerald-600/15 transition-all text-center"
                    >
                      👍 Simulate PASS (Credit ₹{paymentSession.orderAmount})
                    </button>
                    <button
                      onClick={() => verifyBillingPayment('FAILED')}
                      className="w-full py-3 bg-[#0d1117] border border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-xl font-bold uppercase tracking-widest text-xs transition-all text-center"
                    >
                      👎 Simulate FAIL (Decline)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <p className="text-xs text-[#8b949e] leading-relaxed">
                    The payment gateway script is initializing. You are being redirected to Cashfree's secure site where you can finalize the recharge transaction securely.
                  </p>

                  <div className="py-2.5 flex items-center justify-center space-x-2.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>

                  <button
                    onClick={() => triggerCashfreeCheckout(paymentSession.paymentSessionId, paymentSession.environment)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-indigo-600/15 transition-all"
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
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-[#161b22] border border-indigo-500/40 rounded-3xl p-6 space-y-6 text-center shadow-3xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-4 pt-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500/25 rounded-full blur-xl animate-pulse" />
                  <div className="relative w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                    <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-white text-base font-black uppercase tracking-wider font-sans">🔥 Opening AI Workspace</h4>
                  <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest font-mono font-black">Cognitive Pipeline Authorization</p>
                </div>
              </div>

              <div className="bg-black/45 border border-white/5 rounded-2xl p-4 text-center">
                <div className="flex items-center justify-center space-x-2.5 mb-2">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-[#8b949e] text-[11px] font-semibold leading-relaxed">
                  Preparing synced project context for <span className="text-white font-black">navBharatAI</span>...
                </p>
              </div>

              <p className="text-[8.5px] text-[#484f58] font-bold uppercase tracking-wider font-mono">
                Sovereign Model Intercept active • Do not refresh
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Workspace Binding Error Popup */}
      <AnimatePresence>
        {workspacePrepError && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-red-500 font-bold text-xl font-mono">
                  ✕
                </div>
                <div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">❌ Failed to open AI Workspace</h4>
                  <p className="text-[9px] text-red-400 font-bold uppercase tracking-widest font-mono font-black">Workspace session error</p>
                </div>
              </div>

              <div className="p-3.5 bg-black/40 border border-white/5 rounded-2xl text-[11px] text-[#8b949e] leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-red-400 font-extrabold">Detailed Reason:</div>
                <p className="font-mono text-red-200 block text-[10px] break-words">{workspacePrepError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkspacePrepError(null)}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
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
          <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-[#161b22] border border-indigo-500/35 rounded-3xl p-6 space-y-5 shadow-3xl relative"
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

              <div className="flex items-center gap-3.5 border-b border-white/5 pb-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 relative">
                  <Globe className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">Building Preview</h4>
                  </div>
                  <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest font-mono font-black">
                    Runtime: <span className="text-slate-200 font-extrabold">{detectedFramework}</span>
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
                        isFinished ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-400" :
                        isActive ? "bg-indigo-600/10 border-indigo-500/25 text-white animate-pulse" :
                        "bg-black/30 border-white/5 opacity-40 text-neutral-400"
                      )}
                    >
                      <div className="shrink-0">
                        {isFinished ? (
                          <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500 flex items-center justify-center text-[10px] text-emerald-400 font-black">
                            ✓
                          </div>
                        ) : isActive ? (
                          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-[9px] font-black animate-spin">
                            ⏳
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-stone-900 border border-white/10 flex items-center justify-center text-[9px] font-mono text-neutral-400">
                            {idx + 1}
                          </div>
                        )}
                      </div>
                      <p className="flex-1 min-w-0 truncate">{step.label}</p>
                    </div>
                  );
                })}
              </div>

              <div className="text-center font-mono text-[9px] text-[#484f58] uppercase font-bold tracking-widest leading-none pt-1">
                NavBharat Preview Runtime • Static HTML + CSS + JS
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-Time Preview Failure Popup */}
      <AnimatePresence>
        {previewBuildError && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[999999]">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm bg-[#161b22] border border-red-500/30 rounded-3xl p-6 space-y-4 shadow-3xl text-center relative"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"></div>

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/35 flex items-center justify-center text-red-500 font-mono text-xl font-bold">
                  ✕
                </div>
                <div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider font-sans">❌ Preview Failed</h4>
                  <p className="text-[9px] text-red-400 font-bold uppercase tracking-widest font-mono font-black">Development build halted</p>
                </div>
              </div>

              <div className="p-3.5 bg-black/40 border border-white/5 rounded-2xl text-[11px] text-[#8b949e] leading-relaxed text-left space-y-1.5">
                <div className="font-sans font-bold text-[10px] uppercase text-red-400 font-extrabold">Error Exception Logs:</div>
                <p className="font-mono text-red-200 block text-[10px] break-words">{previewBuildError}</p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPreviewBuildError(null)}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
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

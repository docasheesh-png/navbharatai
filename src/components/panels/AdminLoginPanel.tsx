/**
 * Phase 1.7 — App.tsx split, Part 5: AdminLoginPanel
 *
 * Extracted from App.tsx (was the `activeView === 'admin'` block, ~51 lines).
 * Shows the admin login gate or the AdminDashboard when authenticated.
 * The AdminDashboard import stays here; all login state flows via props.
 */
import React from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { AdminDashboard } from '../AdminDashboard';

export interface AdminLoginPanelProps {
  isAdmin: boolean;
  adminEmail: string;
  adminPassword: string;
  adminError: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onLogout: () => void;
  adminToken: string;
  /** P-SEC.3 — TOTP second factor. */
  adminTotp: string;
  onTotpChange: (v: string) => void;
  /** True once the server has indicated MFA is required for this account. */
  mfaRequired: boolean;
}

export function AdminLoginPanel({
  isAdmin,
  adminEmail,
  adminPassword,
  adminError,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onLogout,
  adminToken,
  adminTotp,
  onTotpChange,
  mfaRequired,
}: AdminLoginPanelProps) {
  return (
    <div className="flex-1 bg-[#0d1117] flex flex-col items-center justify-center p-6">
      {!isAdmin ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#161b22] border border-white/10 p-8 rounded-[2.5rem] shadow-3xl space-y-8"
        >
          <div className="text-center space-y-2">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl mb-4">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black text-white tracking-tight uppercase">Admin Access</h2>
            <p className="text-[10px] text-[#8b949e] font-black uppercase tracking-widest">Navbharat Enterprise Cloud Console</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Username</label>
              <input
                type="text"
                value={adminEmail}
                onChange={e => onEmailChange(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold outline-none focus:border-indigo-500"
                placeholder="aashishcpmt09"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Password</label>
              <input
                type="password"
                value={adminPassword}
                onChange={e => onPasswordChange(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold outline-none focus:border-indigo-500"
                placeholder="••••••••••••"
              />
            </div>
            {mfaRequired && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Authenticator Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={adminTotp}
                  onChange={e => onTotpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-bold tracking-[0.4em] text-center outline-none focus:border-indigo-500"
                  placeholder="000000"
                />
                <p className="text-[9px] text-[#8b949e] font-bold uppercase tracking-widest ml-1">6-digit code from your authenticator app</p>
              </div>
            )}
            {adminError && (
              <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest text-center">{adminError}</p>
            )}
            <button className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-600/30 transition-all active:scale-95">
              Authenticate
            </button>
          </form>
        </motion.div>
      ) : (
        <AdminDashboard adminToken={adminToken} onLogout={onLogout} />
      )}
    </div>
  );
}

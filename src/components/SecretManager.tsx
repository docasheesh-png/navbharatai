import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Lock, Eye, EyeOff, Save, Trash2, Plus, Copy } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)

interface Secret {
  id: string;
  secret_name: string;
  created_at: any;
  deleted?: boolean;
}

export const SecretManager: React.FC<{ userId: string }> = ({ userId }) => {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Cashfree Webhook Specific State variables
  const [cfSecretValue, setCfSecretValue] = useState('');
  const [showCfSecret, setShowCfSecret] = useState(false);
  const [isLoadingCfSecret, setIsLoadingCfSecret] = useState(false);
  
  // Custom Domain state for copying production webhooks
  const [useCustomDomain, setUseCustomDomain] = useState(true);
  const [customDomain, setCustomDomain] = useState('https://navbharatai.com');

  useEffect(() => {
    const q = query(
      collection(db, 'user_secrets'),
      where('user_id', '==', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const secretsData = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as Secret))
        .filter((s) => !s.deleted);
      setSecrets(secretsData);
    });

    return () => unsubscribe();
  }, [userId]);

  const addSecret = async () => {
    if (!name || !value) return;
    setIsLoading(true);
    setAddError('');
    try {
      await axios.post(`/api/secrets/${userId}`, { secret_name: name.trim(), secret_value: value.trim() });
      setName('');
      setValue('');
    } catch (err: any) {
      // Honest, visible failure — a silent console.error left the user thinking the key saved when it didn't.
      console.error('Failed to add secret:', err);
      setAddError(err?.response?.data?.error || 'Could not save the key. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveCfSecret = async () => {
    if (!cfSecretValue) return;
    setIsLoadingCfSecret(true);
    try {
      await axios.post(`/api/secrets/${userId}`, {
        secret_name: 'CASHFREE_WEBHOOK_SECRET',
        secret_value: cfSecretValue.trim()
      });
      setCfSecretValue('');
      alert('✅ Cashfree Webhook Secret securely updated!');
    } catch (err) {
      console.error('Failed to save Cashfree webhook secret:', err);
      alert('❌ Failed to save secret key.');
    } finally {
      setIsLoadingCfSecret(false);
    }
  };

  const deleteSecret = async (id: string) => {
    try {
      await axios.delete(`/api/secrets/${userId}/${id}`);
    } catch (err) {
      console.error('Failed to delete secret:', err);
    }
  };

  const isCfSecretConfigured = secrets.some(s => s.secret_name === 'CASHFREE_WEBHOOK_SECRET');

  return (
    <div id="secret-manager-container" className="p-6 bg-[#161b22] border border-white/5 rounded-[2.5rem] space-y-6 text-white min-h-screen">
      {/* {console.log('DEBUG: SecretManager rendered with userId', userId)} */}
      <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
        <Lock className="w-6 h-6 text-indigo-400" /> Secret Management
      </h2>

      {/* Cashfree Webhook Companion Panel */}
      <div className="bg-gray-800/60 p-5 rounded-2xl border border-indigo-500/20 space-y-4">
        <div className="flex justify-between items-start">
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">
            🔌 Cashfree Webhook Integration
          </h3>
          <span className={`text-[10px] uppercase px-2.5 py-1 rounded-full font-bold ${
            isCfSecretConfigured 
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}>
            {isCfSecretConfigured ? '● Configured' : '○ Not Configured'}
          </span>
        </div>
        
        <p className="text-xs text-gray-400 leading-relaxed bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
          Please select your production target below and map this Webhook URL into your <strong className="text-indigo-300">Cashfree PG Dashboard → Developers → Webhooks</strong>. Ensure you check <span className="bg-gray-900 px-1.5 py-0.5 rounded text-amber-400 font-mono font-bold">ORDER_PAID</span> as the primary trigger event.
        </p>

        {/* Environment Selection Toggle */}
        <div id="webhook-env-toggle" className="flex gap-2 bg-gray-900/80 p-1.5 rounded-xl border border-gray-800 text-xs">
          <button
            type="button"
            onClick={() => setUseCustomDomain(true)}
            className={`flex-1 py-2 px-3 rounded-lg text-center font-bold tracking-tight transition-all ${
              useCustomDomain 
                ? 'bg-indigo-600/90 text-white shadow' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🌐 Production (navbharatai.com)
          </button>
          <button
            type="button"
            onClick={() => setUseCustomDomain(false)}
            className={`flex-1 py-2 px-3 rounded-lg text-center font-bold tracking-tight transition-all ${
              !useCustomDomain 
                ? 'bg-indigo-600/90 text-white shadow' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            🧪 Sandbox/Dev Env
          </button>
        </div>

        {useCustomDomain && (
          <div className="space-y-1.5 animation-fade-in">
            <label className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">Production Custom Domain Name</label>
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="https://navbharatai.com"
              className="w-full bg-gray-900 border border-gray-800 p-2.5 rounded text-xs font-mono text-gray-300 outline-none focus:border-indigo-500"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">Your Cashfree Webhook Endpoint URL</label>
          <div className="flex gap-2 items-center bg-gray-900 p-2.5 rounded border border-gray-800">
            <input
              readOnly
              value={`${useCustomDomain ? customDomain.replace(/\/$/, '') : window.location.origin}/api/payment/webhook`}
              className="w-full bg-transparent text-xs font-mono text-indigo-300 outline-none select-all font-semibold"
            />
            <button
              onClick={() => {
                const targetUrl = `${useCustomDomain ? customDomain.replace(/\/$/, '') : window.location.origin}/api/payment/webhook`;
                navigator.clipboard.writeText(targetUrl);
                alert(`📋 Webhook URL Copied to Clipboard!\n👉 ${targetUrl}`);
              }}
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700 hover:scale-105 active:scale-95 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-all font-bold whitespace-nowrap"
            >
              <Copy size={12} /> Copy URL
            </button>
          </div>
        </div>

        <div className="space-y-2 pt-4 border-t border-gray-800/80">
          <label className="text-xs font-bold text-gray-300 block">Configure Webhook Secret (CASHFREE_WEBHOOK_SECRET)</label>
          <div className="relative">
            <input
              type={showCfSecret ? 'text' : 'password'}
              value={cfSecretValue}
              onChange={(e) => setCfSecretValue(e.target.value)}
              placeholder={isCfSecretConfigured ? "Secret is saved. Paste here to overwrite it..." : "Enter your Cashfree webhook secret..."}
              className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm font-mono placeholder:text-gray-500 pr-10 text-white outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => setShowCfSecret(!showCfSecret)}
              type="button"
              className="absolute right-3 top-3 text-gray-500 hover:text-white"
            >
              {showCfSecret ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <button
            onClick={saveCfSecret}
            disabled={isLoadingCfSecret || !cfSecretValue}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition"
          >
            {isLoadingCfSecret ? 'Saving secret...' : <><Save size={16} /> Update Webhook Secret</>}
          </button>
        </div>
      </div>
      
      <div className="bg-gray-800 p-4 rounded-lg space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Secret Name (e.g. GEMINI_API_KEY)"
          className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm font-mono placeholder:text-gray-500"
        />
        <div className="relative">
          <input
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Secret Value"
            className="w-full bg-gray-900 border border-gray-700 p-3 rounded text-sm font-mono placeholder:text-gray-500 pr-10"
          />
          <button onClick={() => setShowValue(!showValue)} className="absolute right-3 top-3 text-gray-500 hover:text-white">
            {showValue ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button
          onClick={addSecret}
          disabled={isLoading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 p-3 rounded font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2"
        >
          {isLoading ? 'Saving...' : <><Save size={16} /> Save Secret</>}
        </button>
        {addError && (
          <p className="text-[11px] text-red-400 font-semibold text-center">{addError}</p>
        )}
      </div>

      <div className="space-y-2">
        {secrets.map((s) => (
          <div key={s.id} className="flex justify-between items-center bg-gray-800 p-3 rounded font-mono text-xs">
            <span>{s.secret_name}</span>
            <button onClick={() => deleteSecret(s.id)} className="text-red-400 hover:text-red-300">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

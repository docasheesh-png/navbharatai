import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, Save, Trash2 } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase'; // shared handle → navbharat-prod (NOT the (default) DB)
// Authenticated vault client — always attaches the signed-in user's Firebase token. Raw axios calls
// here used to omit it, so requireUserMatch rejected every save (401) → keys never saved (admin fix).
import { saveSecret, deleteSecret } from '../lib/secretsApi';

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
      await saveSecret(userId, name.trim(), value.trim());
      setName('');
      setValue('');
    } catch (err: any) {
      // Honest, visible failure — a silent console.error left the user thinking the key saved when it didn't.
      console.error('Failed to add secret:', err);
      setAddError(err?.message || 'Could not save the key. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSecret = async (id: string) => {
    try {
      await deleteSecret(userId, id);
    } catch (err) {
      console.error('Failed to delete secret:', err);
    }
  };

  return (
    <div id="secret-manager-container" className="p-6 bg-[#161b22] border border-white/5 rounded-[2.5rem] space-y-6 text-white min-h-screen">
      <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
        <Lock className="w-6 h-6 text-indigo-400" /> Secret Management
      </h2>

      {/* One vault for every key an app needs — the Cashfree-specific panel was removed (admin 2026-07-18):
          a Cashfree key is just a name/value secret (CASHFREE_WEBHOOK_SECRET, CASHFREE_CLIENT_ID, …), so it
          is added here like any other. Saved keys are injected into the app you build at build time. */}
      <p className="text-xs text-gray-400 leading-relaxed bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
        Store any API key or secret your built app needs (e.g. <span className="font-mono text-indigo-300">OPENAI_API_KEY</span>,
        <span className="font-mono text-indigo-300"> DATABASE_URL</span>, a payment or provider key). Keys are encrypted, scoped to your
        account, and <strong className="text-indigo-200">injected into your app automatically at build time</strong> — never shown to the AI,
        never pasted in chat, never committed to git. Use the exact variable name your app reads.
      </p>

      <div className="bg-gray-800 p-4 rounded-lg space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Secret Name (e.g. OPENAI_API_KEY)"
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
            <button onClick={() => handleDeleteSecret(s.id)} className="text-red-400 hover:text-red-300">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

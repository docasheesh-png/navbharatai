import React, { useState } from 'react';
import { Globe, ExternalLink, ChevronLeft, CheckCircle2, Info } from 'lucide-react';

/**
 * ConnectDomainPanel — UI for connecting a user's own custom domain (e.g. one
 * bought from Hostinger/GoDaddy) to their NavBharatAI-built site.
 *
 * NOTE: This is the UI layer. The real provisioning backend (Cloudflare for SaaS:
 * create custom hostname → return exact DNS records → verify → auto-SSL) is wired
 * separately. Until that is live, this screen honestly shows a "setup in progress"
 * state for the records step — it never claims a domain is connected when it isn't.
 */

interface RegistrarOption {
  id: string;
  label: string;
  /** Deep link to the registrar's DNS / domain management area (opens in a new tab). */
  dnsUrl?: string;
}

const REGISTRARS: RegistrarOption[] = [
  { id: 'hostinger', label: 'Hostinger', dnsUrl: 'https://hpanel.hostinger.com/domain' },
  { id: 'godaddy', label: 'GoDaddy', dnsUrl: 'https://dcc.godaddy.com/manage/dns' },
  { id: 'cloudflare', label: 'Cloudflare', dnsUrl: 'https://dash.cloudflare.com' },
  { id: 'namecheap', label: 'Namecheap', dnsUrl: 'https://ap.www.namecheap.com/domains/list/' },
  { id: 'bigrock', label: 'BigRock', dnsUrl: 'https://manage.bigrock.com/' },
  { id: 'google', label: 'Google / Squarespace', dnsUrl: 'https://account.squarespace.com/domains' },
  { id: 'other', label: 'Other / Not sure' },
];

interface ConnectDomainPanelProps {
  onBack?: () => void;
}

export const ConnectDomainPanel: React.FC<ConnectDomainPanelProps> = ({ onBack }) => {
  const [domain, setDomain] = useState('');
  const [registrar, setRegistrar] = useState('');

  const cleanDomain = domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const selected = REGISTRARS.find(r => r.id === registrar);
  const domainValid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(cleanDomain);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#0d1117] text-white">
      <div className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#8b949e] hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">Connect my website</h2>
            <p className="text-[11px] text-[#8b949e]">Point your own domain to your NavBharatAI site.</p>
          </div>
        </div>

        {/* Honest status — provisioning backend not yet live */}
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            One-time setup is being finalized. You can prepare your domain below now — your exact
            DNS records and the live "Connect" step will appear here very soon.
          </p>
        </div>

        {/* Step 1 — domain */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 1 — Your domain</label>
          <input
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="e.g. myshop.com"
            className="w-full bg-[#161b22] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-500/50"
          />
          {domain && !domainValid && (
            <p className="text-[10px] text-red-400">Enter a valid domain like myshop.com (no https://, no slashes).</p>
          )}
        </div>

        {/* Step 2 — registrar */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 2 — Where did you buy it / where is its DNS?</label>
          <select
            value={registrar}
            onChange={e => setRegistrar(e.target.value)}
            className="w-full bg-[#161b22] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-500/50 appearance-none"
          >
            <option value="">Select your provider…</option>
            {REGISTRARS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {/* Step 3 — open DNS page + records (records pending real provisioning) */}
        {selected && (
          <div className="space-y-3">
            <label className="text-[10px] font-black text-[#8b949e] uppercase tracking-widest">Step 3 — Add the DNS records</label>

            {selected.dnsUrl ? (
              <button
                onClick={() => window.open(selected.dnsUrl, '_blank', 'noopener,noreferrer')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Open {selected.label} DNS settings
              </button>
            ) : (
              <p className="text-[11px] text-[#8b949e]">Open your domain provider's dashboard and find its DNS / Nameservers settings.</p>
            )}

            <div className="px-4 py-4 rounded-xl bg-[#161b22] border border-white/10 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-[#8b949e]">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#586069]" />
                Your exact records (a CNAME + a verification TXT) will be generated here once the
                connection step goes live — then just paste them at {selected.label} and your site
                goes live on <span className="text-indigo-300 font-mono">{domainValid ? cleanDomain : 'your domain'}</span> with auto-SSL.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

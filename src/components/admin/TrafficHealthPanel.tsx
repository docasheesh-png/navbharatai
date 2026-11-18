// Live provider health on the existing AI Engines page. Admin-only: real provider names stay here.

import React from 'react';
import { Activity } from 'lucide-react';

export interface TrafficHealthPayload {
  rows?: Array<{
    provider: string;
    label?: string;
    state: 'up' | 'down' | 'suspended';
    reason: string | null;
    inFlight: number;
    samples: number;
    errorRate?: Partial<Record<string, number>>;
    totalP50: number | null;
    totalP95: number | null;
    firstByteP50: number | null;
    firstByteP95: number | null;
    model: string | null;
    configured?: boolean;
    price?: { inputPerMTok: number; outputPerMTok: number } | null;
    capabilities?: { chat: boolean; build: boolean; vision: boolean; imageGen: boolean; longContext: null; hindiProbe: null };
  }>;
  alerts?: Array<{ provider: string; issue: string; detail: string }>;
  vision?: string[];
  imageGen?: string[];
}

function ms(n: number | null | undefined): string {
  return typeof n === 'number' ? `${Math.round(n)}ms` : '—';
}

function kinds(rate: Partial<Record<string, number>> | undefined): string {
  const parts = Object.entries(rate ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([k, n]) => `${k} ${n}`);
  return parts.length ? parts.join(' · ') : '—';
}

function caps(row: NonNullable<TrafficHealthPayload['rows']>[number]): string {
  const c = row.capabilities;
  if (!c) return '—';
  return [
    c.chat ? 'chat' : '',
    c.build ? 'build' : '',
    c.vision ? 'vision' : '',
    c.imageGen ? 'image' : '',
  ].filter(Boolean).join(', ') || '—';
}

export function TrafficHealthPanel({ traffic }: { traffic: TrafficHealthPayload | null | undefined }): React.ReactElement {
  const rows = traffic?.rows ?? [];
  const alerts = traffic?.alerts ?? [];
  return (
    <div className="bg-card border border-line rounded-[1.5rem] p-6 space-y-4" data-testid="traffic-health">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent-text" />
        <div>
          <h3 className="text-sm font-black text-ink uppercase tracking-tight">Live provider health</h3>
          <p className="text-[9px] text-muted font-bold uppercase tracking-widest mt-0.5">
            Recent calls on this server. Chat, builder and vision health can skip an unavailable account until a recovery call.
          </p>
        </div>
      </div>

      <div className="space-y-2" data-testid="traffic-alerts">
        <h4 className="text-[11px] font-black uppercase tracking-widest text-ink">Needs recharge / key issue</h4>
        {alerts.length === 0 ? (
          <p className="text-[11px] text-success font-bold">No recharge or key alert from recent calls.</p>
        ) : alerts.map((alert) => (
          <div key={`${alert.provider}-${alert.issue}`} className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5">
            <p className="text-[11px] font-black uppercase font-mono text-danger">{alert.provider} — {alert.issue}</p>
            <p className="text-[10px] text-muted mt-1">{alert.detail}</p>
          </div>
        ))}
      </div>

      {!traffic ? (
        <p className="text-[10px] text-muted uppercase font-bold">Live health could not be read.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-muted font-black uppercase tracking-widest text-[9px]">
                <th className="py-2 px-2 text-left">Provider</th>
                <th className="py-2 px-2 text-left">State</th>
                <th className="py-2 px-2 text-left">In flight</th>
                <th className="py-2 px-2 text-left">First byte p50/p95</th>
                <th className="py-2 px-2 text-left">Total p50/p95</th>
                <th className="py-2 px-2 text-left">Errors</th>
                <th className="py-2 px-2 text-left">Price / MTok</th>
                <th className="py-2 px-2 text-left">Can</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.filter((row) => row.samples > 0 || row.state !== 'up' || row.configured).slice(0, 40).map((row) => (
                <tr key={row.provider}>
                  <td className="py-2 px-2 font-mono font-black text-ink">{row.label || row.provider}<span className="block font-normal text-muted">{row.model || '—'}</span></td>
                  <td className={`py-2 px-2 font-black uppercase ${row.state === 'up' ? 'text-success' : 'text-danger'}`}>{row.samples ? row.state : 'not measured'}</td>
                  <td className="py-2 px-2 font-mono text-ink">{row.inFlight}</td>
                  <td className="py-2 px-2 font-mono text-muted">{ms(row.firstByteP50)} / {ms(row.firstByteP95)}</td>
                  <td className="py-2 px-2 font-mono text-muted">{ms(row.totalP50)} / {ms(row.totalP95)}</td>
                  <td className="py-2 px-2 font-mono text-muted">{kinds(row.errorRate)}</td>
                  <td className="py-2 px-2 font-mono text-muted">{row.price ? `${row.price.inputPerMTok} / ${row.price.outputPerMTok}` : '—'}</td>
                  <td className="py-2 px-2 text-muted">{caps(row)}{row.capabilities ? ' · Hindi probe not measured' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[9px] text-faint font-bold uppercase tracking-widest">
        Vision: {(traffic?.vision ?? []).join(', ') || '—'}. App image integrations (catalog only): {(traffic?.imageGen ?? []).join(', ') || '—'}.
        Hindi-probe score and long-context score are not measured yet.
      </p>
    </div>
  );
}

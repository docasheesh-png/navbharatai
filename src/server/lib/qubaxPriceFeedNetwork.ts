import dns from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector } from 'undici';
import { isBlockedIpv4 } from './ssrfGuard';

/** Feed-local stricter boundary; no changes to shared routing/Builder networking. */
export function qubaxPriceFeedPublicIp(address: string): boolean {
  if (net.isIPv4(address)) {
    if (isBlockedIpv4(address)) return false;
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 192 && (b === 0 && c === 2 || b === 88 && c === 99)
      || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  if (!net.isIPv6(address) || address.includes('.') || address.includes('%')) return false;
  // Only 2000::/3 global unicast. Reject mapped/translated/compatible IPv4, ULA,
  // link-local, multicast and unspecified addresses, including hexadecimal forms.
  const [head, next = '0'] = address.toLowerCase().split(':');
  if (!/^[23][0-9a-f]{3}$/.test(head)) return false;
  const first = parseInt(head, 16), second = parseInt(next || '0', 16);
  // IETF special-purpose 2001::/23, documentation, deprecated 6to4, documentation v2.
  return !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)
    || first === 0x2002 || first === 0x3fff && second <= 0xfff);
}
type Address = { address: string; family: number };
type Callback = (error: NodeJS.ErrnoException | null, address?: string | Address[], family?: number) => void;
type Lookup = (hostname: string, options: Record<string, unknown>, callback: Callback) => void;
const denied = () => Object.assign(new Error('QUBAX_PRICE_FEED_ADDRESS_BLOCKED'), { code: 'ESSRFBLOCKED' });
export const QUBAX_PRICE_FEED_DNS_MS = 8_000;
export function qubaxPriceFeedLookup(resolve: Lookup = dns.lookup as unknown as Lookup): Lookup {
  // Native resolver work can outlive an aborted fetch. Retain one slot per host
  // until its actual callback, not merely until this prompt timeout fires.
  const pending = new Map<string, symbol>();
  return (hostname, options, callback) => {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (pending.has(host)) return callback(Object.assign(new Error('QUBAX_PRICE_FEED_DNS_PENDING'), { code: 'EAGAIN' }));
    const token = Symbol(host); pending.set(host, token);
    let delivered = false;
    const deliver: Callback = (...args) => { if (!delivered) { delivered = true; callback(...args); } };
    const timer = setTimeout(() => deliver(Object.assign(new Error('QUBAX_PRICE_FEED_DNS_TIMEOUT'), { code: 'ETIMEDOUT' })), QUBAX_PRICE_FEED_DNS_MS);
    timer.unref();
    const settled: Callback = (error, addresses) => {
      clearTimeout(timer);
      if (pending.get(host) === token) pending.delete(host);
      if (delivered) return;
      if (error) return deliver(error);
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !qubaxPriceFeedPublicIp(a.address))) return deliver(denied());
      if (options.all) return deliver(null, addresses);
      return deliver(null, addresses[0].address, addresses[0].family);
    };
    try { resolve(hostname, { ...options, all: true }, settled); }
    catch { settled(Object.assign(new Error('QUBAX_PRICE_FEED_DNS_UNAVAILABLE'), { code: 'ENOTFOUND' })); }
  };
}
const connect = buildConnector({ lookup: qubaxPriceFeedLookup() } as Parameters<typeof buildConnector>[0]);
export const qubaxPriceFeedDispatcher = new Agent({ connect: (options, callback) => {
  const host = String(options.hostname || '').replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !qubaxPriceFeedPublicIp(host)) return callback(denied(), null);
  return connect(options, callback);
} });
export function qubaxPriceFeedRequest(init: RequestInit): RequestInit {
  return { ...init, dispatcher: qubaxPriceFeedDispatcher } as RequestInit;
}

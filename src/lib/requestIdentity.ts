/** A secure optional request identity. Older WebViews without randomUUID can use getRandomValues. */
export function newRequestIdentity(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string | undefined {
  try {
    if (typeof source?.randomUUID === 'function') return source.randomUUID();
    if (typeof source?.getRandomValues !== 'function') return undefined; // retain legacy API behavior
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch { return undefined; }
}

/** Keep a logical submission's identity until its terminal outcome is actually acknowledged. */
export function createPendingRequestIdentities(mint: () => string | undefined = newRequestIdentity) {
  const pending = new Map<string, string>();
  return {
    begin(key: string, explicit?: string): string | undefined {
      const id = explicit ?? pending.get(key) ?? mint();
      if (id) pending.set(key, id);
      return id;
    },
    acknowledge(key: string, id: string | undefined): void {
      if (id && pending.get(key) === id) pending.delete(key);
    },
  };
}

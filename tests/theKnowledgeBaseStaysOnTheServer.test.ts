/**
 * Q-158: `AppKnowledgeBase.ts` — every feature, path and capability NavBharatAI has, ~hundreds of KB of text —
 * was shipped whole in the client bundle through one client import (Offline AI). That import was removed with
 * Offline AI on 2026-09-14, so the bundle no longer carries it; nothing stopped a new client import from
 * putting it back. This census does. The AIs read it on the server, which is where it belongs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('census: the knowledge base is never imported by client code', () => {
  it('no file outside src/server imports AppKnowledgeBase', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { if (!(d === 'src' && n === 'server')) walk(f); continue; }
        if (!/\.(?:[cm]?[jt]sx?)$/.test(n) || /\.test\./.test(n)) continue;
        if (/from\s*['"][^'"]*AppKnowledgeBase['"]|import\(\s*['"][^'"]*AppKnowledgeBase['"]\s*\)/.test(readFileSync(f, 'utf8'))) offenders.push(f);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});

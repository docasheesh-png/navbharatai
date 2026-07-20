import { describe, it, expect } from 'vitest';
import { generateAuditLogIntegration } from './AuditLogGenerator';

describe('generateAuditLogIntegration', () => {
  const c = generateAuditLogIntegration();
  const server = c.files['server/lib/audit.ts'];

  it('emits a dependency-free, keyless, hash-chained server lib', () => {
    expect(server).toContain("import crypto from 'node:crypto'");
    expect(server).toContain('export async function appendAudit(');
    expect(server).toContain('export function verifyAuditChain(');
    expect(server).not.toContain("from 'axios'");
    expect(server).not.toContain('process.env');
    expect(c.files['.env.example']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('builds a real SHA-256 chain: each entry hashes its content plus the previous hash', () => {
    expect(server).toContain("crypto.createHash('sha256')");
    expect(server).toContain('prevHash: prev ? prev.hash');
    expect(server).toContain('hash: hashEntry(base)');
  });

  it('is storage-agnostic (caller supplies last()/save()) and validates actor + action', () => {
    expect(server).toContain('export interface AuditStore');
    expect(server).toContain('actor is required');
    expect(server).toContain('action is required');
  });

  it('ships a runnable test alongside the lib and writes only the two server files', () => {
    expect(c.files['server/lib/audit.test.ts']).toBeTruthy();
    expect(Object.keys(c.files).sort()).toEqual(['server/lib/audit.test.ts', 'server/lib/audit.ts']);
    expect(c.instructions.toLowerCase()).toContain('tamper');
  });
});

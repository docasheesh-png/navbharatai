import { describe, it, expect } from 'vitest';
import { generateQrIntegration } from './QrGenerator';

describe('generateQrIntegration', () => {
  const c = generateQrIntegration();
  const server = c.files['server/lib/qr.ts'];

  it('emits a server generateQr (PNG data-URL) + generateQrSvg helper', () => {
    expect(server).toContain("import QRCode from 'qrcode'");
    expect(server).toContain('export async function generateQr(text: string');
    expect(server).toContain('QRCode.toDataURL(text');
    expect(server).toContain('export async function generateQrSvg(text: string');
    expect(server).toContain("type: 'svg'");
    expect(c.files['src/lib/qr.ts']).toBeUndefined(); // server-side, no client file
  });

  it('declares the qrcode dependency, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'qrcode', version: '^1.5.3' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/qr.ts']);
    expect(c.instructions).toContain('qrcode');
  });

  it('calls out the real use cases (UPI/tickets) so the builder wires it in the right place', () => {
    expect(c.instructions.toLowerCase()).toContain('upi');
    expect(c.instructions.toLowerCase()).toContain('ticket');
  });
});

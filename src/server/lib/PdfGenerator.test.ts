import { describe, it, expect } from 'vitest';
import { generatePdfIntegration } from './PdfGenerator';

describe('generatePdfIntegration', () => {
  const c = generatePdfIntegration();
  const server = c.files['server/lib/pdf.ts'];

  it('emits a createPdf (Buffer) + createInvoicePdf helper built on pdfkit', () => {
    expect(server).toContain("import PDFDocument from 'pdfkit'");
    expect(server).toContain('export function createPdf(');
    expect(server).toContain('export async function createInvoicePdf(');
    expect(server).toContain('Buffer.concat(chunks)');
    expect(c.files['src/lib/pdf.ts']).toBeUndefined(); // server-side
  });

  it('never leaves the PDF stream half-open (resolves on end, rejects on error/throw)', () => {
    expect(server).toContain("doc.on('end'");
    expect(server).toContain("doc.on('error', reject)");
    expect(server).toContain('catch (e)');
    expect(server).toContain('reject(e)');
  });

  it('the invoice helper sums line items into a total', () => {
    expect(server).toContain('reduce((sum, i) => sum + i.qty * i.price, 0)');
    expect(server).toContain("text('Total: '");
  });

  it('declares pdfkit, no env keys, no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'pdfkit', version: '^0.15.0' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/pdf.ts']);
    expect(c.instructions.toLowerCase()).toContain('invoice');
  });
});

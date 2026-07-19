// U-4 (verified recipe modules) — PDF generator (pdfkit).
//
// Generating PDFs is a core need for real business apps — GST/tax invoices, receipts, order confirmations,
// event tickets, reports, certificates. This recipe adds a real SERVER helper that builds a PDF in memory
// and returns a Buffer (stream it as the HTTP response, save it, or email/attach it), plus a ready-made
// invoice builder. Built on `pdfkit` (the standard). PURE builder; the generated code is correct and
// complete — no TODO stubs (the real-features rule). Introduces no env keys. Unit-tested.

export interface PdfConfig {
  files: Record<string, string>;
  /** pdfkit is the one dependency (the standard PDF generator). */
  dependency: { name: string; version: string };
  instructions: string;
}

const PDF_SERVER = `import PDFDocument from 'pdfkit';

// Build a PDF in memory and resolve it as a Buffer — stream it as the HTTP response
// (res.type('application/pdf').send(buf)), save it, or attach it to an email. Never leaves a stream half-
// open: it collects chunks and resolves on 'end', rejects on 'error' or a thrown builder.
export function createPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export interface InvoiceItem {
  name: string;
  qty: number;
  price: number;
}

// A ready-made invoice PDF (header, from/to, line items, total). Extend the layout for your fields
// (GST number, HSN codes, tax breakup, logo). Currency defaults to the rupee.
export async function createInvoicePdf(inv: {
  number: string;
  date: string;
  from: string;
  to: string;
  items: InvoiceItem[];
  currency?: string;
}): Promise<Buffer> {
  const cur = inv.currency ?? '\\u20B9'; // ₹
  const total = inv.items.reduce((sum, i) => sum + i.qty * i.price, 0);
  return createPdf((doc) => {
    doc.fontSize(22).text('Invoice', { align: 'right' });
    doc.fontSize(10).text('No: ' + inv.number, { align: 'right' }).text('Date: ' + inv.date, { align: 'right' });
    doc.moveDown().fontSize(12).text('From: ' + inv.from).text('To: ' + inv.to).moveDown();
    doc.fontSize(11);
    inv.items.forEach((i) => {
      doc.text(i.name + '  x' + i.qty + '   ' + cur + i.price + '   = ' + cur + i.qty * i.price);
    });
    doc.moveDown().fontSize(14).text('Total: ' + cur + total, { align: 'right' });
  });
}
`;

const INSTRUCTIONS =
  'PDF generation wired at server/lib/pdf.ts (add the dependency pdfkit). Import createInvoicePdf(...) for a ' +
  'ready invoice, or createPdf((doc) => { ... }) to lay out any PDF with the pdfkit doc API. It resolves a ' +
  "Buffer — stream it (res.type('application/pdf').send(buf)), save it, or attach it to an email. Great for " +
  'GST/tax invoices, receipts, order confirmations, tickets and reports. No API key needed.';

export function generatePdfIntegration(): PdfConfig {
  return {
    files: { 'server/lib/pdf.ts': PDF_SERVER },
    dependency: { name: 'pdfkit', version: '^0.15.0' },
    instructions: INSTRUCTIONS,
  };
}

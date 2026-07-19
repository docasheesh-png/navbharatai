// U-4 (verified recipe modules) — QR-code generator (qrcode).
//
// QR codes are everywhere in real apps: event/movie tickets, UPI & payment links, table ordering, "scan to
// open", share/download links, 2FA enrolment. This recipe adds a real SERVER helper that turns any string
// (a URL, a UPI intent, a ticket id) into a PNG data-URL you can drop straight into an <img> or a PDF.
// Built on `qrcode` (the standard). PURE builder; the generated code is correct and complete — no TODO
// stubs (the real-features rule). Introduces no env keys. Unit-tested.

export interface QrConfig {
  files: Record<string, string>;
  /** qrcode is the one dependency (the standard QR generator). */
  dependency: { name: string; version: string };
  instructions: string;
}

const QR_SERVER = `import QRCode from 'qrcode';

// Generate a QR code for any text (a URL, a UPI payment intent like "upi://pay?pa=...&am=100", a ticket id).
// Returns a PNG data-URL ("data:image/png;base64,...") you can use directly as an <img src> or embed in a
// PDF. Server-side so you can generate on demand (e.g. per order/ticket) without a client library.
export async function generateQr(text: string, opts?: { size?: number; margin?: number }): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    width: opts?.size ?? 256,
    margin: opts?.margin ?? 2,
  });
}

// Generate the QR as a raw SVG string (crisp at any size, tiny — good for print/PDF and email).
export async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
}
`;

const INSTRUCTIONS =
  'QR code generation wired at server/lib/qr.ts (add the dependency qrcode). Import generateQr(text) for a ' +
  'PNG data-URL (drop it into an <img src> or a PDF) or generateQrSvg(text) for a crisp SVG. Great for event ' +
  'tickets, UPI/payment links, "scan to open" and share links — e.g. ' +
  '`const png = await generateQr("upi://pay?pa=merchant@bank&am=100");`. No API key needed.';

export function generateQrIntegration(): QrConfig {
  return {
    files: { 'server/lib/qr.ts': QR_SERVER },
    dependency: { name: 'qrcode', version: '^1.5.3' },
    instructions: INSTRUCTIONS,
  };
}

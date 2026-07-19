// U-4 (verified recipe modules) — Indian identity/format validators (dependency-free).
//
// Almost every Indian app collects at least one government/bank identifier — PAN at signup, GSTIN for a
// B2B invoice, Aadhaar for KYC, IFSC + account for a payout, a 6-digit PIN code, a UPI VPA, a mobile number.
// Validating these with a bare length/regex check is the common mistake: it passes a typo'd Aadhaar or a
// fat-fingered GSTIN that then fails deep in a payout or a tax filing. The correct check verifies the
// CHECKSUM the government actually encodes — the GSTIN mod-36 check digit and the Aadhaar Verhoeff digit —
// so a single mistyped character is caught at the form, not at the bank. This recipe ships those real
// validators plus the exact format checks for PAN / IFSC / PIN code / UPI / mobile. Dependency-free, no env
// keys. PURE builder; correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface IndianValidatorsConfig {
  files: Record<string, string>;
  instructions: string;
}

const VALIDATORS_SERVER = `// Indian identity/format validators. All are pure and input-tolerant (trim + uppercase where the format is
// case-insensitive); each returns a boolean. The GSTIN and Aadhaar checks verify the real government
// CHECKSUM, so a single mistyped character is rejected — not just a wrong length.

const clean = (s: unknown): string => String(s ?? '').trim();

// PAN — 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). The 4th letter encodes holder type, the 5th the
// surname initial; we validate the structural format (the authoritative check is a government API).
export function isValidPAN(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(clean(pan).toUpperCase());
}

// GSTIN — 15 chars: 2-digit state code + 10-char PAN + 1 entity char + 'Z' + 1 checksum char. Verifies the
// real GSTIN mod-36 checksum (0-9,A-Z as 0-35; alternating weight 1,2; digit-sum in base 36).
export function isValidGSTIN(gstin: string): boolean {
  const g = clean(gstin).toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = chars.indexOf(g[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = code * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const checkDigit = (36 - (sum % 36)) % 36;
  return chars[checkDigit] === g[14];
}

// Verhoeff checksum tables (dihedral group D5) — used by Aadhaar. Pure lookup, no dependency.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Aadhaar — 12 digits (first is 2-9) whose LAST digit is a valid Verhoeff checksum of the first 11. Catches a
// single mistyped digit. (This proves the number is well-FORMED; only UIDAI can confirm it is real.)
export function isValidAadhaar(aadhaar: string): boolean {
  const a = clean(aadhaar).replace(/\\s/g, '');
  if (!/^[2-9][0-9]{11}$/.test(a)) return false;
  let c = 0;
  const reversed = a.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

// IFSC — 4 bank letters + '0' (reserved) + 6 alphanumeric (branch). e.g. SBIN0005943.
export function isValidIFSC(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean(ifsc).toUpperCase());
}

// Indian PIN code — 6 digits, first digit 1-9 (0 is not a valid leading postal-region digit).
export function isValidPincode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(clean(pin));
}

// UPI VPA — handle@psp (e.g. name@okhdfcbank). Structural check; the PSP confirms it resolves.
export function isValidUPI(vpa: string): boolean {
  return /^[a-zA-Z0-9.\\-_]{2,256}@[a-zA-Z]{2,64}$/.test(clean(vpa));
}

// Indian mobile — 10 digits starting 6-9, tolerating a leading +91 / 0.
export function isValidIndianMobile(num: string): boolean {
  return /^[6-9][0-9]{9}$/.test(clean(num).replace(/^(?:\\+91|91|0)/, ''));
}
`;

const INSTRUCTIONS =
  'Indian validators wired at server/lib/indianValidators.ts (no dependency). Import isValidPAN, isValidGSTIN, ' +
  'isValidAadhaar, isValidIFSC, isValidPincode, isValidUPI, isValidIndianMobile and validate the field at the ' +
  'form/API BEFORE you store or act on it. GSTIN and Aadhaar verify the REAL government checksum (GSTIN mod-36, ' +
  'Aadhaar Verhoeff), so a single mistyped character is caught up front instead of failing later in a payout or ' +
  'a tax filing — a bare regex would let it through. These prove a value is well-FORMED; the authoritative ' +
  'check is still the government/bank API. No API key needed.';

export function generateIndianValidatorsIntegration(): IndianValidatorsConfig {
  return {
    files: { 'server/lib/indianValidators.ts': VALIDATORS_SERVER },
    instructions: INSTRUCTIONS,
  };
}

// Brand files written INTO the user's app.
//
// Pure. No wallet, no badge. The "Made with NavBharatAI" badge is injected at publish and is not
// something these files can remove. A hosting plan removes it. This only writes colours and a name.

export const BRAND_FONTS = [
  'Inter', 'Roboto', 'Poppins', 'Nunito', 'Raleway', 'Ubuntu', 'Noto Sans', 'Playfair Display', 'Fira Code',
] as const;

export interface BrandKitInput {
  appName?: unknown;
  tagline?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
  bgColor?: unknown;
  textColor?: unknown;
  fontFamily?: unknown;
  borderRadius?: unknown;
  footerText?: unknown;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max);
}

function hex(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

export function brandKitFiles(input: BrandKitInput): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  const appName = text(input.appName, 60);
  if (!appName) return { ok: false, error: 'Add an app name. Nothing was written.' };
  const primary = hex(input.primaryColor);
  const secondary = hex(input.secondaryColor);
  const accent = hex(input.accentColor);
  const bg = hex(input.bgColor);
  const fg = hex(input.textColor);
  if (!primary || !secondary || !accent || !bg || !fg) {
    return { ok: false, error: 'Colours must look like #112233. Nothing was written.' };
  }
  const requestedFont = typeof input.fontFamily === 'string' ? input.fontFamily : '';
  const font = (BRAND_FONTS as readonly string[]).includes(requestedFont) ? requestedFont : 'Inter';
  const radiusRaw = typeof input.borderRadius === 'string' || typeof input.borderRadius === 'number'
    ? Number(input.borderRadius)
    : 12;
  const radius = Number.isFinite(radiusRaw) ? Math.max(0, Math.min(999, Math.round(radiusRaw))) : 12;
  const tagline = text(input.tagline, 140);
  const footer = text(input.footerText, 200);
  const brand = {
    appName,
    tagline,
    footer,
    primary,
    secondary,
    accent,
    bg,
    text: fg,
    font,
    radius,
  };
  const css = `/* Brand colours for this app.
 * This file does not remove the Made with NavBharatAI badge. A hosting plan does that.
 */
:root {
  --brand-primary: ${primary};
  --brand-secondary: ${secondary};
  --brand-accent: ${accent};
  --brand-bg: ${bg};
  --brand-text: ${fg};
  --brand-font: '${font}', sans-serif;
  --brand-radius: ${radius}px;
}
`;
  const ts = `/* Brand values for this app.
 * This file does not remove the Made with NavBharatAI badge. A hosting plan does that.
 */
export const brand = ${JSON.stringify(brand, null, 2)} as const;
`;
  const files = { 'src/brand.css': css, 'src/brand.ts': ts };
  const packed = JSON.stringify(files);
  if (/<script/i.test(packed) || /<\/style/i.test(packed) || packed.includes('data-nbai-badge') || /url\s*\(/i.test(packed)) {
    return { ok: false, error: 'That brand could not be written safely. Nothing was written.' };
  }
  return { ok: true, files };
}

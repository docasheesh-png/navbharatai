// The one WhatsApp button. The Hindi label lives in src/lib/whatsappShare.ts
// (owner-requested share copy). This file keeps an English name beside it so
// the control is readable without Devanagari. No new dependency — it is a link.

import { WHATSAPP_SHARE_LABEL, WHATSAPP_SHARE_LABEL_EN, whatsappShareHref, type WhatsAppShareInput } from '../../lib/whatsappShare';

const BLOCK = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-on-accent hover:bg-emerald-500 touch-manipulation';
const BAR = 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-700/60 bg-emerald-500/10 text-success hover:text-ink hover:border-emerald-500 transition-colors touch-manipulation whitespace-nowrap';

export function WhatsAppShareLink({
  appUrl,
  appName,
  apkUrl,
  variant = 'block',
  className,
}: WhatsAppShareInput & { variant?: 'block' | 'bar'; className?: string }) {
  const href = whatsappShareHref({ appUrl, appName, apkUrl });
  if (!href) return null;
  const bar = variant === 'bar';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={WHATSAPP_SHARE_LABEL_EN}
      title={WHATSAPP_SHARE_LABEL_EN}
      className={className ?? (bar ? BAR : BLOCK)}
    >
      {bar ? (
        <span>{WHATSAPP_SHARE_LABEL}</span>
      ) : (
        <span className="flex flex-col items-center leading-tight text-center">
          <span>{WHATSAPP_SHARE_LABEL}</span>
          <span className="text-[10px] font-semibold opacity-90">{WHATSAPP_SHARE_LABEL_EN}</span>
        </span>
      )}
    </a>
  );
}

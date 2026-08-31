// P-UX.1 — Privacy / analytics consent banner (GDPR + India DPDP).
//
// Shown once, on first visit, until the user makes a choice. "Accept" enables non-essential
// analytics (product events + Core Web Vitals) AND the Meta advertising pixel; "Decline" keeps them
// all off. The choice is stored in localStorage and respected by trackEvent(), the web-vitals
// observers and initMetaPixel() (see src/lib/consent.ts and src/lib/metaPixel.ts).
//
// THE COPY NAMES META ON PURPOSE. Loading a third-party advertising pixel is materially different
// from first-party product analytics, and a banner that said only "privacy-friendly analytics"
// while an ad network's script loaded would be consent obtained on a false description. The white-
// label law forbids naming the AI PROVIDERS behind a build — it does not licence hiding who
// receives a user's data, which is a disclosure obligation under GDPR and India's DPDP Act.
// Operational crash/error logging is essential and runs regardless — this banner only governs
// non-essential telemetry. Self-contained inline styles (matching main.tsx's RootFallback) so it
// renders correctly in any theme without depending on global CSS.

import { useEffect, useState } from 'react';
import { needsConsentDecision, setConsent } from '../lib/consent';

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  // Decide visibility after mount (localStorage is client-only). Never throws.
  useEffect(() => {
    try {
      setVisible(needsConsentDecision());
    } catch {
      setVisible(false);
    }
  }, []);

  if (!visible) return null;

  const choose = (value: 'granted' | 'denied') => {
    setConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Privacy and analytics consent"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 2147483600,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 560,
          width: '100%',
          background: 'var(--surface-card)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          padding: '16px 18px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ color: 'var(--text-body)', fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
            We respect your privacy
          </strong>
          We use analytics and performance measurement to improve NavBharatAI, and — only if you
          accept — advertising measurement from Meta, so we can tell which ads genuinely help people
          find us. These are optional. Essential features and crash reporting work either way. You
          can change your choice anytime by clearing the site data.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => choose('denied')}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 700,
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose('granted')}
            style={{
              padding: '8px 18px',
              background: '#4f46e5',
              color: '#fff',
              fontSize: 12,
              fontWeight: 800,
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;

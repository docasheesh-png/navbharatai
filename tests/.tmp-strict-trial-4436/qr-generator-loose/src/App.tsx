import { useState } from 'react';
import ThemeToggle from './theme';

const SIZES = [200, 300, 500];

function App() {
  const [text, setText] = useState('https://example.com');
  const [size, setSize] = useState(300);
  const [busy, setBusy] = useState(false);

  const trimmed = text.trim();
  const qrUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
    '&data=' + encodeURIComponent(trimmed);

  const download = async () => {
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(qrUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qr-code.png';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(qrUrl, '_blank');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>QR Code Maker</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="field">
          <label>Text or link</label>
          <textarea
            rows={3}
            aria-label="Text or link to encode"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type any text or paste a link - the QR updates instantly"
          />
        </div>
        <div className="row">
          <label className="muted" style={{ fontSize: 14 }}>Size</label>
          {SIZES.map((s) => (
            <button key={s} className={size === s ? 'primary' : ''} onClick={() => setSize(s)} style={{ padding: '6px 14px' }}>
              {s}px
            </button>
          ))}
        </div>
        {trimmed ? (
          <div className="stack" style={{ alignItems: 'center' }}>
            <img
              src={qrUrl}
              width={Math.min(size, 300)}
              height={Math.min(size, 300)}
              alt={'QR code for: ' + trimmed.slice(0, 60)}
              style={{ background: '#ffffff', padding: 12, borderRadius: 12, maxWidth: '100%' }}
            />
            <button className="primary" onClick={download} disabled={busy}>
              {busy ? 'Preparing...' : 'Download PNG'}
            </button>
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center', margin: '16px 0' }}>Type something above to generate its QR code.</p>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          QR images are generated via a free public API, so an internet connection is required.
        </p>
      </div>
    </div>
  );
}
export default App;

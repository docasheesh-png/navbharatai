import { useState } from 'react';
import ThemeToggle from './theme';

const REMEMBER_KEY = 'login-remembered-email';

// Storage can be switched off (a private window, a sandboxed frame), and then every read throws — in the
// first render that blanks the whole page. Remembering is a convenience, so it simply stops.
function readRemembered(): string {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; }
}
function writeRemembered(value: string | null): void {
  try {
    if (value) localStorage.setItem(REMEMBER_KEY, value);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* storage blocked — nothing is remembered */ }
}

function validEmail(v: string): boolean {
  const at = v.indexOf('@');
  const dot = v.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < v.length - 1 && !v.includes(' ');
}

function App() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(readRemembered);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(() => !!readRemembered());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [user, setUser] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const submit = () => {
    const e: Record<string, string> = {};
    if (!validEmail(email)) e.email = 'Enter a valid email address.';
    if (password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (mode === 'signup' && confirm !== password) e.confirm = 'Passwords do not match.';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    writeRemembered(remember ? email : null);
    setUser(email);
    setNotice('');
  };

  const social = (provider: string) => {
    setNotice(provider + ' sign-in is a UI demo here - connect your auth provider to enable it.');
  };

  if (user) {
    return (
      <div className="container" style={{ maxWidth: 420, paddingTop: 64 }}>
        <div className="card stack" style={{ textAlign: 'center' }}>
          <span className="badge badge-success" style={{ alignSelf: 'center' }}>Signed in</span>
          <h2 style={{ margin: 0 }}>Welcome!</h2>
          <p className="muted" style={{ margin: 0 }}>{user}</p>
          <button onClick={() => { setUser(null); setPassword(''); setConfirm(''); }}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 48, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row">
          <button className={mode === 'login' ? 'primary' : ''} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setErrors({}); }} style={{ flex: 1 }}>Log in</button>
          <button className={mode === 'signup' ? 'primary' : ''} aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setErrors({}); }} style={{ flex: 1 }}>Sign up</button>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            style={errors.email ? { borderColor: 'var(--danger)' } : undefined}
          />
          {errors.email && <small id="email-error" role="alert" style={{ color: 'var(--danger)' }}>{errors.email}</small>}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="password">Password</label>
          <div className="row">
            <input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              style={{ flex: 1, ...(errors.password ? { borderColor: 'var(--danger)' } : {}) }}
            />
            <button onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password && <small id="password-error" role="alert" style={{ color: 'var(--danger)' }}>{errors.password}</small>}
        </div>
        {mode === 'signup' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!errors.confirm}
              aria-describedby={errors.confirm ? 'confirm-error' : undefined}
              style={errors.confirm ? { borderColor: 'var(--danger)' } : undefined}
            />
            {errors.confirm && <small id="confirm-error" role="alert" style={{ color: 'var(--danger)' }}>{errors.confirm}</small>}
          </div>
        )}
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me on this device
        </label>
        <button type="submit" className="primary" onClick={submit} style={{ padding: '12px 0', fontSize: 16 }}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <small className="muted">or continue with</small>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        <div className="row">
          <button onClick={() => social('Google')} style={{ flex: 1 }}>Google</button>
          <button onClick={() => social('GitHub')} style={{ flex: 1 }}>GitHub</button>
        </div>
        {notice && <div className="alert alert-warning" style={{ fontSize: 13 }}>{notice}</div>}
      </div>
    </div>
  );
}
export default App;

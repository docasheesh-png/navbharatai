import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Copy,
  Check,
  Download,
  Eye,
  EyeOff,
  Key,
  Settings,
  Code2,
  TestTube,
  ChevronRight,
  Smartphone,
  Globe,
  CheckCircle2,
  X,
  Clock,
  RefreshCw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PWANotificationsProps {
  generatedCode?: string;
  onCodeUpdate?: (code: string) => void;
}

type Tab = 'setup' | 'code' | 'test';
type PermissionTiming = 'onload' | 'interaction' | 'custom';
type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface NotifSettings {
  appName: string;
  defaultTitle: string;
  iconEmoji: string;
  customIconUrl: string;
  badgeUrl: string;
  vapidKeys: VapidKeys | null;
  showPrivateKey: boolean;
  permissionTiming: PermissionTiming;
  customDelay: number;
  enabledTypes: Record<string, boolean>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_OPTIONS = ['🔔', '🚀', '💡', '📢', '🎉', '⚡', '🌟', '📱', '🛎️', '💬', '🔥', '✨'];

const NOTIFICATION_TYPES = [
  { key: 'welcome', label: 'Welcome notification (on first subscribe)', default: true },
  { key: 'updates', label: 'App updates', default: true },
  { key: 'content', label: 'New content alerts', default: false },
  { key: 'promo', label: 'Promotional messages', default: false },
  { key: 'reminders', label: 'Reminders', default: false },
];

const BROWSER_SUPPORT = [
  { browser: 'Chrome', push: true, notif: true, sw: true },
  { browser: 'Firefox', push: true, notif: true, sw: true },
  { browser: 'Safari (iOS 16.4+)', push: true, notif: true, sw: true },
  { browser: 'Samsung Internet', push: true, notif: true, sw: true },
];

const PWA_CHECKLIST = [
  'HTTPS enabled',
  'manifest.json linked',
  'Service Worker registered',
  'VAPID keys configured',
  'Subscribe endpoint ready',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBase64(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateSimulatedVapid(): VapidKeys {
  return {
    publicKey: `BL${randomBase64(85)}=`,
    privateKey: `${randomBase64(42)}=`,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded transition-colors ${copied ? 'text-green-400' : 'text-gray-400 hover:text-white'} ${className}`}
      title="Copy"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

interface CodeBlockProps {
  title: string;
  filename: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ title, filename, code }) => {
  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Simple syntax highlight: green for tags/keywords, yellow for values
  const highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(self\.|event\.|clients\.|navigator\.|fetch|async|await|const|function|return|new)/g, '<span style="color:#79c0ff">$1</span>')
    .replace(/('[^']*'|"[^"]*")/g, '<span style="color:#a5d6ff">$1</span>')
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#8b949e">$1</span>');

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-white/10">
        <div>
          <span className="text-xs font-semibold text-white">{title}</span>
          <span className="ml-2 text-xs text-gray-500 font-mono">{filename}</span>
        </div>
        <div className="flex gap-1">
          <CopyButton text={code} />
          <button
            onClick={handleDownload}
            className="p-1.5 rounded text-gray-400 hover:text-white transition-colors"
            title="Download"
          >
            <Download size={14} />
          </button>
        </div>
      </div>
      <pre
        className="p-4 text-xs font-mono overflow-x-auto leading-relaxed text-gray-300 bg-[#0d1117]"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const PWANotifications: React.FC<PWANotificationsProps> = ({ generatedCode, onCodeUpdate }) => {
  const [activeTab, setActiveTab] = useState<Tab>('setup');
  const [settings, setSettings] = useState<NotifSettings>({
    appName: 'My PWA App',
    defaultTitle: 'New Update',
    iconEmoji: '🔔',
    customIconUrl: '',
    badgeUrl: '/badge-icon.png',
    vapidKeys: null,
    showPrivateKey: false,
    permissionTiming: 'interaction',
    customDelay: 5,
    enabledTypes: Object.fromEntries(NOTIFICATION_TYPES.map(t => [t.key, t.default])),
  });

  const [permission, setPermission] = useState<NotifPermission>('default');
  const [testTitle, setTestTitle] = useState('Test Notification');
  const [testBody, setTestBody] = useState('This is a test notification!');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [injected, setInjected] = useState(false);

  // Sync real permission on mount and tab switch
  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported');
    } else {
      setPermission(Notification.permission as NotifPermission);
    }
  }, [activeTab]);

  const updateSetting = <K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleGenerateVapid = () => {
    updateSetting('vapidKeys', generateSimulatedVapid());
  };

  const iconUrl = settings.customIconUrl || settings.iconEmoji;

  // ── Generated code strings ──────────────────────────────────────────────────

  const swCode = `// Generated service worker with push handler
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || '${settings.appName}', {
      body: data.body || 'New update available!',
      icon: '${iconUrl}',
      badge: '${settings.badgeUrl || '/badge-icon.png'}',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});`;

  const subscribeCode = `// Subscribe to push notifications
async function subscribeToPush() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: '${settings.vapidKeys?.publicKey || '{{vapidPublicKey}}'}'
  });
  // Send sub to your server: POST /api/notifications/subscribe
  await fetch('/api/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub)
  });
}`;

  const manifestCode = `{
  "name": "${settings.appName}",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#6366f1"
}`;

  const swRegistrationSnippet = `<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>`;

  // ── Tab: Setup ──────────────────────────────────────────────────────────────

  const renderSetup = () => (
    <div className="space-y-4">
      {/* Notification Settings */}
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Settings size={15} className="text-indigo-400" /> Notification Settings
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">App Name (manifest)</label>
            <input
              className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              value={settings.appName}
              onChange={e => updateSetting('appName', e.target.value)}
              placeholder="My PWA App"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Default Notification Title</label>
            <input
              className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              value={settings.defaultTitle}
              onChange={e => updateSetting('defaultTitle', e.target.value)}
              placeholder="New Update"
            />
          </div>
        </div>

        {/* Emoji Picker */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Notification Icon</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {EMOJI_OPTIONS.map(em => (
              <button
                key={em}
                onClick={() => updateSetting('iconEmoji', em)}
                className={`w-8 h-8 rounded text-lg flex items-center justify-center transition-colors border ${
                  settings.iconEmoji === em && !settings.customIconUrl
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                {em}
              </button>
            ))}
          </div>
          <input
            className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            value={settings.customIconUrl}
            onChange={e => updateSetting('customIconUrl', e.target.value)}
            placeholder="Custom icon URL (overrides emoji)"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Badge Icon URL</label>
          <input
            className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            value={settings.badgeUrl}
            onChange={e => updateSetting('badgeUrl', e.target.value)}
            placeholder="/badge-icon.png"
          />
        </div>

        {/* VAPID Keys */}
        <div className="border-t border-white/10 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
              <Key size={13} className="text-yellow-400" /> VAPID Keys
            </span>
            <button
              onClick={handleGenerateVapid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium transition-colors"
            >
              <RefreshCw size={12} /> Generate VAPID Keys
            </button>
          </div>
          {settings.vapidKeys && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Public Key</label>
                <div className="flex items-center gap-2 bg-[#0d1117] border border-white/10 rounded px-3 py-1.5">
                  <code className="flex-1 text-xs text-green-400 font-mono truncate">{settings.vapidKeys.publicKey}</code>
                  <CopyButton text={settings.vapidKeys.publicKey} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Private Key</label>
                <div className="flex items-center gap-2 bg-[#0d1117] border border-white/10 rounded px-3 py-1.5">
                  <code className="flex-1 text-xs text-red-400 font-mono truncate">
                    {settings.showPrivateKey ? settings.vapidKeys.privateKey : '•'.repeat(42)}
                  </code>
                  <button
                    onClick={() => updateSetting('showPrivateKey', !settings.showPrivateKey)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {settings.showPrivateKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <CopyButton text={settings.vapidKeys.privateKey} />
                </div>
              </div>
              <p className="text-xs text-yellow-500/80 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                ⚠️ Store VAPID keys on the server, never expose them client-side
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Permission Timing */}
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Clock size={15} className="text-blue-400" /> Permission Request Timing
        </h3>
        {(['onload', 'interaction', 'custom'] as PermissionTiming[]).map(t => (
          <label key={t} className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="timing"
              value={t}
              checked={settings.permissionTiming === t}
              onChange={() => updateSetting('permissionTiming', t)}
              className="accent-indigo-500"
            />
            <span className="text-sm text-gray-300">
              {t === 'onload' && 'On page load'}
              {t === 'interaction' && (
                <>After user interaction <span className="text-xs text-indigo-400 ml-1">← recommended</span></>
              )}
              {t === 'custom' && 'Custom delay'}
            </span>
            {t === 'custom' && settings.permissionTiming === 'custom' && (
              <input
                type="number"
                min={1}
                value={settings.customDelay}
                onChange={e => updateSetting('customDelay', Number(e.target.value))}
                className="w-16 bg-[#0d1117] border border-white/10 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            )}
            {t === 'custom' && settings.permissionTiming === 'custom' && (
              <span className="text-xs text-gray-500">seconds</span>
            )}
          </label>
        ))}
      </div>

      {/* Notification Types */}
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Bell size={15} className="text-purple-400" /> Notification Types
        </h3>
        {NOTIFICATION_TYPES.map(t => (
          <label key={t.key} className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabledTypes[t.key] ?? false}
              onChange={e =>
                updateSetting('enabledTypes', { ...settings.enabledTypes, [t.key]: e.target.checked })
              }
              className="accent-indigo-500 w-4 h-4"
            />
            <span className="text-sm text-gray-300">{t.label}</span>
          </label>
        ))}
      </div>
    </div>
  );

  // ── Tab: Generated Code ─────────────────────────────────────────────────────

  const renderCode = () => {
    const handleInject = () => {
      if (!generatedCode || !onCodeUpdate) return;
      const updated = generatedCode.replace('</body>', `${swRegistrationSnippet}\n</body>`);
      onCodeUpdate(updated);
      setInjected(true);
      setTimeout(() => setInjected(false), 2500);
    };

    return (
      <div className="space-y-4">
        <CodeBlock title="Service Worker" filename="sw.js" code={swCode} />
        <CodeBlock title="Subscription Code" filename="subscribe.js" code={subscribeCode} />
        <CodeBlock title="manifest.json additions" filename="manifest.json" code={manifestCode} />

        {onCodeUpdate && (
          <button
            onClick={handleInject}
            disabled={!generatedCode}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm transition-colors ${
              injected
                ? 'bg-green-600 text-white'
                : generatedCode
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-white/5 text-gray-500 cursor-not-allowed'
            }`}
          >
            {injected ? (
              <><Check size={15} /> Injected into App!</>
            ) : (
              <><Code2 size={15} /> Inject into App</>
            )}
          </button>
        )}
        {!generatedCode && onCodeUpdate && (
          <p className="text-xs text-center text-gray-600">Generate an app first to inject this</p>
        )}
      </div>
    );
  };

  // ── Tab: Test & Preview ─────────────────────────────────────────────────────

  const renderTest = () => {
    const handleRequestPermission = async () => {
      if (typeof Notification === 'undefined') {
        setPermission('unsupported');
        return;
      }
      const result = await Notification.requestPermission();
      setPermission(result as NotifPermission);
    };

    const handleSendTest = () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      new Notification(testTitle, { body: testBody });
    };

    const permBadge = () => {
      if (permission === 'granted') return <span className="flex items-center gap-1 text-green-400"><CheckCircle2 size={13} /> Granted</span>;
      if (permission === 'denied') return <span className="flex items-center gap-1 text-red-400"><X size={13} /> Denied</span>;
      if (permission === 'unsupported') return <span className="text-gray-500">Not Supported</span>;
      return <span className="flex items-center gap-1 text-yellow-400"><Clock size={13} /> Default</span>;
    };

    return (
      <div className="space-y-4">
        {/* Permission Test */}
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bell size={15} className="text-indigo-400" /> Browser Permission Test
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Current Status:</span>
            <span className="text-xs font-medium">{permBadge()}</span>
          </div>
          <button
            onClick={handleRequestPermission}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium text-white transition-colors"
          >
            Request Permission
          </button>
        </div>

        {/* Send Test */}
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <TestTube size={15} className="text-purple-400" /> Test Notification
          </h3>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title</label>
            <input
              className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              value={testTitle}
              onChange={e => setTestTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Body</label>
            <input
              className="w-full bg-[#0d1117] border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              value={testBody}
              onChange={e => setTestBody(e.target.value)}
            />
          </div>
          <button
            onClick={handleSendTest}
            disabled={permission !== 'granted'}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
              permission === 'granted'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-white/5 text-gray-500 cursor-not-allowed'
            }`}
          >
            Send Test
          </button>
          {permission !== 'granted' && (
            <p className="text-xs text-center text-gray-600">Grant permission first</p>
          )}
        </div>

        {/* Browser Support */}
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Globe size={15} className="text-blue-400" /> Browser Support
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 pr-4">Browser</th>
                  <th className="text-center py-2 px-2">Push API</th>
                  <th className="text-center py-2 px-2">Notifications</th>
                  <th className="text-center py-2 px-2">Service Worker</th>
                </tr>
              </thead>
              <tbody>
                {BROWSER_SUPPORT.map(row => (
                  <tr key={row.browser} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-4 text-gray-300">{row.browser}</td>
                    <td className="py-2 px-2 text-center">{row.push ? '✅' : '❌'}</td>
                    <td className="py-2 px-2 text-center">{row.notif ? '✅' : '❌'}</td>
                    <td className="py-2 px-2 text-center">{row.sw ? '✅' : '❌'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PWA Checklist */}
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Smartphone size={15} className="text-green-400" /> To be PWA-ready:
          </h3>
          {PWA_CHECKLIST.map(item => (
            <label key={item} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checkedItems[item] ?? false}
                onChange={e => setCheckedItems(prev => ({ ...prev, [item]: e.target.checked }))}
                className="accent-green-500 w-4 h-4"
              />
              <span className={`text-sm ${checkedItems[item] ? 'line-through text-gray-500' : 'text-gray-300'}`}>
                {item}
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'setup', label: 'Setup & Config', icon: <Settings size={14} /> },
    { id: 'code', label: 'Generated Code', icon: <Code2 size={14} /> },
    { id: 'test', label: 'Test & Preview', icon: <TestTube size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <Bell size={18} className="text-indigo-400" />
        <div>
          <h2 className="text-sm font-semibold text-white">PWA Push Notifications</h2>
          <p className="text-xs text-gray-500">Generate service worker, manifest and subscription code</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 px-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && <ChevronRight size={12} className="rotate-90" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'setup' && renderSetup()}
        {activeTab === 'code' && renderCode()}
        {activeTab === 'test' && renderTest()}
      </div>
    </div>
  );
};

export default PWANotifications;

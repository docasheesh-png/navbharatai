import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mount, jsx, findAll, textOf, type HostNode } from './helpers/hookRuntime';
const h = vi.hoisted(() => ({ all: vi.fn(), current: vi.fn() }));
vi.mock('react', async () => import('./helpers/hookRuntime'));
vi.mock('react/jsx-runtime', async () => import('./helpers/hookRuntime'));
vi.mock('lucide-react', () => ({ LogOut: () => null }));
vi.mock('../src/lib/accountSessions', () => ({ logoutAllDevices: h.all, logoutCurrentDevice: h.current }));
import { LogoutControls } from '../src/components/settings/LogoutControls';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const click = (node: HostNode) => (node.props.onClick as () => void)();
beforeEach(() => { vi.clearAllMocks(); h.all.mockResolvedValue(undefined); h.current.mockResolvedValue(undefined); });
function screen(user: unknown = { uid: 'alice' }) {
  const view = mount(() => jsx(LogoutControls, { user }));
  const button = (label: string) => findAll(view.tree(), n => n.type === 'button' && textOf(n.children) === label)[0]!;
  return { ...view, button, text: () => textOf(view.tree()) };
}
describe('Settings logout controls execute the real component handlers', () => {
  it('signed-out users see no inert logout buttons', () => { const s = screen(null); expect(s.text()).toBe(''); s.unmount(); });
  it('opening global confirmation and Cancel never calls a revocation', () => {
    const s = screen(); click(s.button('Log out of all devices'));
    expect(s.text()).toContain('including this one'); expect(s.text()).toContain('Offline screens');
    expect(s.button('Cancel').props.autoFocus).toBe(true);
    expect(h.all).not.toHaveBeenCalled(); click(s.button('Cancel'));
    expect(s.text()).not.toContain('Confirm logout on all devices'); expect(h.all).not.toHaveBeenCalled(); s.unmount();
  });
  it('Escape and unmount dismiss without an action', () => {
    const s = screen(); click(s.button('Log out of all devices'));
    const section = findAll(s.tree(), n => n.type === 'section')[0]!;
    (section.props.onKeyDown as (e: unknown) => void)({ key: 'Escape' });
    expect(s.text()).not.toContain('Confirm logout on all devices');
    click(s.button('Log out of all devices')); s.unmount(); expect(h.all).not.toHaveBeenCalled();
  });
  it('current-device logout remains distinct from all-device revocation', async () => {
    const s = screen(); click(s.button('Log out of this device')); click(s.button('Confirm logout')); await flush();
    expect(h.current).toHaveBeenCalledTimes(1); expect(h.all).not.toHaveBeenCalled(); s.unmount();
  });
  it('double confirmation sends one mutation and disables Cancel while the outcome is pending', async () => {
    let finish!: () => void; h.all.mockReturnValue(new Promise<void>(r => { finish = r; }));
    const s = screen(); click(s.button('Log out of all devices')); const confirm = s.button('Confirm logout on all devices');
    click(confirm); click(confirm); expect(h.all).toHaveBeenCalledTimes(1);
    expect(s.button('Cancel').props.disabled).toBe(true); expect(s.text()).toContain('Logging out');
    finish(); await flush(); s.unmount();
  });
  it('failure is honest, never says success and requires a new explicit confirmation', async () => {
    h.all.mockRejectedValue(new Error('Could not confirm every session.'));
    const s = screen(); click(s.button('Log out of all devices')); click(s.button('Confirm logout on all devices')); await flush();
    expect(s.text()).toContain('Could not confirm every session.');
    expect(s.text()).not.toContain('Confirm logout on all devices'); expect(h.all).toHaveBeenCalledTimes(1);
    expect(findAll(s.tree(), n => n.props.role === 'alert')).toHaveLength(1); s.unmount();
  });
  it('help names the bottom-of-Settings control, not a nonexistent Settings group', () => {
    const panel = readFileSync('src/components/panels/SettingsPanel.tsx', 'utf8');
    const kb = readFileSync('src/server/AppContext/AppKnowledgeBase.ts', 'utf8');
    const entry = kb.slice(kb.indexOf("id: 'logout_devices'"), kb.indexOf("id: 'login_auth'"));
    expect(entry).toContain("path: 'Settings → scroll to the bottom → Logout → Log out of all devices'");
    expect(entry).toContain('Open Settings, scroll to the bottom, find Logout');
    expect(panel).toMatch(/<LogoutControls[^\n]+\/>\s*<DangerZone/);
    expect(panel.indexOf('<LogoutControls')).toBeGreaterThan(panel.indexOf('>Admin Login</span>'));
  });
  it('Settings resets the confirmation when user identity changes; all-device action is not a default logout side effect', () => {
    const panel = readFileSync('src/components/panels/SettingsPanel.tsx', 'utf8');
    expect(panel).toContain('<LogoutControls key={user?.uid} user={user} />');
    expect(readFileSync('src/lib/firebase.ts', 'utf8')).not.toContain('/sessions/revoke');
    expect(readFileSync('src/lib/signOutFlow.ts', 'utf8')).not.toContain('/sessions/revoke');
  });
});

import { describe, it, expect } from 'vitest';
import { navFor } from '../src/lib/offlineAssistant';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import type { SettingsScreen } from '../src/types';

/**
 * Settings → Terminal is a REAL surface (admin 2026-07-20): the 'shell' settings screen mounts the
 * same RealTerminal Code Studio uses, pointed at the shared v5.0 workspace. These tests lock the
 * cross-AI awareness wiring: the KB entry exists, describes the real behaviour (never a stub), and
 * the Offline AI can navigate straight to it.
 */

const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Settings Terminal — KB entry + Offline AI navigation', () => {
  it('settings_terminal KB entry exists and describes the REAL sandbox terminal', () => {
    const entry = kb('settings_terminal');
    expect(entry).toBeTruthy();
    // The entry must describe reality: real sandbox exec, bounded, honest-when-cold.
    expect(entry!.description).toMatch(/REAL shell|real commands/i);
    expect(entry!.description).toMatch(/30-second|30s/);
    expect(entry!.description).toMatch(/never fakes/i);
    // Path points at the settings surface users actually see.
    expect(entry!.path).toContain('Settings → App Settings → Terminal');
  });

  it('Offline AI navFor(settings_terminal) opens the shell settings screen (working button)', () => {
    const entry = kb('settings_terminal');
    const nav = navFor(entry!);
    expect(nav).toEqual({ view: 'settings', settingsScreen: 'shell' });
    // The target must be a valid SettingsScreen value — a typo here would render a blank screen.
    const screen: SettingsScreen = 'shell';
    expect(nav!.settingsScreen).toBe(screen);
  });

  it('settings_logs KB entry exists and describes the REAL logs surface', () => {
    const entry = kb('settings_logs');
    expect(entry).toBeTruthy();
    // The entry must describe reality: real build events + captured runtime errors, honest empties.
    expect(entry!.description).toMatch(/REAL live logs/i);
    expect(entry!.description).toMatch(/BUILD LOG/);
    expect(entry!.description).toMatch(/RUNTIME ERRORS/);
    expect(entry!.description).toMatch(/nothing is simulated/i);
    expect(entry!.path).toContain('Settings → App Settings → Logs');
  });

  it('Offline AI navFor(settings_logs) opens the logs settings screen (working button)', () => {
    const entry = kb('settings_logs');
    const nav = navFor(entry!);
    expect(nav).toEqual({ view: 'settings', settingsScreen: 'logs' });
    const screen: SettingsScreen = 'logs';
    expect(nav!.settingsScreen).toBe(screen);
  });

  it('Git moved from the sidebar INTO App Settings (admin 2026-08-01)', () => {
    const entry = kb('settings_git');
    expect(entry).toBeTruthy();
    // No longer on the sidebar rail — it now opens from App Settings.
    expect(entry!.path).not.toContain('Sidebar → Git');
    expect(entry!.path).toContain('App Settings');
    expect(entry!.path).toMatch(/Git & Deployment/i);
  });
});

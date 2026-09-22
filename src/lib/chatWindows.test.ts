import { describe, it, expect } from 'vitest';
import {
  MAX_OPEN_CHATS, SLOT_VIEWS, chatSlotsUsed, chatSlotFree, openWindow, closeWindow, windowsOf, nextActiveAfterClose, windowLabel, capMessage,
  isWindowedProfessional, OWN_SURFACE_PROFESSIONALS, type ChatWindow,
} from './chatWindows';
import { PROFESSIONAL_CHATS } from '../components/professionals/professionalConfigs';

const w = (id: string, professionalId: string): ChatWindow => ({ id, professionalId });

describe('chatWindows — five conversations at once, each its own window', () => {
  it('the cap is the admin\'s number', () => {
    expect(MAX_OPEN_CHATS).toBe(5);
    expect(capMessage()).toContain('5 chats are open');
  });

  it('opens up to five, then REFUSES with a reason rather than silently doing nothing', () => {
    let list: ChatWindow[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = openWindow(list, w(`c${i}`, i % 2 ? 'teacher_ai' : 'lawyer_ai'));
      expect(r.opened).toBe(true);
      list = r.windows;
    }
    const sixth = openWindow(list, w('c6', 'chef_ai'));
    expect(sixth.opened).toBe(false);
    expect(sixth.reason).toBe('cap');
    expect(sixth.windows).toHaveLength(5);
  });

  it('re-opening an already-open window is allowed even at the cap — it is a focus, not a sixth window', () => {
    const list = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => w(id, 'teacher_ai'));
    const r = openWindow(list, w('c3', 'teacher_ai'));
    expect(r.opened).toBe(true);
    expect(r.windows).toBe(list);
  });

  it('the same professional can hold several windows — each a different conversation', () => {
    const list = [w('a', 'teacher_ai'), w('b', 'lawyer_ai'), w('c', 'teacher_ai')];
    expect(windowsOf(list, 'teacher_ai').map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('closing lands on the same professional\'s other window first, else the last window, else nothing', () => {
    const list = [w('a', 'teacher_ai'), w('b', 'lawyer_ai'), w('c', 'teacher_ai')];
    const r1 = closeWindow(list, 'a');
    expect(r1.closed?.id).toBe('a');
    expect(nextActiveAfterClose(r1.windows, r1.closed!)?.id).toBe('c');
    const r2 = closeWindow(r1.windows, 'c');
    expect(nextActiveAfterClose(r2.windows, r2.closed!)?.id).toBe('b');
    const r3 = closeWindow(r2.windows, 'b');
    expect(nextActiveAfterClose(r3.windows, r3.closed!)).toBeNull();
    expect(closeWindow(list, 'nope').closed).toBeNull();
  });

  it('labels number a professional\'s windows only when it has more than one', () => {
    const list = [w('a', 'teacher_ai'), w('b', 'lawyer_ai'), w('c', 'teacher_ai')];
    expect(windowLabel(list, 'a', 'Teacher AI')).toBe('Teacher AI (1)');
    expect(windowLabel(list, 'c', 'Teacher AI')).toBe('Teacher AI (2)');
    expect(windowLabel(list, 'b', 'Lawyer AI')).toBe('Lawyer AI');
    expect(windowLabel(list, 'zzz', 'Ghost')).toBe('Ghost');
    // Once the sibling is gone the number goes too.
    expect(windowLabel(closeWindow(list, 'a').windows, 'c', 'Teacher AI')).toBe('Teacher AI');
  });
});

describe('which professionals the window system serves', () => {
  it('every config-driven professional except the own-surface ones; never a non-professional view', () => {
    expect(isWindowedProfessional('teacher_ai')).toBe(true);
    expect(isWindowedProfessional('repo_analyst')).toBe(false);
    for (const id of ['nbi_chat', 'sda_chat', 'imagegen', 'home', '']) expect(isWindowedProfessional(id), id).toBe(false);
    const served = Object.keys(PROFESSIONAL_CHATS).filter(isWindowedProfessional);
    expect(served.length).toBe(Object.keys(PROFESSIONAL_CHATS).length - OWN_SURFACE_PROFESSIONALS.size);
  });
});

/**
 * THE FIVE ARE COUNTED ACROSS EVERY CHAT THE MODE LIST CAN SWITCH TO (admin 2026-09-22, approving the
 * redesign: Doctor AI and the Image Generator count — "doctor + 4 = 5"; the FREE chat is the tab's home
 * and is never counted). One function holds the arithmetic; the cap asks it.
 */
describe('chatSlotsUsed — Doctor AI and the image studio take a slot each', () => {
  const win = (id: string, professionalId = 'teacher_ai') => ({ id, professionalId });

  it('counts every window plus every open slot view, and never the FREE chat or a non-chat tab', () => {
    expect(chatSlotsUsed([], [])).toBe(0);
    expect(chatSlotsUsed([win('a'), win('b')], ['nbi_chat', 'settings', 'home'])).toBe(2);
    expect(chatSlotsUsed([win('a')], ['nbi_chat', 'sda_chat'])).toBe(2);
    expect(chatSlotsUsed([win('a')], ['nbi_chat', 'sda_chat', 'imagegen'])).toBe(3);
    expect(SLOT_VIEWS).toEqual(['sda_chat', 'imagegen']);
  });

  it('the admin\'s own example: Doctor AI plus four professional chats fills the five', () => {
    const four = [win('a'), win('b', 'lawyer_ai'), win('c'), win('d', 'chef_ai')];
    expect(chatSlotFree(four, ['nbi_chat', 'sda_chat'])).toBe(false);
    expect(chatSlotFree(four, ['nbi_chat'])).toBe(true);
    // …and openWindow refuses on the SAME count when it is handed the open tabs.
    expect(openWindow(four, win('e'), ['nbi_chat', 'sda_chat'])).toMatchObject({ opened: false, reason: 'cap' });
    expect(openWindow(four, win('e'), ['nbi_chat'])).toMatchObject({ opened: true });
    // A window that is already open is a focus, not a sixth chat, even at the cap.
    expect(openWindow(four, win('a'), ['nbi_chat', 'sda_chat'])).toMatchObject({ opened: true });
  });

  it('every slot view is a mode surface — a view the Mode list can actually switch to', async () => {
    const { isModeSurface } = await import('../components/chat/modePicker');
    for (const v of SLOT_VIEWS) expect(isModeSurface(v), v).toBe(true);
  });
});

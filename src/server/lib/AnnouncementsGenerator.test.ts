import { describe, it, expect, afterAll } from 'vitest';

import { generateAnnouncementsIntegration, ANNOUNCEMENTS_SERVICE_SOURCE } from './AnnouncementsGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateAnnouncementsIntegration (wiring)', () => {
  it('emits the announcement service, routes and README', () => {
    const out = generateAnnouncementsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/announcements/announcementService.ts');
    expect(paths).toContain('server/announcements/routes.ts');
    expect(paths).toContain('server/announcements/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/announcements/routes.ts']).toContain('export const announcementRouter');
    expect(out.files['server/announcements/routes.ts']).toContain('/dismiss');
  });
});

// Materialize + execute the emitted domain logic — the scheduling + dismiss-once rules are real business rules,
// verified against the actual emitted code.
describe('emitted AnnouncementService — scheduled visibility + dismiss-once (real logic)', () => {
  const emitted = emitModule('announcements', ANNOUNCEMENTS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Level = 'info' | 'success' | 'warning' | 'critical';
  interface Announcement { id: string; message: string; level: Level; dismissible: boolean; published: boolean; startsAt: string | null; endsAt: string | null; createdAt: string }
  interface Service {
    create(input: { message: string; level?: Level; dismissible?: boolean; published?: boolean; startsAt?: string | null; endsAt?: string | null }, now?: Date): Announcement;
    get(id: string): Announcement | undefined;
    dismiss(userId: string, announcementId: string): boolean;
    hasDismissed(userId: string, announcementId: string): boolean;
    activeFor(userId: string, at?: Date): Announcement[];
    list(): Announcement[];
  }
  interface Emitted { AnnouncementService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('a draft banner is never active; publishing makes it active', async () => {
    const { AnnouncementService } = await load();
    const svc = new AnnouncementService();
    const a = svc.create({ message: 'Hello' }); // draft
    expect(svc.activeFor('u1').length).toBe(0);
    svc.create({ message: 'Live', published: true });
    expect(svc.activeFor('u1').map((x) => x.message)).toEqual(['Live']);
    void a;
  });

  it('respects the [startsAt, endsAt] schedule window', async () => {
    const { AnnouncementService } = await load();
    const svc = new AnnouncementService();
    svc.create({ message: 'Sale', published: true, startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-02-10T00:00:00Z' });
    expect(svc.activeFor('u', new Date('2026-01-31T23:59:00Z')).length).toBe(0); // before window
    expect(svc.activeFor('u', new Date('2026-02-05T00:00:00Z')).length).toBe(1); // inside
    expect(svc.activeFor('u', new Date('2026-02-10T00:00:00Z')).length).toBe(0); // at end (exclusive)
    expect(() => svc.create({ message: 'x', startsAt: '2026-02-10T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' })).toThrow(/endsAt must be after/);
  });

  it('THE INVARIANT: once a user dismisses a banner it never shows for that user again (per-user)', async () => {
    const { AnnouncementService } = await load();
    const svc = new AnnouncementService();
    const a = svc.create({ message: 'Notice', published: true });
    expect(svc.activeFor('alice').map((x) => x.id)).toEqual([a.id]);
    expect(svc.activeFor('bob').map((x) => x.id)).toEqual([a.id]);
    // alice dismisses
    expect(svc.dismiss('alice', a.id)).toBe(true);
    expect(svc.hasDismissed('alice', a.id)).toBe(true);
    expect(svc.activeFor('alice').length).toBe(0);      // gone for alice forever
    expect(svc.activeFor('bob').map((x) => x.id)).toEqual([a.id]); // still shows for bob
    // dismissing again is idempotent
    expect(svc.dismiss('alice', a.id)).toBe(true);
    expect(svc.activeFor('alice').length).toBe(0);
  });

  it('a NON-dismissible banner cannot be dismissed away', async () => {
    const { AnnouncementService } = await load();
    const svc = new AnnouncementService();
    const a = svc.create({ message: 'Mandatory', published: true, dismissible: false });
    expect(svc.dismiss('u', a.id)).toBe(false);          // dismiss refused
    expect(svc.activeFor('u').map((x) => x.id)).toEqual([a.id]); // still shows
  });

  it('validates input and unknown-id cases', async () => {
    const { AnnouncementService } = await load();
    const svc = new AnnouncementService();
    expect(() => svc.create({ message: '' })).toThrow(/message is required/);
    expect(() => svc.dismiss('', 'x')).toThrow(/userId is required/);
    expect(svc.dismiss('u', 'missing')).toBe(false); // unknown banner -> no-op
  });
});

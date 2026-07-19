import { describe, it, expect } from 'vitest';
import {
  extractMissingPrismaExports,
  isEnumConsumerFile,
  fixDanglingEnumConsumer,
} from './prismaEnumConsumers';

describe('extractMissingPrismaExports — the exact MediConnect seed error', () => {
  it('pulls the enum name from the ESM "does not provide an export named" error', () => {
    const err = "SyntaxError: The requested module '@prisma/client' does not provide an export named 'AppointmentStatus'";
    expect(extractMissingPrismaExports(err)).toEqual(['AppointmentStatus']);
  });
  it('de-dupes and collects multiple missing exports', () => {
    const err = `does not provide an export named 'UserRole'\n...\ndoes not provide an export named 'DoctorStatus'\ndoes not provide an export named 'UserRole'`;
    expect(extractMissingPrismaExports(err).sort()).toEqual(['DoctorStatus', 'UserRole']);
  });
  it('is empty for unrelated errors', () => {
    expect(extractMissingPrismaExports('P1001: Can\'t reach database server')).toEqual([]);
    expect(extractMissingPrismaExports('')).toEqual([]);
    expect(extractMissingPrismaExports(null)).toEqual([]);
  });
});

describe('isEnumConsumerFile', () => {
  it('accepts ts/tsx/js/jsx, rejects .d.ts and non-code', () => {
    expect(isEnumConsumerFile('prisma/seed.ts')).toBe(true);
    expect(isEnumConsumerFile('app/routes/book.tsx')).toBe(true);
    expect(isEnumConsumerFile('types/index.d.ts')).toBe(false);
    expect(isEnumConsumerFile('prisma/schema.prisma')).toBe(false);
  });
});

describe('fixDanglingEnumConsumer — the exact MediConnect seed.ts', () => {
  it('removes the enum from a multi-name @prisma/client import and keeps the rest', () => {
    const src = `import { PrismaClient, UserRole, DoctorStatus, AppointmentStatus } from '@prisma/client';\nconst prisma = new PrismaClient();`;
    const out = fixDanglingEnumConsumer('prisma/seed.ts', src, 'AppointmentStatus');
    expect(out).toContain("import { PrismaClient, UserRole, DoctorStatus } from '@prisma/client';");
    expect(out).not.toContain('AppointmentStatus');
  });

  it('drops the whole import line when the enum was the only name', () => {
    const src = `import { AppointmentStatus } from '@prisma/client';\nconst x = 1;`;
    const out = fixDanglingEnumConsumer('prisma/seed.ts', src, 'AppointmentStatus');
    expect(out).not.toMatch(/@prisma\/client/);
    expect(out).toContain('const x = 1;');
  });

  it('rewrites member access Enum.MEMBER → the string literal', () => {
    const src = `import { AppointmentStatus } from '@prisma/client';\nawait prisma.appointment.create({ data: { status: AppointmentStatus.CONFIRMED } });`;
    const out = fixDanglingEnumConsumer('prisma/seed.ts', src, 'AppointmentStatus');
    expect(out).toContain("status: 'CONFIRMED'");
    expect(out).not.toContain('AppointmentStatus.CONFIRMED');
  });

  it('rewrites a type annotation `: Enum` → `: string`', () => {
    const src = `import { AppointmentStatus } from '@prisma/client';\nfunction f(s: AppointmentStatus) { return s; }`;
    const out = fixDanglingEnumConsumer('app/utils.ts', src, 'AppointmentStatus');
    expect(out).toContain('function f(s: string)');
  });

  it('handles a `type`-only import name and preserves the other imports', () => {
    const src = `import { PrismaClient, type UserRole } from '@prisma/client';\nlet r: UserRole = UserRole.ADMIN;`;
    const out = fixDanglingEnumConsumer('a.ts', src, 'UserRole');
    expect(out).toContain("import { PrismaClient } from '@prisma/client';");
    expect(out).toContain("let r: string = 'ADMIN';");
  });

  it('is a no-op for a file that never references the enum, a .d.ts, or a non-code file', () => {
    const src = `import { PrismaClient } from '@prisma/client';\nconst p = new PrismaClient();`;
    expect(fixDanglingEnumConsumer('a.ts', src, 'AppointmentStatus')).toBe(src);
    expect(fixDanglingEnumConsumer('types.d.ts', `type X = AppointmentStatus;`, 'AppointmentStatus')).toBe('type X = AppointmentStatus;');
    expect(fixDanglingEnumConsumer('readme.md', 'AppointmentStatus', 'AppointmentStatus')).toBe('AppointmentStatus');
  });
});

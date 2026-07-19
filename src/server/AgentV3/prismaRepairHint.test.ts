import { describe, it, expect } from 'vitest';
import { prismaRepairHint } from './prismaRepairHint';

describe('prismaRepairHint — targeted fix guidance for Prisma schema errors format cannot fix', () => {
  it('returns null for non-Prisma output (a generic phrase never triggers a hint)', () => {
    expect(prismaRepairHint('Error: value must be unique in the config map')).toBeNull();
    expect(prismaRepairHint('npm ERR! peer dep conflict')).toBeNull();
    expect(prismaRepairHint('')).toBeNull();
  });

  it('ambiguous relation → name-both-sides guidance', () => {
    const out = prismaRepairHint(
      'Error validating model "Post": Ambiguous relation detected. prisma/schema.prisma:12',
    );
    expect(out).toContain('AMBIGUOUS');
    expect(out).toContain('@relation("PostAuthor"');
  });

  it('missing fields/references argument → add scalar FK + references guidance', () => {
    const out = prismaRepairHint(
      'Error validating field `author` in model `Post`: The relation field `author` on Model `Post` must specify the `references` argument. (P1012) schema.prisma',
    );
    expect(out).toContain('fields`/`references');
    expect(out).toContain('authorId Int');
  });

  it('missing opposite relation field → add back-relation guidance', () => {
    const out = prismaRepairHint(
      'Error validating field `author`: The relation field `author` on Model `Post` is missing an opposite relation field on the model `User`. schema.prisma (P1012)',
    );
    expect(out).toContain('opposite field');
    expect(out).toContain('posts Post[]');
  });

  it('referenced field not unique → add @unique guidance', () => {
    const out = prismaRepairHint(
      'The argument `references` must refer to a unique criteria in the related model `User`. schema.prisma P1012',
    );
    expect(out).toContain('@unique');
  });

  it('no primary key → add @id guidance', () => {
    const out = prismaRepairHint(
      'Error validating model "Session": Each model must have at least one unique criteria that has only required fields. prisma/schema.prisma (P1012)',
    );
    expect(out).toContain('@id');
    expect(out).toContain('autoincrement');
  });

  it('SQLite enum unsupported → replace-with-String guidance', () => {
    const out = prismaRepairHint(
      'Error validating: You defined the enum `Role`. But the current connector (sqlite) does not support enums. schema.prisma',
    );
    expect(out).toContain('SQLite');
    expect(out).toContain('String');
  });

  it('missing datasource URL → set DATABASE_URL guidance', () => {
    const out = prismaRepairHint(
      'Error: Environment variable not found: DATABASE_URL. schema.prisma datasource db',
    );
    expect(out).toContain('DATABASE_URL');
    expect(out).toContain('.env');
  });

  it('specific rules win over the generic P1012 fallback', () => {
    // Contains P1012 AND a specific ambiguous-relation phrase → the specific hint, not the generic one.
    const out = prismaRepairHint('P1012 ambiguous relation detected in prisma/schema.prisma');
    expect(out).toContain('AMBIGUOUS');
  });

  it('generic P1012 with no recognised class → the fallback validation hint', () => {
    const out = prismaRepairHint('Error validating datasource `db`: something unusual. P1012 schema.prisma');
    expect(out).toContain('schema validation failed');
    expect(out).toContain('Error validating');
  });

  it('a recognised Prisma command that SUCCEEDED-looking (no error class) → null', () => {
    expect(prismaRepairHint('prisma generate ran; Generated Prisma Client in 120ms')).toBeNull();
  });
});

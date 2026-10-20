import { describe, it, expect } from 'vitest';
import { generateStorageIntegration, isStorageProvider } from './StorageGenerator';
import ts from 'typescript';
import { posix } from 'node:path';

for (const provider of ['s3', 'cloudinary'] as const) {
  describe(`generated ${provider} upload integration`, () => {
    const c = generateStorageIntegration(provider);
    it('ships every relative import instead of reaching into the builder repository', () => {
      for (const [path, source] of Object.entries(c.files).filter(([path]) => path.endsWith('.ts'))) {
        const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        for (const node of ast.statements) {
          if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
          const name = node.moduleSpecifier.text;
          if (name.startsWith('.')) {
            const target = posix.normalize(posix.join(posix.dirname(path), name));
            expect(c.files[target + '.ts'], `${path} imports missing ${target}`).toBeDefined();
          } else if (!name.startsWith('node:')) {
            const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
            expect(['express', ...c.dependencies.map((d) => d.name)]).toContain(pkg);
          }
        }
        expect(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true }).diagnostics).toEqual([]);
      }
    });
    it('authenticates before accepting bounded bytes and reserves a durable quota before storage', () => {
      const server = c.files['server/routes/upload.ts'];
      expect(server).toContain("post('/file', requireUploadUser, raw(");
      expect(server).toContain('uploadBytes(req)');
      expect(server).toContain('await reserveUpload(res, bytes.length)');
      expect(server).not.toContain('api_sign_request');
      expect(server).not.toContain('getSignedUrl');
      expect(c.files['server/lib/uploadAccess.ts']).toContain('/auth/v1/user');
      expect(c.files['migrations/003_upload_quota.sql']).toContain('for update');
      expect(c.files['src/lib/upload.ts']).toContain("Authorization: 'Bearer ' + accessToken");
    });
    it('requires real configuration, leaves every secret blank and sends no secret to the client', () => {
      for (const key of c.envKeys) expect(c.files['.env.example']).toContain(`${key}=`);
      expect(c.files['src/lib/upload.ts']).not.toMatch(/SECRET|AWS_ACCESS|CLOUDINARY_API_KEY/);
      expect(c.instructions).toContain('003_upload_quota.sql');
      expect(c.instructions).toContain('session.access_token');
    });
  });
}

describe('provider guards', () => {
  it('accepts supported providers and rejects unknown ones', () => {
    for (const p of ['s3', 'cloudinary', 'supabase']) expect(isStorageProvider(p)).toBe(true);
    for (const p of ['gcs', '', null]) expect(isStorageProvider(p)).toBe(false);
    // @ts-expect-error unknown provider
    expect(() => generateStorageIntegration('gcs')).toThrow();
  });
});

describe('all generated providers compile cleanly and close imports', () => {
  it('generated modules contain no unused local imports or helpers under strict app typechecks', () => {
    for (const provider of ['s3', 'cloudinary', 'supabase'] as const) {
      for (const [path, source] of Object.entries(generateStorageIntegration(provider).files)) {
        if (!path.endsWith('.ts')) continue;
        const virtual = '/__generated__/' + path;
        const options: ts.CompilerOptions = { noEmit: true, noUnusedLocals: true, types: [], skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
        const host = ts.createCompilerHost(options); const original = host.getSourceFile;
        host.getSourceFile = (name, ...args) => name === virtual ? ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true) : original(name, ...args);
        const program = ts.createProgram([virtual], options, host);
        const unused = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === virtual && [6133, 6192].includes(d.code));
        expect(unused.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')), `${provider}: ${path}`).toEqual([]);
      }
    }
  });
  it('every relative import in every recipe resolves to a generated file, including unused imports', () => {
    for (const provider of ['s3', 'cloudinary', 'supabase'] as const) {
      const { files } = generateStorageIntegration(provider);
      for (const [path, source] of Object.entries(files)) {
        if (!path.endsWith('.ts')) continue;
        for (const imported of ts.preProcessFile(source).importedFiles) {
          if (!imported.fileName.startsWith('.')) continue;
          const resolved = posix.normalize(posix.join(posix.dirname(path), imported.fileName));
          expect([resolved, resolved + '.ts', resolved + '/index.ts'].some(p => p in files), `${provider}: ${path} -> ${imported.fileName}`).toBe(true);
        }
      }
    }
  });
});

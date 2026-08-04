import { describe, it, expect } from 'vitest';
import { scanUploadValidation, scanProjectUploadValidation, uploadValidationSummary } from './UploadValidationAnalysis';

describe('scanUploadValidation — flag an unrestricted multer upload', () => {
  it('flags multer configured with no fileFilter / MIME check', () => {
    const code = [
      "import multer from 'multer';",
      "const upload = multer({ dest: 'uploads/' });",
      "app.post('/upload', upload.single('file'), (req, res) => res.sendStatus(200));",
    ].join('\n');
    const issues = scanUploadValidation('src/server/routes/upload.ts', code);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ library: 'multer', missing: 'file-type-filter', severity: 'medium', kind: 'upload-no-mime-validation' });
  });

  it('flags bare multer() with no options', () => {
    expect(scanUploadValidation('upload.js', "const upload = multer();")).toHaveLength(1);
  });

  it('flags formidable with no mimetype check', () => {
    const code = [
      "import formidable from 'formidable';",
      "const form = formidable({ multiples: true });",
      "form.parse(req, (err, fields, files) => res.json(files));",
    ].join('\n');
    const issues = scanUploadValidation('src/server/upload.ts', code);
    expect(issues).toHaveLength(1);
    expect(issues[0].library).toBe('formidable');
  });

  it('flags express-fileupload (fileUpload middleware) with no mimetype check', () => {
    const code = [
      "import fileUpload from 'express-fileupload';",
      "app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));",
    ].join('\n');
    const issues = scanUploadValidation('src/server/app.ts', code);
    expect(issues).toHaveLength(1);
    expect(issues[0].library).toBe('express-fileupload');
  });

  it('does NOT flag formidable when a mimetype allowlist check is present', () => {
    const code = [
      "const form = formidable({});",
      "if (!['image/png','image/jpeg'].includes(files.photo.mimetype)) return res.status(400).end();",
    ].join('\n');
    expect(scanUploadValidation('upload.ts', code)).toHaveLength(0);
  });

  it('does NOT flag multer with a fileFilter (built-in type gate)', () => {
    const code = [
      "const upload = multer({",
      "  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'image/png'),",
      "});",
    ].join('\n');
    expect(scanUploadValidation('upload.ts', code)).toHaveLength(0);
  });

  it('does NOT flag when the file does a manual mimetype check', () => {
    const code = [
      "const upload = multer({ storage });",
      "if (req.file.mimetype !== 'application/pdf') return res.status(400).end();",
    ].join('\n');
    expect(scanUploadValidation('upload.ts', code)).toHaveLength(0);
  });

  it('does NOT flag a file that never configures multer', () => {
    expect(scanUploadValidation('app.ts', "app.get('/', (req, res) => res.send('ok'));")).toHaveLength(0);
  });

  it('returns [] for empty / non-string input', () => {
    expect(scanUploadValidation('a.ts', '')).toHaveLength(0);
    // @ts-expect-error — defensive: non-string input never throws
    expect(scanUploadValidation('a.ts', null)).toHaveLength(0);
  });
});

describe('scanProjectUploadValidation — backend files only, skips frontend/vendored/test trees', () => {
  it('scans backend files and skips frontend/node_modules/test files', () => {
    const files: Record<string, string> = {
      'src/server/upload.ts': "const upload = multer({ dest: 'up/' });",
      'src/components/Uploader.tsx': "const upload = multer();", // frontend ext — skipped
      'node_modules/multer/index.js': "function multer() {}", // vendored — skipped
      'src/server/upload.test.ts': "const upload = multer();", // test — skipped
    };
    expect(scanProjectUploadValidation(files).map((i) => i.file)).toEqual(['src/server/upload.ts']);
  });

  it('returns [] for a project with a properly-filtered upload', () => {
    const files = { 'src/server/upload.ts': "const upload = multer({ fileFilter: fn });" };
    expect(scanProjectUploadValidation(files)).toHaveLength(0);
  });
});

describe('uploadValidationSummary — honest agent-facing report', () => {
  it('reports a clean pass with no findings', () => {
    expect(uploadValidationSummary([])).toContain('✓ No unrestricted file-upload endpoints');
  });

  it('names the gap and how to fix it', () => {
    const out = uploadValidationSummary(scanUploadValidation('u.ts', 'multer({ dest: "x" })'));
    expect(out).toContain('fileFilter');
    expect(out).toContain('MIME');
  });
});

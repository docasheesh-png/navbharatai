import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { auditSummaryClaims, claimCorrection } from '../src/server/AgentV3/claimAudit';
import { LOCAL_UPLOAD_LIMITS, provenLocalUploadPath } from '../src/server/AgentV3/localUploadPath';
import { LOCAL_UPLOAD_NOTICE } from '../src/server/AgentV3/localUploadNotice';
import { findFakeFeatures, fakeFeatureNotice, fakeFeatureReportLine, honestyBannerLines, impliedRequirementsFor,
  keysForFinding, withHonestyBanner, fakeFeatureWriteNote, type FakeFeatureFinding } from '../src/server/AgentV3/fakeFeatureScan';
import { HONESTY_BANNER_OPEN, HONESTY_BANNER_CLOSE } from '../src/lib/honestyBanner';

// Invented current-code regression, not retained source or historical causality evidence.
const COMPONENT = `import { useState } from 'react';
export default function Photos() {
  const [message, setMessage] = useState('');
  const upload = () => { setMessage('Uploaded to the cloud'); };
  return <main><button onClick={upload}>Upload</button><p>{message}</p></main>;
}`;
const ENTRY = `import { createRoot } from 'react-dom/client';
import Photos from './Photos';
createRoot(document.getElementById('root')!).render(<Photos />);`;
const HTML = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Photos</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
const fixture = (component = COMPONENT): Record<string, string> => ({
  'index.html': HTML, 'src/main.tsx': ENTRY, 'src/Photos.tsx': component,
  'src/helper.ts': '// Example: new FormData()\nexport const help = 1;',
});
const scan = (component = COMPONENT) => findFakeFeatures(fixture(component));

describe('a storage marker cannot erase a proved root-local upload claim', () => {
  it.each([
    '// Example: new FormData()\nexport const help = 1;',
    'export const unused = new FormData();',
    "// supabase.storage.from('photos').upload(name, file)\nexport const help = 'inert';",
  ])('finds the reachable root handler despite an inert marker: %s', (helper) => {
    const hits = findFakeFeatures({ ...fixture(), 'src/helper.ts': helper });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'upload', file: 'src/Photos.tsx', line: 4, evidence: 'local-upload-path', requirementId: 'storage' });
    expect(hits[0].snippet).toContain("setMessage('Uploaded to the cloud')");
  });
  it('requires explicit reachable entry wiring, not an unused Photos example', () => {
    expect(findFakeFeatures({ 'src/Photos.tsx': COMPONENT, 'src/helper.ts': 'const unused = new FormData();' })).toEqual([]);
    expect(findFakeFeatures({ ...fixture(), 'src/main.tsx': ENTRY.replace('./Photos', './Other'),
      'src/Other.tsx': 'export default function Other() { return <p>Local preview</p>; }' })).toEqual([]);
  });
  it.each(['photos', 'div', 'p'])('does not mistake the intrinsic JSX name %s for the imported component', (name) => {
    expect(findFakeFeatures({ ...fixture(), 'src/main.tsx': ENTRY.replace('import Photos from', `import ${name} from`)
      .replace('<Photos />', `<${name} />`) })).toEqual([]);
  });
  it.each(['Saved to our server.', 'Synced to cloud', 'Backed up to the cloud!'])('supports a direct positive success literal: %s', (label) => {
    expect(scan(COMPONENT.replace('Uploaded to the cloud', label))).toHaveLength(1);
  });
  it('supports ordinary static default-toolchain metadata', () => {
    expect(findFakeFeatures({ ...fixture(), 'package.json': JSON.stringify({ name: 'photos', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', noEmit: true, strict: true }, include: ['src'] }),
    })).toHaveLength(1);
  });
  it('preserves the legacy single-file rule, demo exemption and write-time behavior', () => {
    const legacy = findFakeFeatures({ 'src/Photos.tsx': COMPONENT });
    expect(legacy).toHaveLength(1);
    expect(legacy[0].evidence).toBeUndefined();
    expect(keysForFinding(legacy[0]).length).toBeGreaterThan(0);
    expect(findFakeFeatures(fixture(), 'make a demo app')).toEqual([]);
    expect(fakeFeatureWriteNote('src/Photos.tsx', COMPONENT)).toContain('NO FAKE BUTTON');
    expect(fakeFeatureWriteNote('src/Photos.tsx', `// new FormData()\n${COMPONENT}`)).toBe('');
  });
});

describe('unknown effects, binding, reachability or meaning stand down', () => {
  it.each(['eval', 'arguments', 'await', 'yield', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static'])
  ('does not infer executable strict-module bindings for %s', (name) => {
    for (const binding of ['Photos', 'message', 'setMessage', 'upload']) {
      expect(scan(COMPONENT.replace(new RegExp(`\\b${binding}\\b`, 'g'), name))).toEqual([]);
    }
    expect(findFakeFeatures({ ...fixture(), 'src/helper.ts': `// new FormData()\nconst ${name} = 1;` })).toEqual([]);
  });
  it.each([
    ['fetch transport', "setMessage('Uploaded to the cloud');", "fetch('/api/upload', { method: 'POST', body: new FormData() }); setMessage('Uploaded to the cloud');"],
    ['awaited checked transport', 'const upload = () => {', "const upload = async () => { const response = await fetch('/api/upload', { method: 'POST', body: new FormData() }); if (!response.ok) throw new Error('Upload failed');"],
    ['storage SDK', 'const upload = () => {', "const upload = () => { supabase.storage.from('photos').upload(name, file);"],
    ['Firebase SDK', 'const upload = () => {', 'const upload = () => { uploadBytes(ref(storage, name), file);'],
    ['callback prop', 'function Photos()', 'function Photos({ onUpload })'],
    ['opaque callback before', 'const upload = () => {', 'const upload = () => { onUpload();'],
    ['opaque callback after', "setMessage('Uploaded to the cloud');", "setMessage('Uploaded to the cloud'); onUpload();"],
    ['state observer effect', '  const upload =', '  useEffect(() => uploadFile(message), [message]); const upload ='],
    ['custom hook', "import { useState } from 'react'", "import { useState } from './storage'"],
    ['hook alias', 'import { useState }', 'import { useState as state }'],
    ['hook shadowing', 'function Photos()', 'function Photos(useState)'],
    ['setter shadowing', 'const upload = () =>', 'const upload = (setMessage) =>'],
    ['binding initializer', '[message, setMessage]', '[message, setMessage = onUpload]'],
    ['aliased handler', '  return <main>', '  const action = upload; return <main>'],
    ['handler wrapper', 'onClick={upload}', 'onClick={() => upload()}'],
    ['async handler', 'const upload = () =>', 'const upload = async () =>'],
    ['promise continuation', "setMessage('Uploaded to the cloud');", "Promise.resolve().then(() => setMessage('Uploaded to the cloud'));"],
    ['timer', "setMessage('Uploaded to the cloud');", "setTimeout(() => setMessage('Uploaded to the cloud'), 0);"],
    ['conditional control flow', "setMessage('Uploaded to the cloud');", "if (ok) setMessage('Uploaded to the cloud');"],
    ['unreachable statement', "setMessage('Uploaded to the cloud');", "return; setMessage('Uploaded to the cloud');"],
    ['hidden success', '<p>', '<p hidden>'],
    ['hidden root', '<main>', '<main style={{display: "none"}}>'],
    ['disabled control', '<button ', '<button disabled '],
    ['form delegation', '<main>', '<main onClickCapture={uploadFile}>'],
    ['native form', '<main>', '<form>'],
    ['custom ancestor', '<main>', '<UploadProvider>'],
    ['custom child', '<p>{message}</p>', '<UploadResult>{message}</UploadResult>'],
    ['unused handler', 'onClick={upload}', 'onClick={other}'],
    ['duplicate event', 'onClick={upload}', 'onClick={upload} onClick={realUpload}'],
    ['spread event', 'onClick={upload}', '{...props} onClick={upload}'],
    ['local preview only', 'Uploaded to the cloud', 'Upload complete'],
    ['negative claim', 'Uploaded to the cloud', 'Not uploaded to the cloud'],
    ['demo claim', 'Uploaded to the cloud', 'Demo: uploaded to the cloud'],
    ['external demo label', '<p>{message}</p>', '<p>Demo only: {message}</p>'],
    ['external negative label', '<p>{message}</p>', '<p>Not {message}</p>'],
    ['static unused claim', '<p>{message}</p>', '<p>Ready</p>'],
    ['state data escape', '<p>{message}</p>', '<p>{sendToCloud(message)}</p>'],
    ['JSX pragma', "import { useState }", '/** @jsx uploadAndRender */ import { useState }'],
    ['JSX import source', "import { useState }", '/** @jsxImportSource ./upload-runtime */ import { useState }'],
    ['module effect', "import { useState }", "registerUploadListener(); import { useState }"],
    ['opaque import', "import { useState }", "import './uploadObserver'; import { useState }"],
    ['ambient state declaration', '  const [message', '  declare const [message'],
  ])('does not accuse an unsupported candidate: %s', (_name, from, to) => {
    expect(scan(COMPONENT.replace(from, to))).toEqual([]);
  });
  it.each([
    ['capture wrapper', '<Photos />', '<div onClickCapture={uploadFile}><Photos /></div>'],
    ['React wrapper', '<Photos />', '<StrictMode><Photos /></StrictMode>'],
    ['props', '<Photos />', '<Photos onUpload={uploadFile} />'],
    ['wrong root', "getElementById('root')", "getElementById('other')"],
    ['root function alias', 'createRoot(document', 'root(document'],
    ['document shadow', "import Photos from", "const document = makeUploadDocument(); import Photos from"],
    ['root mutation', 'createRoot(document', '(createRoot = wrapUpload)(document'],
    ['path query', "'./Photos'", "'./Photos?raw'"],
    ['path traversal', "'./Photos'", "'./../src/Photos'"],
    ['path alias', "'./Photos'", "'@/Photos'"],
    ['side-effect import', 'createRoot(document', "import './observer'; createRoot(document"],
    ['entry JSX pragma', 'import { createRoot }', '/** @jsxImportSource ./observer */ import { createRoot }'],
  ])('does not infer an opaque root: %s', (_name, from, to) => {
    expect(findFakeFeatures({ ...fixture(), 'src/main.tsx': ENTRY.replace(from, to) })).toEqual([]);
  });
  it.each([
    ['extra script', '</body>', '<script src="/observer.js"></script></body>'],
    ['inline capture', '<body>', '<body onclick="uploadFile()">'],
    ['duplicate root', '<div id="root"></div>', '<div id="root"></div><div id="root"></div>'],
    ['missing root', '<div id="root"></div>', ''],
    ['duplicate entry', '</body>', '<script type="module" src="/src/main.tsx"></script></body>'],
    ['hidden root', '<div id="root">', '<div hidden id="root">'],
    ['stylesheet', '</head>', '<link rel="stylesheet" href="/hide.css"></head>'],
    ['import map', '</head>', '<script type="importmap">{}</script></head>'],
    ['malformed quotes', 'id="root"', 'id="root\''],
  ])('requires the actual inert shell: %s', (_name, from, to) => {
    expect(findFakeFeatures({ ...fixture(), 'index.html': HTML.replace(from, to) })).toEqual([]);
  });
  it.each([
    ['src/observer.ts', 'document.addEventListener("click", uploadFile);'],
    ['src/opaque.ts', 'export const storage = createStorageClient();'],
    ['src/aliases.ts', "export { default } from './Photos';"],
    ['src/helper.ts', 'const FormData = Upload; const unused = new FormData();'],
    ['src/Photos.jsx', COMPONENT],
    ['vite.config.ts', 'export default { plugins: [opaqueUploadPlugin()] };'],
    ['tsconfig.json', '{"compilerOptions":{"jsx":"react-jsx","paths":{"react":["./storage"]}}}'],
    ['tsconfig.json', '{"extends":"./custom.json"}'],
    ['package.json', '{"dependencies":{"react":"npm:upload-hooks@1.0.0"}}'],
    ['package.json', '{"scripts":{"dev":"node inject-upload.js && vite"}}'],
    ['package.json', '{"overrides":{"react":"npm:upload-hooks@1.0.0"}}'],
    ['src/styles.css', 'p { display: none; }'],
  ])('stands down for unknown project context %s', (path, source) => {
    expect(findFakeFeatures({ ...fixture(), [path]: source })).toEqual([]);
  });
});

describe('local upload evidence stays honest through every consumer', () => {
  it('asks for wiring and result verification, never invents missing credentials', () => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    expect(keysForFinding(hits[0])).toEqual([]);
    expect(impliedRequirementsFor(hits)).toEqual([]);
    expect(fakeFeatureNotice(hits)).toContain('Connect it to a real upload');
    expect(fakeFeatureNotice(hits)).not.toContain('Once the key is saved');
    expect(fakeFeatureReportLine(hits)).toContain('local upload success claim');
    expect(fakeFeatureReportLine(hits)).not.toContain('no provider');
    const facts = { consoleCaptured: false, screenshotTaken: false, previewVerified: false,
      fakeFeatures: ['upload'], fakeFeatureEvidence: hits };
    const contradictions = auditSummaryClaims('Cloud upload is fully working.', facts);
    expect(contradictions).toHaveLength(1);
    expect(claimCorrection(contradictions)).toContain('needs real upload wiring');
    expect(claimCorrection(contradictions)).not.toContain('has no storage');
    expect(claimCorrection(contradictions)).not.toContain("provider's key is added");
  });
  it('retains legacy and mixed findings key requirements and claim corrections', () => {
    const ordinary: FakeFeatureFinding = { kind: 'payment', file: 'src/Pay.tsx', line: 1, snippet: 'setPaid(true)', requirementId: 'payments_razorpay' };
    const mixed = [...scan(), ordinary];
    expect(impliedRequirementsFor(mixed)).toEqual(impliedRequirementsFor([ordinary]));
    expect(fakeFeatureNotice(mixed)).toContain('RAZORPAY_KEY_ID');
    expect(honestyBannerLines(mixed)).toHaveLength(2);
    const result = auditSummaryClaims('Cloud upload is working.\nPayment is integrated.', {
      consoleCaptured: false, screenshotTaken: false, previewVerified: false, fakeFeatures: ['upload', 'payment'], fakeFeatureEvidence: mixed,
    });
    expect(result[0].measured).toContain('needs real upload wiring');
    expect(result[1].measured).toContain("provider's key is added");
  });
  it.each(Object.keys(LOCAL_UPLOAD_NOTICE))('preserves stable mixed banners and localized disclosure in %s', (lang) => {
    const hits = scan();
    expect(hits).toHaveLength(1);
    const mixed: FakeFeatureFinding[] = [...hits, { kind: 'login', file: 'src/Old.tsx', line: 1, snippet: 'old', requirementId: 'login', evidence: 'local-login-path' },
      { kind: 'payment', file: 'src/OldPay.tsx', line: 1, snippet: 'old', requirementId: 'payments_razorpay' }];
    expect(fakeFeatureNotice(hits, lang)).toContain(LOCAL_UPLOAD_NOTICE[lang]);
    expect(honestyBannerLines(hits, lang)[0]).toContain(LOCAL_UPLOAD_NOTICE[lang]);
    const once = withHonestyBanner(HTML, mixed, lang)!;
    expect(once).toContain(`"lang","${lang}"`);
    expect(findFakeFeatures({ ...fixture(), 'index.html': once })).toEqual(hits);
    const next = withHonestyBanner(once, hits, lang)!;
    expect(findFakeFeatures({ ...fixture(), 'index.html': next })).toEqual(hits);
  });
  it.each([
    ['forged markers', `${HONESTY_BANNER_OPEN}<script>uploadFile()</script>${HONESTY_BANNER_CLOSE}`],
    ['changed canonical script', withHonestyBanner('', scan())!.replace('bar.textContent=lines.join', 'bar.innerHTML=lines.join')],
    ['duplicate canonical script', withHonestyBanner('', scan())!.repeat(2)],
    ['extra executable script', `${withHonestyBanner('', scan())}<script>uploadFile()</script>`],
    ['unsupported language', withHonestyBanner('', scan())!.replace('"lang","en"', '"lang","unknown"')],
    ['non-array payload', withHonestyBanner('', scan())!.replace(/^  var lines=.+;$/m, '  var lines={};')],
  ])('does not strip %s', (_name, block) => {
    expect(findFakeFeatures({ ...fixture(), 'index.html': HTML.replace('</body>', `${block}</body>`) })).toEqual([]);
  });
  it.each([
    ['root attribute', 'id="root"', (block: string) => `id="ro${block}ot"`],
    ['entry source attribute', 'main.tsx', (block: string) => `ma${block}in.tsx`],
    ['root tag name', '<div', (block: string) => `<di${block}v`],
    ['title text', '<title>Photos</title>', (block: string) => `<title>${block}</title>`],
  ] as const)('does not remove canonical bytes from the wrong HTML context: %s', (_name, from, replace) => {
    const block = withHonestyBanner('', scan())!.trim();
    expect(findFakeFeatures({ ...fixture(), 'index.html': HTML.replace(from, replace(block)) })).toEqual([]);
  });
});

describe('finite work and scanner integration census', () => {
  it('counts the canonical banner in the original supplied character budget', () => {
    const files = { ...fixture(), 'index.html': withHonestyBanner(HTML, scan())! };
    expect(findFakeFeatures(files)).toHaveLength(1);
    const size = Object.values(files).reduce((sum, source) => sum + source.length, 0);
    files['src/helper.ts'] += '\n//' + 'x'.repeat(LOCAL_UPLOAD_LIMITS.chars - size - 2);
    expect(Object.values(files).reduce((sum, source) => sum + source.length, 0)).toBe(LOCAL_UPLOAD_LIMITS.chars + 1);
    expect(findFakeFeatures(files)).toEqual([]);
  });
  it('rejects malformed and over-budget input', () => {
    expect(scan(COMPONENT.replace('export default', 'export default !'))).toEqual([]);
    expect(provenLocalUploadPath({ ...fixture(), 'src/huge.ts': ' '.repeat(LOCAL_UPLOAD_LIMITS.chars) })).toBeNull();
    expect(provenLocalUploadPath({ ...fixture(), ...Object.fromEntries(Array.from({ length: LOCAL_UPLOAD_LIMITS.files }, (_, i) => [`src/extra${i}.ts`, 'const a=1;'])) })).toBeNull();
    expect(provenLocalUploadPath({ ...fixture(), 'src/wide.ts': ';'.repeat(LOCAL_UPLOAD_LIMITS.tokens + 1) })).toBeNull();
    expect(provenLocalUploadPath({ ...fixture(), 'src/deep.ts': `const a=${'('.repeat(65)}1${')'.repeat(65)};` })).toBeNull();
    let now = 0;
    expect(provenLocalUploadPath(fixture(), () => now += LOCAL_UPLOAD_LIMITS.milliseconds + 1)).toBeNull();
  });
  it('leaves all existing project-marker stand-downs in place and adds only upload proof', () => {
    const scanner = readFileSync('src/server/AgentV3/fakeFeatureScan.ts', 'utf8');
    expect(scanner).toContain("if (!storage) add('upload', file, firstHit(content, UPLOAD_CLAIM_RE));");
    expect(scanner.match(/provenLocalUploadPath\(/g)).toHaveLength(1);
    expect(scanner).toContain("add('upload', upload.file, upload, 'local-upload-path')");
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('fakeFeatures: fakeFeatures.map((f) => f.kind),\n          fakeFeatureEvidence: fakeFeatures,');
  });
});

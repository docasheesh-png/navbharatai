import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'static-site',
  version: '1.0.0',
  scripts: {
    dev: 'npx http-server . -p 3000 -c-1 --cors -o',
    start: 'npx http-server . -p 3000 -c-1 --cors',
    build: 'echo "Static site — no build step needed"',
  },
  devDependencies: {},
}, null, 2);

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Static Site</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="starter">
      <h1 class="nb-gradient-text">Hello World!</h1>
      <p id="message">Edit <code>index.html</code>, <code>style.css</code>, and <code>script.js</code> to get started.</p>
      <button id="btn" class="btn-primary">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`;

// 🎨 SCOPED TO THE STARTER PAGE (2026-09-30). These rules used to be page-wide — `* { margin: 0; padding:
// 0 }`, a centred dark `body`, a solid indigo `button` — and they sit AFTER the design kit, so on every
// plain-HTML app they overrode the kit's element layer: every button the same flat fill, every list
// indent gone, every page centred. They style the Hello World markup above and nothing else, so the
// app the model writes in its place gets the kit.
const STYLE_CSS = `.starter {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
}

.starter h1 {
  font-size: clamp(2.25rem, 6vw, 3.5rem);
  margin: 0;
}

.starter p {
  color: var(--muted);
  margin: 0;
}
`;

const SCRIPT_JS = `const btn = document.getElementById('btn');
const msg = document.getElementById('message');
let count = 0;

btn.addEventListener('click', () => {
  count++;
  msg.textContent = \`Button clicked \${count} time\${count === 1 ? '' : 's'}!\`;
});
`;

export class StaticProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'index.html': INDEX_HTML,
      'style.css': DESIGN_KIT_CSS + '\n\n' + STYLE_CSS,
      'script.js': SCRIPT_JS,
    };
  }
}

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
    <main>
      <h1>Hello World!</h1>
      <p id="message">Edit <code>index.html</code>, <code>style.css</code>, and <code>script.js</code> to get started.</p>
      <button id="btn">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`;

const STYLE_CSS = `*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

main {
  text-align: center;
  padding: 2rem;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

p {
  color: #94a3b8;
  margin-bottom: 1.5rem;
}

button {
  background: #6366f1;
  color: white;
  border: none;
  padding: 0.6rem 1.4rem;
  border-radius: 0.5rem;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: #4f46e5;
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

// The framework catalog shown in the Pro v5.0 "Choose Framework" picker. Plain data (no React) so both
// the picker component AND a server-side PARITY TEST can import it — the test asserts every id here maps
// to a real TemplateRegistry scaffold, so a picker option can never be a dead end (admin sync request
// 2026-07-20: "yeh sab sync nahi hai … sabhi ko sync karo"). Every id below is a TemplateRegistry key.

export interface FrameworkOption {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'fullstack' | 'backend' | 'static';
  language: string;
  color: string;
  iconChar: string;
}

export const FRAMEWORK_OPTIONS: FrameworkOption[] = [
  // React ecosystem
  { id: 'vite-react', name: 'React + Vite', description: 'Fast SPA, React 18', category: 'frontend', language: 'TypeScript', color: '#61DAFB', iconChar: '⚛' },
  { id: 'nextjs', name: 'Next.js', description: 'SSR + App Router', category: 'fullstack', language: 'TypeScript', color: '#ffffff', iconChar: '▲' },
  { id: 'remix', name: 'Remix', description: 'Full-stack, Web standards', category: 'fullstack', language: 'TypeScript', color: '#5B9CF6', iconChar: '💿' },
  { id: 'preact', name: 'Preact', description: '3kB React alternative', category: 'frontend', language: 'TypeScript', color: '#673AB8', iconChar: '💜' },
  // Vue
  { id: 'vue', name: 'Vue 3 + Vite', description: 'Composition API', category: 'frontend', language: 'TypeScript', color: '#42B883', iconChar: '🟢' },
  { id: 'nuxt', name: 'Nuxt 3', description: 'Vue + SSR + auto-imports', category: 'fullstack', language: 'TypeScript', color: '#00DC82', iconChar: '🟩' },
  // Svelte
  { id: 'svelte', name: 'Svelte + Vite', description: 'Compile-time, no vdom', category: 'frontend', language: 'TypeScript', color: '#FF3E00', iconChar: '🔥' },
  { id: 'sveltekit', name: 'SvelteKit', description: 'Full-stack Svelte', category: 'fullstack', language: 'TypeScript', color: '#FF3E00', iconChar: '⚡' },
  // Other frontend
  { id: 'solid', name: 'SolidJS', description: 'Fine-grained reactivity', category: 'frontend', language: 'TypeScript', color: '#2C4F7C', iconChar: '🔷' },
  { id: 'angular', name: 'Angular', description: 'Enterprise, Google', category: 'frontend', language: 'TypeScript', color: '#DD0031', iconChar: '🔴' },
  { id: 'astro', name: 'Astro', description: 'Content-first, 0 JS', category: 'frontend', language: 'TypeScript', color: '#FF5D01', iconChar: '🚀' },
  { id: 'lit', name: 'Lit', description: 'Web Components', category: 'frontend', language: 'TypeScript', color: '#324FFF', iconChar: '💡' },
  { id: 'alpine', name: 'Alpine.js', description: 'Lightweight reactivity', category: 'frontend', language: 'JavaScript', color: '#8BC0D0', iconChar: '🏔' },
  { id: 'vanilla', name: 'Vanilla TS', description: 'No framework, pure control', category: 'frontend', language: 'TypeScript', color: '#3178C6', iconChar: '📄' },
  // Node backends
  { id: 'node-express', name: 'Express.js', description: 'Minimal Node HTTP', category: 'backend', language: 'TypeScript', color: '#68A063', iconChar: '🚂' },
  { id: 'hono', name: 'Hono', description: 'Ultrafast edge API', category: 'backend', language: 'TypeScript', color: '#E36002', iconChar: '🔥' },
  { id: 'nestjs', name: 'NestJS', description: 'Enterprise Node + DI', category: 'backend', language: 'TypeScript', color: '#E0234E', iconChar: '🐈' },
  { id: 'fastify', name: 'Fastify', description: 'High-performance Node', category: 'backend', language: 'TypeScript', color: '#ffffff', iconChar: '⚡' },
  // Python
  { id: 'python-fastapi', name: 'FastAPI', description: 'Async Python + OpenAPI', category: 'backend', language: 'Python', color: '#009688', iconChar: '🐍' },
  { id: 'django', name: 'Django', description: 'Batteries-included ORM', category: 'fullstack', language: 'Python', color: '#44B78B', iconChar: '🎸' },
  { id: 'flask', name: 'Flask', description: 'Lightweight micro-framework', category: 'backend', language: 'Python', color: '#ffffff', iconChar: '🌶' },
  // JVM / Go backends — run on the fullstack sandbox (JDK 17 + Maven, Go 1.23, Mongo, Redis)
  { id: 'spring-boot', name: 'Spring Boot', description: 'Java 17 + Maven REST API', category: 'backend', language: 'Java', color: '#6DB33F', iconChar: '🍃' },
  { id: 'go', name: 'Go', description: 'Fast net/http backend', category: 'backend', language: 'Go', color: '#00ADD8', iconChar: '🐹' },
  // Static
  { id: 'static', name: 'Static HTML', description: 'Plain HTML/CSS/JS, no build', category: 'static', language: 'JavaScript', color: '#E34F26', iconChar: '🌐' },
];

/** Just the ids — for parity checks against the server TemplateRegistry. */
export const FRAMEWORK_OPTION_IDS: readonly string[] = FRAMEWORK_OPTIONS.map((f) => f.id);

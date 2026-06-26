export interface FrameworkMeta {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'fullstack' | 'backend' | 'static';
  language: 'TypeScript' | 'JavaScript' | 'Python';
  color: string;
  iconChar: string;
  devPort: number;
  startCommand: string;
}

export const FRAMEWORKS: FrameworkMeta[] = [
  // React ecosystem
  {
    id: 'vite-react',
    name: 'React + Vite',
    description: 'Fast SPA with Vite bundler and React 18',
    category: 'frontend',
    language: 'TypeScript',
    color: '#61DAFB',
    iconChar: '⚛',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'React framework with SSR, SSG, and App Router',
    category: 'fullstack',
    language: 'TypeScript',
    color: '#000000',
    iconChar: '▲',
    devPort: 3000,
    startCommand: 'npm run dev',
  },
  {
    id: 'remix',
    name: 'Remix',
    description: 'Full-stack web framework built on React and Web standards',
    category: 'fullstack',
    language: 'TypeScript',
    color: '#E8F2FF',
    iconChar: '💿',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  // Vue ecosystem
  {
    id: 'vue',
    name: 'Vue 3 + Vite',
    description: 'Progressive JS framework with Composition API',
    category: 'frontend',
    language: 'TypeScript',
    color: '#42B883',
    iconChar: '🟢',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  {
    id: 'nuxt',
    name: 'Nuxt 3',
    description: 'Vue meta-framework with SSR and auto-imports',
    category: 'fullstack',
    language: 'TypeScript',
    color: '#00DC82',
    iconChar: '🟩',
    devPort: 3000,
    startCommand: 'npm run dev',
  },
  // Svelte ecosystem
  {
    id: 'svelte',
    name: 'Svelte + Vite',
    description: 'Compile-time framework — no virtual DOM',
    category: 'frontend',
    language: 'TypeScript',
    color: '#FF3E00',
    iconChar: '🔥',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    description: 'Full-stack Svelte framework with file-based routing',
    category: 'fullstack',
    language: 'TypeScript',
    color: '#FF3E00',
    iconChar: '⚡',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  // Angular
  {
    id: 'angular',
    name: 'Angular',
    description: 'Enterprise-grade TypeScript framework by Google',
    category: 'frontend',
    language: 'TypeScript',
    color: '#DD0031',
    iconChar: '🔴',
    devPort: 4200,
    startCommand: 'npm run dev',
  },
  // Astro
  {
    id: 'astro',
    name: 'Astro',
    description: 'Content-first framework — ships zero JS by default',
    category: 'frontend',
    language: 'TypeScript',
    color: '#FF5D01',
    iconChar: '🚀',
    devPort: 4321,
    startCommand: 'npm run dev',
  },
  // Vanilla
  {
    id: 'vanilla',
    name: 'Vanilla TS',
    description: 'TypeScript + Vite — no framework, full control',
    category: 'frontend',
    language: 'TypeScript',
    color: '#3178C6',
    iconChar: '📄',
    devPort: 5173,
    startCommand: 'npm run dev',
  },
  // Node.js backends
  {
    id: 'node-express',
    name: 'Express.js',
    description: 'Minimal Node.js HTTP server — fast to prototype',
    category: 'backend',
    language: 'TypeScript',
    color: '#68A063',
    iconChar: '🚂',
    devPort: 3000,
    startCommand: 'npm run dev',
  },
  {
    id: 'nestjs',
    name: 'NestJS',
    description: 'Enterprise Node.js framework with decorators & DI',
    category: 'backend',
    language: 'TypeScript',
    color: '#E0234E',
    iconChar: '🐈',
    devPort: 3000,
    startCommand: 'npm run dev',
  },
  {
    id: 'fastify',
    name: 'Fastify',
    description: 'High-performance Node.js web framework with schema validation',
    category: 'backend',
    language: 'TypeScript',
    color: '#000000',
    iconChar: '⚡',
    devPort: 3000,
    startCommand: 'npm run dev',
  },
  // Python backends
  {
    id: 'python-fastapi',
    name: 'FastAPI',
    description: 'Modern Python API framework — async, OpenAPI auto-docs',
    category: 'backend',
    language: 'Python',
    color: '#009688',
    iconChar: '🐍',
    devPort: 8000,
    startCommand: 'bash dev.sh',
  },
  {
    id: 'django',
    name: 'Django',
    description: 'Batteries-included Python web framework with ORM + admin',
    category: 'fullstack',
    language: 'Python',
    color: '#092E20',
    iconChar: '🎸',
    devPort: 8000,
    startCommand: 'bash dev.sh',
  },
  {
    id: 'flask',
    name: 'Flask',
    description: 'Lightweight Python micro-framework — minimal, flexible',
    category: 'backend',
    language: 'Python',
    color: '#000000',
    iconChar: '🌶',
    devPort: 5000,
    startCommand: 'bash dev.sh',
  },
  // Static
  {
    id: 'static',
    name: 'Static HTML',
    description: 'Plain HTML/CSS/JS — no build step, served directly',
    category: 'static',
    language: 'JavaScript',
    color: '#E34F26',
    iconChar: '🌐',
    devPort: 3000,
    startCommand: 'npx serve . -p 3000 -s',
  },
];

export const FRAMEWORK_MAP = new Map<string, FrameworkMeta>(FRAMEWORKS.map(f => [f.id, f]));

export function getFramework(id: string): FrameworkMeta | undefined {
  return FRAMEWORK_MAP.get(id);
}

export const DEFAULT_FRAMEWORK = 'vite-react';

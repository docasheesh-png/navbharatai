/**
 * G6 — Dependency auto-sync.
 *
 * After AI generation, every bare package imported by source files is checked
 * against package.json. Any that are missing are automatically declared so the
 * generated app can actually install and run (prevents the #1 "app generated but
 * won't run" failure for VFS-tier builds).
 *
 * Pure + dependency-free — VFS in, VFS out. Never throws. No-op for static
 * projects (no package.json).
 */
import { VirtualFileSystem } from './ProjectModel';
import { extractBareImports, collectDeclaredDeps } from './ProjectVerifier';

/** Curated pinned versions for the packages NavBharatAI's generator reaches for most.
 *  Unknown packages fall back to 'latest' (npm resolves the real version at install time). */
const KNOWN_VERSIONS: Record<string, string> = {
  // Routing
  'react-router-dom': '^6.26.0',
  // State management
  'zustand': '^4.5.0',
  'immer': '^10.1.0',
  'jotai': '^2.9.0',
  // HTTP
  'axios': '^1.7.0',
  // Forms
  'react-hook-form': '^7.52.0',
  'zod': '^3.23.0',
  // UI utilities
  'clsx': '^2.1.0',
  'tailwind-merge': '^2.4.0',
  'class-variance-authority': '^0.7.0',
  // Date/time
  'date-fns': '^3.6.0',
  'dayjs': '^1.11.11',
  // Animation
  'framer-motion': '^11.3.0',
  // Icons
  'lucide-react': '^0.400.0',
  'react-icons': '^5.2.0',
  // IDs
  'uuid': '^10.0.0',
  // Data fetching
  '@tanstack/react-query': '^5.51.0',
  // Charts
  'recharts': '^2.12.0',
  // Notifications
  'react-hot-toast': '^2.4.0',
  'sonner': '^1.5.0',
  // Radix UI
  '@radix-ui/react-dialog': '^1.1.0',
  '@radix-ui/react-dropdown-menu': '^2.1.0',
  '@radix-ui/react-tabs': '^1.1.0',
  '@radix-ui/react-tooltip': '^1.1.0',
  '@radix-ui/react-select': '^2.1.0',
  // Utilities
  'lodash': '^4.17.21',
  'lodash-es': '^4.17.21',
  // DnD
  '@dnd-kit/core': '^6.1.0',
  '@dnd-kit/sortable': '^8.0.0',
  // Real-time
  'socket.io-client': '^4.7.0',
  // Maps
  'react-leaflet': '^4.2.1',
  'leaflet': '^1.9.4',
  // Excel / PDF
  'xlsx': '^0.18.5',
  'jspdf': '^2.5.1',
  // QR codes
  'qrcode.react': '^4.0.0',
  // Markdown
  'react-markdown': '^9.0.0',
  'marked': '^13.0.0',
  // Syntax highlighting
  'highlight.js': '^11.10.0',
  'prismjs': '^1.29.0',
  // Validation
  'yup': '^1.4.0',
  // HTTP alternative
  'swr': '^2.2.5',
  // i18n
  'i18next': '^23.12.0',
  'react-i18next': '^15.0.0',
  // Misc UI
  'react-select': '^5.8.0',
  'react-datepicker': '^7.3.0',
  '@hello-pangea/dnd': '^16.6.0',
  // Svelte runtime (plugin goes in devDeps — see KNOWN_DEV_VERSIONS)
  'svelte': '^4.2.19',
  // Backend-as-a-service SDKs
  'pocketbase': '^0.21.0',
  'convex': '^1.13.0',
  // Firebase client SDK
  'firebase': '^10.13.0',
  // Supabase client SDK
  '@supabase/supabase-js': '^2.45.0',
  // Stripe frontend
  '@stripe/stripe-js': '^4.4.0',
  '@stripe/react-stripe-js': '^2.8.0',
  // Auth
  '@clerk/clerk-react': '^5.7.0',
  'next-auth': '^4.24.0',
  // ORM / DB clients
  '@prisma/client': '^5.19.0',
  // More Radix UI components
  '@radix-ui/react-accordion': '^1.2.0',
  '@radix-ui/react-alert-dialog': '^1.1.0',
  '@radix-ui/react-avatar': '^1.1.0',
  '@radix-ui/react-checkbox': '^1.1.0',
  '@radix-ui/react-label': '^2.1.0',
  '@radix-ui/react-popover': '^1.1.0',
  '@radix-ui/react-progress': '^1.1.0',
  '@radix-ui/react-radio-group': '^1.2.0',
  '@radix-ui/react-scroll-area': '^1.1.0',
  '@radix-ui/react-separator': '^1.1.0',
  '@radix-ui/react-sheet': '^1.1.0',
  '@radix-ui/react-slider': '^1.2.0',
  '@radix-ui/react-switch': '^1.1.0',
  '@radix-ui/react-toggle': '^1.1.0',
  // Headless UI (Tailwind-friendly)
  '@headlessui/react': '^2.1.0',
  // Data tables
  '@tanstack/react-table': '^8.20.0',
  // Virtualisation
  '@tanstack/react-virtual': '^3.10.0',
  // Full TanStack stack
  '@tanstack/react-router': '^1.57.0',
  // tRPC
  '@trpc/client': '^11.0.0',
  '@trpc/react-query': '^11.0.0',
  '@trpc/server': '^11.0.0',
  // 3D / WebGL
  'three': '^0.168.0',
  '@react-three/fiber': '^8.17.0',
  '@react-three/drei': '^9.109.0',
  // Charts
  'chart.js': '^4.4.4',
  'react-chartjs-2': '^5.2.0',
  'd3': '^7.9.0',
  // Flow diagrams
  'reactflow': '^11.11.4',
  // Code editor
  '@monaco-editor/react': '^4.6.0',
  // Rich text
  '@tiptap/react': '^2.7.0',
  '@tiptap/starter-kit': '^2.7.0',
  'react-quill': '^2.0.0',
  // Virtual scrolling
  'react-window': '^1.8.10',
  'react-virtualized': '^9.22.5',
  // Carousel
  'embla-carousel-react': '^8.3.0',
  // File uploads
  'react-dropzone': '^14.2.3',
  // Camera / media
  'react-webcam': '^7.2.0',
  // Barcode / QR
  'jsbarcode': '^3.11.6',
  // PDF viewer
  'react-pdf': '^9.1.0',
  // Gesture / touch
  '@use-gesture/react': '^10.3.1',
  // Spring animation
  '@react-spring/web': '^9.7.4',
  // GSAP animation
  'gsap': '^3.12.5',
  // Confetti
  'canvas-confetti': '^1.9.3',
  // Country / timezone data
  'country-list': '^2.3.0',
  'countries-and-timezones': '^3.6.0',
  // Currency formatting
  'currency.js': '^2.0.4',
  // Lottie animations
  'lottie-react': '^2.4.0',
  // Color pickers
  'react-colorful': '^5.6.1',
  // Appwrite
  'appwrite': '^16.0.0',
};

/** Packages that belong in devDependencies (build tools, type declarations, test infra). */
const KNOWN_DEV_VERSIONS: Record<string, string> = {
  // TypeScript type stubs
  '@types/react': '^18.3.3',
  '@types/react-dom': '^18.3.0',
  '@types/node': '^20.14.0',
  '@types/lodash': '^4.17.0',
  '@types/lodash-es': '^4.17.12',
  '@types/uuid': '^10.0.0',
  '@types/leaflet': '^1.9.12',
  '@types/prismjs': '^1.26.4',
  // CSS toolchain
  'autoprefixer': '^10.4.19',
  'postcss': '^8.4.40',
  // Tailwind
  'tailwindcss': '^3.4.7',
  '@tailwindcss/vite': '^4.0.0',
  // Vite plugins
  '@vitejs/plugin-react': '^4.3.1',
  '@vitejs/plugin-vue': '^5.1.0',
  '@sveltejs/vite-plugin-svelte': '^3.1.2',
  // Testing
  'vitest': '^2.0.0',
  '@testing-library/react': '^16.0.0',
  '@testing-library/user-event': '^14.5.0',
  'happy-dom': '^14.12.0',
};

const DEFAULT_VERSION = 'latest';

export interface DependencySyncResult {
  added: string[];
  addedDev: string[];
}

/**
 * Ensure every bare package imported by the project's source files is declared
 * in package.json (dependencies or devDependencies). Writes the updated
 * package.json back into the VFS only when at least one package was added.
 * Best-effort: never throws.
 */
export function syncDependencies(vfs: VirtualFileSystem): DependencySyncResult {
  const text = vfs.readText('package.json');
  if (!text) return { added: [], addedDev: [] };
  let pkg: any;
  try { pkg = JSON.parse(text); } catch { return { added: [], addedDev: [] }; }

  const declared = collectDeclaredDeps(vfs) ?? new Set<string>();
  const imported = extractBareImports(vfs);
  const added: string[] = [];
  const addedDev: string[] = [];

  pkg.dependencies = pkg.dependencies || {};
  for (const name of imported) {
    if (declared.has(name)) continue;
    if (KNOWN_DEV_VERSIONS[name] !== undefined) {
      // Build tool / type declaration — belongs in devDependencies
      pkg.devDependencies = pkg.devDependencies || {};
      pkg.devDependencies[name] = KNOWN_DEV_VERSIONS[name];
      addedDev.push(name);
    } else {
      pkg.dependencies[name] = KNOWN_VERSIONS[name] ?? DEFAULT_VERSION;
      added.push(name);
    }
  }

  if (added.length || addedDev.length) {
    added.sort();
    addedDev.sort();
    vfs.write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  }
  return { added, addedDev };
}

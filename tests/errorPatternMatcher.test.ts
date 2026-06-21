import { describe, it, expect } from 'vitest';
import { matchErrorPatterns, hintForInstruction } from '../src/server/project/ErrorPatternMatcher';

describe('matchErrorPatterns', () => {
  it('returns empty array for empty string', () => {
    expect(matchErrorPatterns('')).toEqual([]);
  });

  it('matches Cannot find module errors', () => {
    const hints = matchErrorPatterns("Cannot find module 'axios'");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('package.json');
  });

  it('matches ERESOLVE peer dependency errors', () => {
    const hints = matchErrorPatterns('npm ERESOLVE could not resolve peer dep');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('--legacy-peer-deps');
  });

  it('matches named export errors', () => {
    const hints = matchErrorPatterns("'Button' is not exported from './components'");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('named export');
  });

  it('matches unclosed JSX tag errors', () => {
    const hints = matchErrorPatterns('Expected corresponding JSX closing tag for <div>');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('closing tag');
  });

  it('matches React is not defined', () => {
    const hints = matchErrorPatterns('ReferenceError: React is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('React');
  });

  it('matches tailwind not found errors', () => {
    const hints = matchErrorPatterns('Error: tailwindcss not found in node_modules');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Tailwind');
  });

  it('matches SyntaxError unexpected token', () => {
    const hints = matchErrorPatterns('SyntaxError: Unexpected token }');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Syntax error');
  });

  it('matches React hooks rules violations', () => {
    const hints = matchErrorPatterns('React Hook "useState" cannot be called conditionally');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('top level');
  });

  it('deduplicates identical hints from multiple matches', () => {
    // Two 'Cannot find module' errors should only produce one hint entry
    const errorText = "Cannot find module 'react'\nCannot find module 'axios'";
    const hints = matchErrorPatterns(errorText);
    const unique = new Set(hints);
    expect(hints.length).toBe(unique.size);
  });

  it('returns empty for unrecognized errors', () => {
    const hints = matchErrorPatterns('Some completely unknown error XYZ123');
    expect(hints).toEqual([]);
  });

  it("matches '@/' path alias not configured errors", () => {
    const hints = matchErrorPatterns("Cannot find module '@/components/Button'");
    expect(hints.length).toBeGreaterThan(0);
    // The @/-specific hint should appear somewhere in the results
    expect(hints.some(h => h.includes('@/'))).toBe(true);
  });

  it('matches Node.js global (process) not defined in browser', () => {
    const hints = matchErrorPatterns('ReferenceError: process is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('process');
  });

  it('matches localStorage not defined (SSR)', () => {
    const hints = matchErrorPatterns('ReferenceError: localStorage is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('localStorage');
  });

  it('matches PostCSS/Tailwind Unknown at rule error', () => {
    const hints = matchErrorPatterns('Unknown at rule @tailwind');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('postcss.config');
  });

  it('matches Objects are not valid as a React child', () => {
    const hints = matchErrorPatterns('Objects are not valid as a React child (found: object with keys {name, value})');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('JSON.stringify');
  });

  it('matches missing key prop warning', () => {
    const hints = matchErrorPatterns('Each child in a list should have a unique "key" prop.');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('key');
  });

  it('matches Firebase invalid API key error', () => {
    const hints = matchErrorPatterns('FirebaseError: Firebase: Error (auth/invalid-api-key).');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('VITE_FIREBASE_API_KEY');
  });

  it('matches CORS policy blocked error', () => {
    const hints = matchErrorPatterns('Access to fetch at http://localhost:3001/api has been blocked by CORS policy');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('CORS');
  });

  it('matches Next.js getStaticProps SSR error', () => {
    const hints = matchErrorPatterns("Error: 'getStaticProps' is not exported from this file");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(h => h.includes('App Router'))).toBe(true);
  });

  it('matches Maximum update depth exceeded (infinite re-render)', () => {
    const hints = matchErrorPatterns('Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate.');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('dependency array');
  });

  it('matches useRouter from wrong Next.js package', () => {
    const hints = matchErrorPatterns("Error: useRouter only works within next/navigation, not next/router");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain("next/navigation");
  });

  it('matches invalid hook call error', () => {
    const hints = matchErrorPatterns('Invalid hook call. Hooks can only be called inside of the body of a function component.');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('function component');
  });

  it('matches React hydration mismatch error', () => {
    const hints = matchErrorPatterns('Error: Hydration failed because the initial UI does not match what was rendered on the server.');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('useEffect');
  });
});

describe('hintForInstruction', () => {
  it('returns empty for empty instruction', () => {
    expect(hintForInstruction('')).toEqual([]);
  });

  it('returns tailwind hint for tailwind instructions', () => {
    const hints = hintForInstruction('Build a dashboard with Tailwind CSS');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Tailwind');
  });

  it('returns supabase hint for supabase instructions', () => {
    const hints = hintForInstruction('Create an app with Supabase authentication');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Supabase');
  });

  it('returns react-router hint for routing instructions', () => {
    const hints = hintForInstruction('Build a multi-page app with routing');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Router');
  });

  it('returns zustand hint for state management instructions', () => {
    const hints = hintForInstruction('Add zustand for state management');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Zustand');
  });

  it('returns no hints for generic instructions', () => {
    const hints = hintForInstruction('Build a simple counter app');
    expect(hints).toEqual([]);
  });

  it('returns multiple hints for multi-technology instructions', () => {
    const hints = hintForInstruction('Build with Tailwind CSS and Supabase auth');
    expect(hints.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates identical hints', () => {
    const hints = hintForInstruction('tailwind tailwind css tailwindcss');
    const unique = new Set(hints);
    expect(hints.length).toBe(unique.size);
  });

  it('returns stripe hint for stripe/payment instructions', () => {
    const hints = hintForInstruction('Build a checkout page with Stripe payment');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Stripe');
  });

  it('returns clerk hint for auth/authentication instructions', () => {
    const hints = hintForInstruction('Add Clerk authentication to the app');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Clerk');
  });

  it('returns pocketbase hint for pocketbase instructions', () => {
    const hints = hintForInstruction('Build a CRUD app with PocketBase backend');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('PocketBase');
  });

  it('returns convex hint for convex instructions', () => {
    const hints = hintForInstruction('Build a todo app with Convex backend');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(h => h.includes('Convex'))).toBe(true);
  });

  it('returns three.js hint for 3D/WebGL instructions', () => {
    const hints = hintForInstruction('Build a 3D scene with Three.js');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Canvas');
  });

  it('returns prisma hint for ORM/database instructions', () => {
    const hints = hintForInstruction('Use Prisma ORM for the database layer');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('server');
  });

  it('returns appwrite hint for appwrite instructions', () => {
    const hints = hintForInstruction('Build a todo app with Appwrite as backend');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Appwrite');
  });
});

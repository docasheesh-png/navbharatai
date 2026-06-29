import { describe, it, expect } from 'vitest';
import { extractEntities, entityRequirementsContext } from '../src/server/AgentV3/EntityExtractor';

/** P-AI.4 — NLU entity recognition + slot filling (pure). */

describe('EntityExtractor — extractEntities', () => {
  it('extracts named services into slots', () => {
    const e = extractEntities('build me a shop with Razorpay and Supabase');
    expect(e).toEqual([
      { slot: 'payment', name: 'Razorpay' },
      { slot: 'database', name: 'Supabase' },
    ]);
  });

  it('recognizes dotted/multi-word brands (Next.js, Socket.io, Google Maps)', () => {
    expect(extractEntities('a Next.js app').some((x) => x.name === 'Next.js')).toBe(true);
    expect(extractEntities('realtime chat with Socket.io').some((x) => x.name === 'Socket.IO')).toBe(true);
    expect(extractEntities('show stores on Google Maps').some((x) => x.name === 'Google Maps')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(extractEntities('use STRIPE for payments').some((x) => x.name === 'Stripe')).toBe(true);
    expect(extractEntities('tailwind please').some((x) => x.name === 'Tailwind CSS')).toBe(true);
  });

  it('matches whole words only — no substring false positives', () => {
    // "stripey" / "fireball" must NOT match Stripe / Firebase.
    expect(extractEntities('a stripey striped pattern')).toEqual([]);
    expect(extractEntities('a fireball game')).toEqual([]);
  });

  it('does not match ambiguous common English words', () => {
    expect(extractEntities('render the square in the segment')).toEqual([]);
  });

  it('de-duplicates a service named twice', () => {
    const e = extractEntities('Razorpay checkout, then more Razorpay');
    expect(e.filter((x) => x.name === 'Razorpay')).toHaveLength(1);
  });

  it('returns [] for empty / plain prompts', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities('build me a nice todo app')).toEqual([]);
    expect(extractEntities(null)).toEqual([]);
  });

  it('handles a multi-slot prompt', () => {
    const names = extractEntities('Next.js app, Clerk auth, Stripe payments, deploy to Vercel, emails via Resend')
      .map((x) => x.name);
    expect(names).toContain('Next.js');
    expect(names).toContain('Clerk');
    expect(names).toContain('Stripe');
    expect(names).toContain('Vercel');
    expect(names).toContain('Resend');
  });
});

describe('EntityExtractor — entityRequirementsContext', () => {
  it('renders a requirements block grouped by slot', () => {
    const ctx = entityRequirementsContext(extractEntities('shop with Razorpay, Stripe and Supabase'));
    expect(ctx).toContain('DETECTED REQUIREMENTS');
    expect(ctx).toContain('Payment gateway: Razorpay, Stripe'); // grouped
    expect(ctx).toContain('Database / persistence: Supabase');
    expect(ctx.toUpperCase()).toContain('MUST USE');
  });

  it('returns empty string when nothing named', () => {
    expect(entityRequirementsContext([])).toBe('');
    expect(entityRequirementsContext(extractEntities('a simple notes app'))).toBe('');
  });
});

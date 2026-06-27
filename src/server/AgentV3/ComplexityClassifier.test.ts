import { describe, it, expect } from 'vitest';
import { decidePlanning } from './ComplexityClassifier';

describe('decidePlanning', () => {
  describe('simple apps → skip', () => {
    it('todo app', () => expect(decidePlanning('build a todo app')).toBe('skip'));
    it('calculator', () => expect(decidePlanning('make a calculator')).toBe('skip'));
    it('timer', () => expect(decidePlanning('create a timer app')).toBe('skip'));
    it('quiz', () => expect(decidePlanning('quiz app banao')).toBe('skip'));
    it('short prompt no signals', () => expect(decidePlanning('make a counter')).toBe('skip'));
    it('hindi simple', () => expect(decidePlanning('ek chota app banao')).toBe('skip'));
    it('expense tracker', () => expect(decidePlanning('expense tracker app')).toBe('skip'));
    it('shopping list', () => expect(decidePlanning('shopping list app')).toBe('skip'));
    it('pomodoro', () => expect(decidePlanning('pomodoro timer')).toBe('skip'));
    it('stopwatch', () => expect(decidePlanning('stopwatch banao')).toBe('skip'));
  });

  describe('complex apps → plan', () => {
    it('auth', () => expect(decidePlanning('app with authentication and login')).toBe('plan'));
    it('payment', () => expect(decidePlanning('build an ecommerce app with payment checkout')).toBe('plan'));
    it('dashboard', () => expect(decidePlanning('admin dashboard banao')).toBe('plan'));
    it('realtime', () => expect(decidePlanning('realtime chat app')).toBe('plan'));
    it('database', () => expect(decidePlanning('app with database and supabase integration')).toBe('plan'));
    it('multi-page', () => expect(decidePlanning('multi-page website with routing')).toBe('plan'));
    it('backend api', () => expect(decidePlanning('build a REST API server with express')).toBe('plan'));
    it('user roles', () => expect(decidePlanning('app with user roles and permissions')).toBe('plan'));
    it('jwt', () => expect(decidePlanning('jwt based auth system')).toBe('plan'));
    it('long prompt no signals', () => {
      const long = 'a'.repeat(401);
      expect(decidePlanning(long)).toBe('plan');
    });
  });

  describe('edge cases', () => {
    it('todo app with auth → plan wins', () =>
      expect(decidePlanning('todo app with login and authentication')).toBe('plan'));
    it('empty string → skip', () => expect(decidePlanning('')).toBe('skip'));
    it('medium length no signals → skip', () =>
      expect(decidePlanning('build a nice weather display that shows temperature and forecast')).toBe('skip'));
  });
});

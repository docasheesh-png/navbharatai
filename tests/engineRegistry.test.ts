import { describe, it, expect } from 'vitest';
import { EngineRegistry, EngineType } from '../src/server/AppMakerLab/generator/EngineRegistry';
import type { IGenerationEngine } from '../src/server/AppMakerLab/generator/IGenerationEngine';

function stubEngine(): IGenerationEngine {
  return { execute: async () => [] };
}

describe('EngineRegistry', () => {
  it('has() returns false for an unregistered engine type', () => {
    const r = new EngineRegistry();
    expect(r.has(EngineType.DEFAULT)).toBe(false);
  });

  it('has() returns true after registering an engine', () => {
    const r = new EngineRegistry();
    r.register(EngineType.FRONTEND, stubEngine());
    expect(r.has(EngineType.FRONTEND)).toBe(true);
  });

  it('get() throws when the engine type is not registered', () => {
    const r = new EngineRegistry();
    expect(() => r.get(EngineType.BACKEND)).toThrow('Engine not registered for type: BACKEND');
  });

  it('get() returns the registered engine', () => {
    const r = new EngineRegistry();
    const eng = stubEngine();
    r.register(EngineType.DATABASE, eng);
    expect(r.get(EngineType.DATABASE)).toBe(eng);
  });

  it('later register() overwrites a previously registered engine for the same type', () => {
    const r = new EngineRegistry();
    const eng1 = stubEngine();
    const eng2 = stubEngine();
    r.register(EngineType.LLM, eng1);
    r.register(EngineType.LLM, eng2);
    expect(r.get(EngineType.LLM)).toBe(eng2);
  });

  it('different engine types are independent', () => {
    const r = new EngineRegistry();
    r.register(EngineType.FRONTEND, stubEngine());
    expect(r.has(EngineType.BACKEND)).toBe(false);
    expect(r.has(EngineType.FRONTEND)).toBe(true);
  });
});

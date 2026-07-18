import { describe, it, expect } from 'vitest';
import {
  parseTeaching, addMemory, removeMemory, buildMemory, makeKeywords,
  loadMemories, saveMemories, OFFLINE_MEMORY_KEY, MEMORY_MAX_ITEMS, type UserMemory,
} from './offlineMemory';
import { answerOffline, recallMemory } from './offlineAssistant';

describe('offlineMemory — user-taught, on-device, deterministic (not ML training)', () => {
  it('parses "remember …" as a free-text fact', () => {
    expect(parseTeaching('remember that my gate code is 4821')).toEqual({ kind: 'fact', text: 'my gate code is 4821' });
    expect(parseTeaching('note: buy milk')).toEqual({ kind: 'fact', text: 'buy milk' });
    expect(parseTeaching('yaad rakho ki meeting 5 baje hai')).toEqual({ kind: 'fact', text: 'meeting 5 baje hai' });
  });

  it('parses explicit "when I ask X answer Y" as a Q→A', () => {
    expect(parseTeaching('when I ask my name answer Aashish')).toEqual({ kind: 'qa', trigger: 'my name', text: 'Aashish' });
    expect(parseTeaching('jab main office address puchu to Sector 5, Noida')).toEqual({ kind: 'qa', trigger: 'office address', text: 'Sector 5, Noida' });
  });

  it('parses a definition ("X means Y" / "X ka matlab Y") as a Q→A', () => {
    expect(parseTeaching('json means javascript object notation')).toEqual({ kind: 'qa', trigger: 'json', text: 'javascript object notation' });
    expect(parseTeaching('supabase ka matlab ek open source firebase')).toEqual({ kind: 'qa', trigger: 'supabase', text: 'ek open source firebase' });
  });

  it('does NOT treat a math equation or a plain question as teaching', () => {
    expect(parseTeaching('2+2=4')).toBeNull();          // an equation, computed — not taught
    expect(parseTeaching('what is my wifi password')).toBeNull(); // a question
    expect(parseTeaching('iska matlab kya hai')).toBeNull();      // a question, not a definition
    expect(parseTeaching('how do i deploy')).toBeNull();
    expect(parseTeaching('')).toBeNull();
  });

  it('makeKeywords keeps meaningful words only (drops stopwords / short tokens < 3 chars)', () => {
    // "my" and "is" are stopwords; "nb" is dropped for being < 3 chars.
    expect(makeKeywords('my wifi password is NB@1234')).toEqual(['wifi', 'password', '1234']);
  });

  it('addMemory appends immutably; a same-trigger Q→A replaces; identical facts de-dup', () => {
    let list: UserMemory[] = [];
    list = addMemory(list, parseTeaching('when I ask my name answer Aashish')!, 'a', 1);
    list = addMemory(list, parseTeaching('when I ask my name answer Aashish Kumar')!, 'b', 2); // same trigger → replace
    expect(list.length).toBe(1);
    expect(list[0].text).toBe('Aashish Kumar');

    let facts = addMemory([], parseTeaching('remember buy milk')!, 'c', 3);
    const before = facts;
    facts = addMemory(facts, parseTeaching('remember buy milk')!, 'd', 4); // identical fact → no dup
    expect(facts.length).toBe(1);
    expect(before).not.toBe(facts); // still a new array (immutable)
  });

  it('addMemory caps the list at MEMORY_MAX_ITEMS (drops oldest)', () => {
    let list: UserMemory[] = [];
    for (let i = 0; i < MEMORY_MAX_ITEMS + 5; i++) list = addMemory(list, { kind: 'fact', text: `fact number ${i}` }, `id${i}`, i);
    expect(list.length).toBe(MEMORY_MAX_ITEMS);
    expect(list[list.length - 1].text).toBe(`fact number ${MEMORY_MAX_ITEMS + 4}`); // newest kept
  });

  it('removeMemory drops one by id, immutably', () => {
    const list = addMemory([], { kind: 'fact', text: 'x' }, 'keep-me', 1);
    expect(removeMemory(list, 'keep-me')).toEqual([]);
    expect(removeMemory(list, 'nope')).toEqual(list);
  });

  it('recalls exactly what was taught — a fact by keyword and a Q→A by its trigger', () => {
    let mem: UserMemory[] = [];
    mem = addMemory(mem, parseTeaching('remember that my wifi password is NB@1234')!, 'a', 1);
    mem = addMemory(mem, parseTeaching('when I ask my name answer Aashish')!, 'b', 2);

    const wifi = answerOffline('what is my wifi password', new Date(), mem);
    expect(wifi.kind).toBe('answer');
    expect(wifi.answerKind).toBe('memory');
    expect(wifi.answerText).toBe('my wifi password is NB@1234');

    const name = answerOffline('my name', new Date(), mem);
    expect(name.answerKind).toBe('memory');
    expect(name.answerText).toBe('Aashish');
  });

  it('recall is deterministic — it returns the STORED text verbatim, never a generated guess', () => {
    const mem = addMemory([], parseTeaching('when I ask secret answer 42-alpha-zeta')!, 'a', 1);
    // Asking something unrelated must NOT surface the secret (no fuzzy over-reach into memory).
    expect(recallMemory(mem, 'how do i deploy an app')).toBeNull();
    // Asking the trigger returns exactly the taught value.
    expect(recallMemory(mem, 'secret')?.text).toBe('42-alpha-zeta');
  });

  it('a taught memory does not override a real math answer', () => {
    const mem = addMemory([], parseTeaching('remember two plus two')!, 'a', 1);
    expect(answerOffline('2+2', new Date(), mem).answerText).toContain('4');
  });

  it('load/save round-trips via an injected storage and is corruption-safe', () => {
    const bag: Record<string, string> = {};
    const store = { getItem: (k: string) => bag[k] ?? null, setItem: (k: string, v: string) => { bag[k] = v; } };
    const list = addMemory([], parseTeaching('remember hello world')!, 'a', 1);
    saveMemories(list, store);
    expect(bag[OFFLINE_MEMORY_KEY]).toBeTruthy();
    expect(loadMemories(store)).toEqual(list);

    bag[OFFLINE_MEMORY_KEY] = 'not json {{{';
    expect(loadMemories(store)).toEqual([]); // malformed → safe empty
    bag[OFFLINE_MEMORY_KEY] = JSON.stringify([{ id: 'x' }, { bad: true }]); // wrong shape → filtered out
    expect(loadMemories(store)).toEqual([]);
  });

  it('buildMemory keys a Q→A on its trigger and a fact on its text', () => {
    expect(buildMemory({ kind: 'qa', trigger: 'my name', text: 'Aashish' }, 'a', 1).keywords).toEqual(['name']);
    expect(buildMemory({ kind: 'fact', text: 'buy fresh milk' }, 'b', 2).keywords).toEqual(['buy', 'fresh', 'milk']);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EDITOR_CAPABILITIES,
  hasEditorCapability,
  availableItems,
  type CapabilityGated,
} from './editorCapabilities';

const src = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');

describe('availableItems — the gate itself', () => {
  it('keeps everything that depends on nothing', () => {
    const items = [{ id: 'a' }, { id: 'b' }] as (CapabilityGated & { id: string })[];
    expect(availableItems(items)).toHaveLength(2);
  });

  it('drops an item whose capability is absent', () => {
    const items: (CapabilityGated & { id: string })[] = [
      { id: 'plain' },
      { id: 'needs-ai', requires: 'inlineAiSuggestions' },
    ];
    const kept = availableItems(items).map((i) => i.id);
    expect(kept).toEqual(EDITOR_CAPABILITIES.inlineAiSuggestions ? ['plain', 'needs-ai'] : ['plain']);
  });

  it('🔒 treats an UNKNOWN capability as absent, never as present', () => {
    // A typo in a `requires` value must hide the control, not silently offer it. Failing the other
    // way would recreate the exact bug this file exists for, via a spelling mistake.
    const items = [{ id: 'x', requires: 'notARealCapability' }] as unknown as CapabilityGated[];
    expect(availableItems(items)).toEqual([]);
    expect(hasEditorCapability('notARealCapability' as never)).toBe(false);
  });

  it('does not mutate the list it is given', () => {
    const items: CapabilityGated[] = [{ requires: 'inlineAiSuggestions' }, {}];
    const before = items.length;
    availableItems(items);
    expect(items).toHaveLength(before);
  });
});

describe('🔒 the flag cannot claim more than the code delivers', () => {
  // THE POINT OF THIS TEST. `inlineAiSuggestions` is a claim that something registers an inline
  // completions provider. If the flag says true while no such call exists, the four AI shortcuts
  // come back and go straight back to doing nothing — the original bug, restored by a one-word edit.
  // So the flag is checked against the real source, not trusted.
  const providerRegistered = (() => {
    for (const f of ['CodeStudio.tsx', 'VirtualKeyboard.tsx', 'editorCapabilities.ts']) {
      try {
        if (/registerInlineCompletionsProvider\s*\(/.test(src(f))) return true;
      } catch { /* file may not exist in a future refactor — absence is not proof of presence */ }
    }
    return false;
  })();

  it('inlineAiSuggestions is true ONLY if a provider is really registered', () => {
    expect(EDITOR_CAPABILITIES.inlineAiSuggestions).toBe(providerRegistered);
  });

  it('records the honest state today: no provider, so the capability is off', () => {
    // When the autocomplete engine ships, this expectation is the one to update — deliberately, in
    // the same change that registers the provider, so the two can never disagree.
    expect(providerRegistered).toBe(false);
    expect(hasEditorCapability('inlineAiSuggestions')).toBe(false);
  });
});

describe('🔒 the four AI shortcuts are gated, not merely present', () => {
  const vk = src('VirtualKeyboard.tsx');

  it('every inlineSuggest shortcut declares the capability it needs', () => {
    // Read the real shortcut lines rather than importing the component (which would drag in React,
    // motion and lucide for a data assertion).
    const lines = vk.split('\n').filter((l) => l.includes('inlineSuggest'));
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toContain("requires: 'inlineAiSuggestions'");
    }
  });

  it('the list is gated BEFORE search, so a hidden shortcut cannot be run by pressing Enter', () => {
    // Gating at render only would still leave the entry in `filtered`, which feeds both the keyboard
    // navigation index and handleRun — the command would fire with nothing behind it.
    const gate = vk.indexOf('availableItems(VS_CODE_SHORTCUTS)');
    const search = vk.indexOf('.includes(search.toLowerCase())');
    expect(gate).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(search);
  });
});

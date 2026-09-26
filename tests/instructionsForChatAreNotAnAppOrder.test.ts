import { describe, it, expect } from 'vitest';
import { classifyIntentSmartDetailed, namesSomethingToBuild } from '../src/server/AgentV3/IntentClassifier';

/**
 * Admin report f2ff962f (2026-09-12): the whole message was a set of chat instructions — be an expert
 * assistant, call me Boss, answer in Hindi, never guess — with no build verb and nothing to build.
 * Its only evidence for `new_build` was its LENGTH, and when the intent reader could not answer, that
 * guess stood: an app nobody asked for was built and a free user was billed ₹79.15.
 */
const REPORT = `एक Expert AI Assistant हो।

- हर उत्तर में मुझे Boss कहो और मुख्य बातचीत हिंदी (देवनागरी) में करो। Technical Terms को English में ही रखो।
- User के Goal के अनुसार अपना Role खुद तय करो और उसी के अनुसार उत्तर दो।
- उत्तर देने से पहले अपनी जानकारी और Logic को Self-Check करो। गलती मिले तो खुद सुधारो।
- Guess मत करो। जानकारी कम, अस्पष्ट या महत्वपूर्ण तथ्य missing हों तो पहले स्पष्ट सवाल पूछो।
- उत्तर सीधा, उपयोगी, सटीक और जरूरत के अनुसार संक्षिप्त रखो।`;

const readerDown = async () => { throw new Error('provider down'); };
const readerSays = (w: string) => async () => w;

describe('instructions for chat are not an app order', () => {
  it('🔴 the exact report message, reader down → chat, not a build', async () => {
    const r = await classifyIntentSmartDetailed(REPORT, readerDown);
    expect(r.intent).toBe('chat');
  });

  it('when the reader answers, the reader decides — nothing about the normal path moved', async () => {
    expect((await classifyIntentSmartDetailed(REPORT, readerSays('build'))).intent).toBe('new_build');
    expect((await classifyIntentSmartDetailed(REPORT, readerSays('chat'))).intent).toBe('chat');
  });

  it('🔒 a long message that DOES name something to build still builds when the reader is down', async () => {
    const english = 'A simple expense tracker where users can add expenses with category, see monthly totals and export the list to CSV for their accountant, doubt free.';
    expect(namesSomethingToBuild(english)).toBe(true);
    // A HIGH english spec never even reaches the reader.
    expect((await classifyIntentSmartDetailed(english, readerDown)).intent).toBe('new_build');
    const hindi = 'मुझे एक दुकान के लिए बिलिंग सिस्टम बनाना है जिसमें GST बिल, ग्राहक की सूची, रोज़ की बिक्री का हिसाब, स्टॉक की गिनती और महीने की रिपोर्ट हो ताकि मैं सब एक जगह देख सकूँ';
    expect(namesSomethingToBuild(hindi)).toBe(true);
  });

  it('the report message names nothing to build', () => {
    expect(namesSomethingToBuild(REPORT)).toBe(false);
  });
});

/**
 * failedbr #2086 (2026-11-08, "Make an app like instagram with games…"): the roadmap's step 1 said "Create a React
 * Native app with Firebase authentication" though the user named no stack and the project is a Vite web app. The fast
 * lane planned react-navigation and react-native-paper, nothing compiled, and the full builder spent the rest of the
 * run converting it to web until the user stopped. A native stack nobody asked for is a planner choice (BR1952's class).
 */
import { describe, expect, it } from 'vitest';
import { roadmapGuardrail } from '../src/server/lib/megaRoadmap';

const ORIGINAL = 'Make an app like instagram with games name it the ig play where everything is like instagram calling, chating,reel,post,story';
const STEP1 = 'Create a React Native app with Firebase authentication. Build profile screen with name, bio, profile picture upload.';
const roadmap = (first: string) => ({
  userMessage: 'core first', achievableSummary: 'posts, stories, chat', note: null,
  steps: [
    { title: 'Basic Profile & Feed', goal: 'User can create a profile and post', buildPrompt: first, needsInfra: null },
    { title: 'Stories & Reels', goal: 'User can post stories', buildPrompt: 'Add a story creation screen with image capture and a viewer.', needsInfra: null },
    { title: 'Chat', goal: 'Users can message each other', buildPrompt: 'Build a chat list and conversation screens with message input.', needsInfra: null },
  ],
});

describe('a roadmap step never invents a native mobile stack over a Vite web project', () => {
  it('the report\'s own step 1 is rejected, so the build goes direct on the selected stack', () => {
    const r = roadmapGuardrail(roadmap(STEP1), 'Instagram', { framework: 'vite-react', originalRequest: ORIGINAL });
    expect(r.roadmap).toBeNull();
    expect(r.rejected.join(' ')).toMatch(/native mobile stack is a planner choice/);
  });
  it.each(['Flutter', 'Expo', 'SwiftUI'])('%s the same', (stack) => {
    expect(roadmapGuardrail(roadmap(`Create a ${stack} app with a feed and profile screen.`), null, { framework: 'vite-react', originalRequest: ORIGINAL }).roadmap).toBeNull();
  });
  it('a user who asked for React Native keeps the roadmap', () => {
    expect(roadmapGuardrail(roadmap(STEP1), null, { framework: 'vite-react', originalRequest: `${ORIGINAL} in React Native` }).roadmap).not.toBeNull();
  });
  it('a web step keeps the roadmap', () => {
    expect(roadmapGuardrail(roadmap('Create a React web app with a profile screen and a scrollable feed.'), null, { framework: 'vite-react', originalRequest: ORIGINAL }).roadmap).not.toBeNull();
  });
});

// failedbr #1222 (2026-11-20): "Mujhe ek ai banana hai jo kisi api par depend na ho" (an AI that must not depend on any API)
// was handed NavBharatAI's API client, with every lane call told "do NOT write any other AI client".
import { describe, expect, it } from 'vitest';
import { laneAiClient } from '../src/server/AgentV3/SimpleBuilder';

const ON = { APP_AI_GATEWAY: 'on' } as NodeJS.ProcessEnv;

describe('an AI that must not depend on an API gets no API client (failedbr #1222)', () => {
  it.each(['Mujhe ek ai banana hai jo kisi api par depend na ho or Mayry paas Sirf android phone hai', 'an AI chat that does not depend on any API', 'bina kisi api ke ai banao', 'ai assistant jo api pe depend nahi kare'])('no client: %s', (p) => {
    expect(laneAiClient(p, 'vite-react', ON)).toBeNull();
  });
  it.each(['make an ai chat app', 'expense tracker that categorises with ai'])('still wired: %s', (p) => {
    expect(laneAiClient(p, 'vite-react', ON)).not.toBeNull();
  });
});

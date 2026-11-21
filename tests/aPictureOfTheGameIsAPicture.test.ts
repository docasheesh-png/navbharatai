// failedbr #1350 (2026-11-20): "Make a image of the game" was built as a NEW GAME — game domain, a 12-file kit, a silent
// 121 s first call, stopped by the user. `game` was the picture's subject, and the software test read it as the app.
import { describe, expect, it } from 'vitest';
import { isPictureRequest } from '../src/server/AgentV3/pictureRequest';

describe("a picture's subject is not the thing to build (failedbr #1350)", () => {
  it.each(['Make a image of the game', 'game ki photo banao', 'draw a picture of the app icon'])('picture: %s', (m) => {
    expect(isPictureRequest(m)).toBe(true);
  });
  it.each(['create an image generator app', 'make a photo gallery', 'image slider banao', 'Create a block game', 'make an image of the game for my app', 'photo editor app banao'])('still builds: %s', (m) => {
    expect(isPictureRequest(m)).toBe(false);
  });
});

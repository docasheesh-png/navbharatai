// Admin 2026-10-01, with a screenshot of "My profile" in App Mart reading "NavBharatAI creator" over a
// letter N: "naam etc dikhayi nahi de raha hai. wahi par edit button dedo! jo settings me profile edit kar
// sakte hai, wahi yaha bhi edit kar sake! photo bhi laga sake!!!"
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseAvatarUpload, avatarVerdict, publicPhotoUrl, avatarUrl, MAX_AVATAR_BYTES, PROFILE_AVATARS_COLLECTION,
} from '../src/server/lib/profileAvatar';
import { profileTextAbuse } from '../src/server/routes/profile';
import { squareCropRect, AVATAR_SIZE } from '../src/lib/avatarImage';
import { USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';

const read = (p: string) => readFileSync(p, 'utf8');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;
const env = { PUBLIC_BASE_URL: '' } as NodeJS.ProcessEnv;

describe('1 · an uploaded photo is judged by its bytes', () => {
  it('a JPEG or PNG passes, and its real type wins over the claimed one', () => {
    expect(parseAvatarUpload(dataUrl('image/jpeg', JPEG))).toMatchObject({ ok: true, mime: 'image/jpeg' });
    expect(parseAvatarUpload(dataUrl('image/jpeg', PNG))).toMatchObject({ ok: true, mime: 'image/png' });
  });

  it('a text file, an SVG, an empty or an oversized upload is refused with a sentence', () => {
    expect(parseAvatarUpload(dataUrl('image/png', Buffer.from('hello world, not a picture')))).toMatchObject({ ok: false });
    expect(parseAvatarUpload(dataUrl('image/svg+xml', Buffer.from('<svg/>')))).toMatchObject({ ok: false });
    expect(parseAvatarUpload('https://example.com/a.jpg')).toMatchObject({ ok: false });
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_AVATAR_BYTES)]);
    expect(parseAvatarUpload(dataUrl('image/jpeg', big))).toEqual({ ok: false, error: 'That photo is too large. Please choose a smaller one.' });
  });
});

describe('2 · it is public, so only a clear SAFE lets it be saved', () => {
  it('reads the one-word verdict; anything unclear is not safe', () => {
    expect(avatarVerdict('SAFE')).toBe('safe');
    expect(avatarVerdict(' safe.')).toBe('safe');
    expect(avatarVerdict('UNSAFE')).toBe('unsafe');
    expect(avatarVerdict('NOT SAFE')).toBe('unknown');
    expect(avatarVerdict('')).toBe('unknown');
    expect(avatarVerdict(null)).toBe('unknown');
  });

  it('the route saves only on "safe": a check that could not run refuses', () => {
    const src = read('src/server/routes/profile.ts');
    expect(src).toMatch(/if \(verdict === 'unsafe'\)[\s\S]{0,200}status\(400\)/);
    expect(src).toMatch(/if \(verdict !== 'safe'\)[\s\S]{0,200}status\(503\)/);
    expect(src.indexOf("if (verdict !== 'safe')")).toBeLessThan(src.indexOf('await saveAvatar('));
  });
});

describe('3 · other people see only a photo we can vouch for', () => {
  it('our uploaded avatar and a Google/GitHub sign-in picture are shown; a pasted URL is not', () => {
    const ours = avatarUrl('abcdefghij', 1790822000000, env);
    expect(ours).toBe('https://navbharatai.com/api/app-mart/avatar/abcdefghij?v=1790822000000');
    expect(publicPhotoUrl(ours, env)).toBe(ours);
    expect(publicPhotoUrl('https://lh3.googleusercontent.com/a/xyz=s96', env)).not.toBe('');
    expect(publicPhotoUrl('https://avatars.githubusercontent.com/u/1?v=4', env)).not.toBe('');
    expect(publicPhotoUrl('https://example.com/me.jpg', env)).toBe('');
    expect(publicPhotoUrl('https://navbharatai.com/api/other', env)).toBe('');
    expect(publicPhotoUrl('http://lh3.googleusercontent.com/a', env)).toBe('');
  });

  it('every person App Mart shows goes through that rule', () => {
    const store = read('src/server/lib/appMartSocialStore.ts');
    expect(store).toContain('photoUrl: publicPhotoUrl(profile?.photoUrl) || publicPhotoUrl(auth?.photoURL),');
    expect(store).not.toMatch(/photoUrl: safePhotoUrl\(/);
  });
});

describe('4 · a public name or bio passes the comments\' word list', () => {
  it('refuses an abusive name or bio, accepts an ordinary one', () => {
    expect(profileTextAbuse({ displayName: 'fuck off', bio: '' })).toMatch(/not allowed on a public profile/);
    expect(profileTextAbuse({ displayName: 'Aashish', bio: 'I build apps for small shops.' })).toBeNull();
  });
});

describe('5 · one editor, in Settings and on the App Mart profile', () => {
  it('both screens render the same ProfileEditForm, and the photo is an upload, not a URL field', () => {
    expect(read('src/components/profile/ProfilePage.tsx')).toContain('<ProfileEditForm');
    expect(read('src/components/profile/ProfilePage.tsx')).not.toContain('Photo URL');
    const sheet = read('src/components/ide/appMart/AppMartSocial.tsx');
    expect(sheet).toContain('<ProfileEditForm');
    expect(sheet).toMatch(/profile\.isMe && !editing[\s\S]{0,300}Edit profile/);
    const form = read('src/components/profile/ProfileEditForm.tsx');
    expect(form).toContain("fetch('/api/profile/photo', { method: 'POST'");
    expect(form).toContain('type="file" accept="image/*"');
  });

  it('the editor starts from what the person saved, sent only on their own profile', () => {
    const route = read('src/server/routes/appMartSocial.ts');
    expect(route).toMatch(/\.\.\.\(viewerUid === uid \? \{ mine: \{/);
    expect(route).toContain('if (viewerUid === uid) forgetPerson(uid);');
    expect(read('src/server/routes/profile.ts')).toMatch(/await userProfileStore\.update\(userId, update\);\n\s*forgetPublicProfile\(userId\);/);
  });

  it('crops the picked photo to a centred square', () => {
    expect(squareCropRect(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(squareCropRect(1080, 1920)).toEqual({ sx: 0, sy: 420, side: 1080 });
    expect(AVATAR_SIZE).toBe(320);
  });
});

describe('6 · the photo is erased with the account', () => {
  it('is in the eraser\'s list and named on the deletion page and in the privacy policy', () => {
    expect(USER_SCOPED_COLLECTIONS).toContainEqual({ collection: PROFILE_AVATARS_COLLECTION, key: { field: 'uid' } });
    expect(read('src/content/legal/accountDeletion.ts')).toContain('the profile photo you uploaded');
    expect(read('src/content/legal/privacyPolicy.ts')).toContain('checked automatically by an AI vision model');
  });
});

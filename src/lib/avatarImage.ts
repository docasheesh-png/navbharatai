// A profile photo, made small in the browser before it is sent (profileAvatar.ts on the server).
//
// A phone photo is 3–8 MB; a profile picture is shown at 84 px at most. So the picked file is centre-
// cropped to a square and drawn at AVATAR_SIZE px as a JPEG — usually 15–40 KB — before upload, which keeps
// the upload fast on a mobile network and far under the server's 300 KB limit.

/** The side of the square that is uploaded, in pixels. */
export const AVATAR_SIZE = 320;

/** The centred square to cut from a w×h picture. PURE. */
export function squareCropRect(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.floor(Math.min(w, h)));
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side };
}

/** Read a picked image file and return a square JPEG data URL. Rejects with a sentence a person can read. */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('Choose a photo.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { sx, sy, side } = squareCropRect(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This device could not prepare the photo.');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('This photo could not be read.'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This photo could not be read. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

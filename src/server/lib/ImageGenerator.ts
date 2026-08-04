// U-4 (verified recipe modules) — image-processing generator (sharp).
//
// Almost every app with user photos (avatars, product images, posts) needs to RESIZE and OPTIMIZE uploads —
// a 5MB phone photo must become a fast web thumbnail, not be served raw. This recipe adds a real SERVER
// helper built on `sharp` (the standard, fast, native image library): resizeImage() to bound dimensions +
// re-encode, and makeThumbnail() for a square crop. Pairs with the storage recipe — resize BEFORE uploading
// so you store small, fast images. PURE builder; complete code, no TODO stubs. Introduces no env keys.
// Unit-tested.

export interface ImageConfig {
  files: Record<string, string>;
  /** sharp is the one dependency (fast native image processing; installs a prebuilt linux binary). */
  dependency: { name: string; version: string };
  instructions: string;
}

const IMAGE_SERVER = `import sharp from 'sharp';

export interface ResizeOptions {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number; // 1..100
}

// Resize (bounded, never upscales) and re-encode an image buffer — turn a heavy upload into a fast web
// asset. Returns the processed Buffer (store it, or send it as the response). Defaults to WebP @ q80.
export async function resizeImage(input: Buffer, opts: ResizeOptions = {}): Promise<Buffer> {
  let img = sharp(input).rotate(); // .rotate() honours EXIF orientation so phone photos aren't sideways
  if (opts.width || opts.height) {
    img = img.resize(opts.width, opts.height, { fit: 'inside', withoutEnlargement: true });
  }
  const format = opts.format ?? 'webp';
  const quality = opts.quality ?? 80;
  return img[format]({ quality }).toBuffer();
}

// A square, center-cropped thumbnail (avatars, grid tiles). Default 200x200 WebP.
export async function makeThumbnail(input: Buffer, size = 200): Promise<Buffer> {
  return sharp(input).rotate().resize(size, size, { fit: 'cover' }).webp({ quality: 75 }).toBuffer();
}
`;

const INSTRUCTIONS =
  'Image processing wired at server/lib/image.ts (add the dependency sharp). Import resizeImage(buffer, ' +
  '{ width: 1200 }) to bound + re-encode an upload (WebP by default), or makeThumbnail(buffer, 200) for a ' +
  'square avatar/tile. Best paired with your file-upload/storage: resize BEFORE storing so you serve small, ' +
  'fast images. Runs on the server (sharp installs a prebuilt native binary); no API key needed.';

export function generateImageIntegration(): ImageConfig {
  return {
    files: { 'server/lib/image.ts': IMAGE_SERVER },
    dependency: { name: 'sharp', version: '^0.33.0' },
    instructions: INSTRUCTIONS,
  };
}

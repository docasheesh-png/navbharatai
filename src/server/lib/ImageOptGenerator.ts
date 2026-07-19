// T2.6 (roadmap 2026-07-19) — Image-optimization generator (Tier-2, performance).
//
// The audit's Performance ❌ included "Image optimization" (no recipe; images shipped raw → slow LCP).
// This emits two real, complementary pieces:
//   • server/lib/optimizeImage.ts — a sharp-based helper that resizes + re-encodes an upload to WebP
//     (or jpeg/png), so a 4 MB phone photo becomes a ~100 KB web image.
//   • src/components/ui/LazyImage.tsx — a dependency-free, CLS-safe <img>: native lazy-loading,
//     async decoding, and required width/height so the layout never jumps.
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface ImageOptResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Generate the image-optimization recipe (sharp server helper + a CLS-safe lazy image). Pure. */
export function generateImageOptimization(): ImageOptResult {
  const serverFile = `import sharp from 'sharp';

// Resize + re-encode an image buffer for the web. WebP by default (best size/quality); pass 'jpeg'/'png'
// if you need wider compatibility. \`withoutEnlargement\` never upscales a small source. Use this on the
// upload path (e.g. right after multer receives the file) before you store it.
export async function optimizeImage(
  input: Buffer,
  opts: { width?: number; format?: 'webp' | 'jpeg' | 'png'; quality?: number } = {},
): Promise<{ data: Buffer; format: string; contentType: string }> {
  const format = opts.format ?? 'webp';
  const quality = opts.quality ?? 80;
  let pipeline = sharp(input).rotate(); // .rotate() honours EXIF orientation
  if (opts.width) pipeline = pipeline.resize({ width: opts.width, withoutEnlargement: true });
  const data = await pipeline[format]({ quality }).toBuffer();
  return { data, format, contentType: \`image/\${format}\` };
}
`;

  const clientFile = `type LazyImageProps = {
  src: string;
  alt: string;
  // width + height are REQUIRED to reserve space and stop layout shift (CLS). Pass the intrinsic size.
  width: number;
  height: number;
  className?: string;
  sizes?: string;
  srcSet?: string;
};

// A CLS-safe, lazy-loading image. Native lazy-loading + async decoding keep it off the critical path,
// and the reserved width/height box means the page never jumps as images arrive.
export function LazyImage({ src, alt, width, height, className, sizes, srcSet }: LazyImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      sizes={sizes}
      srcSet={srcSet}
      loading="lazy"
      decoding="async"
      style={{ maxWidth: '100%', height: 'auto', aspectRatio: \`\${width} / \${height}\` }}
    />
  );
}
`;

  return {
    files: {
      'server/lib/optimizeImage.ts': serverFile,
      'src/components/ui/LazyImage.tsx': clientFile,
    },
    dependencies: [{ name: 'sharp', version: '^0.33' }],
    instructions:
      `Wired image optimization:\n` +
      `  • server/lib/optimizeImage.ts — call optimizeImage(buffer, { width: 1200 }) on the upload path, then ` +
      `store the returned WebP (add the sharp dependency).\n` +
      `  • src/components/ui/LazyImage.tsx — use <LazyImage src alt width height /> instead of <img>; the ` +
      `required width/height prevent layout shift and it lazy-loads off-screen images for a faster LCP.`,
  };
}

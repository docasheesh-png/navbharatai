// SAVE AN IMAGE TO THE DEVICE GALLERY — the one place that knows how the two platforms differ (Q-699).
//
// WHY THIS MODULE EXISTS. "Save to Photos" in the image generator has NEVER saved on Android. The call
// was `savePhoto({ path })`, and `@capacitor-community/media`'s Android code rejects that outright:
//
//     String album = call.getString("albumIdentifier");
//     if (album != null) { albumDir = new File(album); }
//     else { call.reject("Album identifier required", EC_ARG_ERROR); return; }
//
// Every Android tap therefore threw and fell through to the share sheet. Nothing was faked — the
// "Saved to your Photos ✓" note only ever ran on the success path — but the one-tap save the button
// promises was iOS-only.
//
// 🔒 THE TRAP THIS MODULE EXISTS TO AVOID, AND WHY THE FIX IS PLATFORM-BRANCHED RATHER THAN ONE CALL.
// `albumIdentifier` means two DIFFERENT things, and the plugin's own typings say so:
//   • Android — a filesystem PATH (`new File(album)`), and REQUIRED.
//   • iOS     — an opaque PHAssetCollection localIdentifier, and OPTIONAL; an unknown value is
//               rejected with "Unable to find that album".
// So passing Android's path on iOS would BREAK the one platform that currently works. Worse, the
// plugin documents that omitting it on iOS 14+ asks for ADD-ONLY permission instead of full library
// access — so on iOS the current no-identifier call is not merely working, it is the better call.
// iOS behaviour is therefore left byte-for-byte unchanged, and a test locks that.
//
// 🔒 WHY THE PLUGIN'S OWN ALBUM API AND NOT A NEW MediaStore PLUGIN. Q-699 suggested writing through
// Android's MediaStore into Pictures/NavBharatAI. That is the more standard location (it survives an
// uninstall), but it needs new native Java, and this repo has no Android SDK — it could not be
// compiled, let alone run, before shipping. Shipping native code nobody can build is exactly the
// "built but not really working" state the second absolute rule forbids. The plugin's existing album
// API reaches the gallery with ZERO new native code:
//   `_getAlbumsPath()` returns `getExternalMediaDirs()[0]` — the app's own external media directory,
//   which needs NO permission (the plugin's `isStoragePermissionGranted()` returns true outright when
//   `androidGalleryMode` is off, which it is and which a test pins), and which the media scanner
//   indexes, so `scanPhoto()` makes the file appear in the gallery.
// The honest trade is recorded rather than hidden: files under `Android/media/<package>/` are removed
// when the app is uninstalled, and a few OEM galleries index that directory late. The MediaStore route
// remains the better long-term home and stays on the queue for a session that can build Android.
//
// PURE except for the injected `media` object, so every branch above is unit-testable without a device.

/** The album the app's images are collected into, on Android. */
export const GALLERY_ALBUM_NAME = 'NavBharatAI';

/** The slice of `@capacitor-community/media` this module uses — injected, so tests need no plugin. */
export interface MediaLike {
  savePhoto(options: { path: string; albumIdentifier?: string; fileName?: string }): Promise<unknown>;
  getAlbums(): Promise<{ albums: Array<{ identifier: string; name: string }> }>;
  createAlbum(options: { name: string }): Promise<unknown>;
}

/**
 * The name Android's `copyFile` should be given: WITHOUT an extension.
 *
 * 🔒 Caught before shipping by reading the plugin rather than trusting the call. `copyFile` does
 * `fileName + extension`, taking the extension from the SOURCE file — so handing it our already-
 * suffixed `photo.png` writes `photo.png.png` into the user's gallery. The plugin's own typings say
 * the same in one line: "Do not include extension. Android only."
 */
export function albumFileName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return base || fileName;
}

/**
 * The album's identifier on Android, creating the album the first time.
 *
 * `createAlbum` is NOT idempotent — the plugin rejects an existing album with "Album already exists" —
 * so its rejection is swallowed on purpose and the answer always comes from `getAlbums()`, which is
 * the only source that reports the real path. Throws when the album cannot be found afterwards, so a
 * caller can never save "somewhere" it did not verify.
 */
export async function resolveAndroidAlbum(media: MediaLike, name = GALLERY_ALBUM_NAME): Promise<string> {
  const find = async (): Promise<string | null> => {
    const listed = await media.getAlbums();
    const match = listed?.albums?.find((a) => a?.name === name);
    return match?.identifier ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  // Either it is created here, or it already existed and the rejection is noise — `find()` decides.
  await media.createAlbum({ name }).catch(() => undefined);

  const created = await find();
  if (!created) throw new Error(`Could not create or find the "${name}" album`);
  return created;
}

/**
 * Save one image to the device gallery.
 *
 * THROWS on any failure, by contract: the caller falls back to the OS share sheet, and a silent
 * resolve here would turn a failed save into a "Saved to your Photos ✓" the user never got.
 */
export async function saveToGallery(
  media: MediaLike,
  options: { path: string; platform: string; fileName?: string; albumName?: string },
): Promise<void> {
  const { path, platform, fileName } = options;
  if (!path) throw new Error('A file path is required to save to the gallery');

  if (platform === 'android') {
    const albumIdentifier = await resolveAndroidAlbum(media, options.albumName ?? GALLERY_ALBUM_NAME);
    await media.savePhoto({
      path,
      albumIdentifier,
      ...(fileName ? { fileName: albumFileName(fileName) } : {}),
    });
    return;
  }

  // iOS (and any other native platform): EXACTLY the call that already works — `path` alone.
  // `fileName` is documented "Android only" (iOS names the asset with a UUID), so sending it here
  // would change the one platform that works in exchange for nothing.
  await media.savePhoto({ path });
}

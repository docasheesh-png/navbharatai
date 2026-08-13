import { useRef, useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, FileText, Paperclip, Folder, FolderOpen } from 'lucide-react';
import { isFolderImportSupported } from '../lib/folderImport';
import { zipAccept } from '../lib/zipPicker';

// Shared attach menu (admin 2026-07-12): tapping the 📎 attach button opens a 3-option sheet —
// Take Photo (camera) / Choose photo or video (gallery) / Choose file — the SAME everywhere
// (NavBharatAI Free, Pro v5.0, and every Professional AI). Before this, the button opened the file
// picker directly, so the camera was never offered. Each option is a real, separate <input>:
//   • Take Photo         → accept="image/*" capture="environment" → opens the camera on mobile.
//   • Choose photo/video → accept="image/*,video/*"               → opens the gallery.
//   • Choose file        → the caller's own `accept` (docs, code, zip, …) → opens Files.
// On desktop `capture` is ignored and every option opens a normal file dialog — graceful everywhere.

export interface AttachMenuProps {
  /** Called with the picked files from whichever option the user chose. */
  onFiles: (files: FileList | null) => void;
  /** `accept` for the "Choose file" option (the caller's supported types). */
  fileAccept: string;
  /** Allow selecting multiple files (default true). */
  multiple?: boolean;
  /** Disable the whole control (e.g. while a build/turn is running). */
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  buttonClassName?: string;
  /** Accessible label for the trigger button. */
  title?: string;
  /** Optional count bubble on the button (e.g. number of files already attached). */
  badge?: number;
  /**
   * When provided, the menu shows a DEDICATED "Import project (.zip)" option (admin 2026-07-28).
   *
   * A zip is not an attachment — it is a PROJECT IMPORT, and treating the two the same is what broke
   * large uploads: a zip picked through "Choose file" was base64-encoded into the build request and
   * died against Cloud Run's ~32 MB per-request cap. This option hands the File straight to the caller,
   * which uploads it in chunks and lands it in the workspace/IDE — no build request, no base64, no cap.
   * Given its own picker so a project can never accidentally take the attachment path again.
   */
  onZipProject?: (file: File) => void;
  /** Open a project FOLDER directly (Chrome/Edge desktop). The menu hides it where unsupported. */
  onOpenFolder?: () => void;
}

export function AttachMenu({
  onFiles,
  fileAccept,
  multiple = true,
  disabled = false,
  buttonClassName = '',
  title = 'Attach',
  badge,
  onZipProject,
  onOpenFolder,
}: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside tap / Escape (matches the rest of the app's popovers).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (ref: React.RefObject<HTMLInputElement | null>) => {
    setOpen(false);
    // Let the menu close before the native picker opens (iOS is picky about this ordering).
    setTimeout(() => ref.current?.click(), 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.target.value = ''; // allow re-picking the same file
  };

  const OPTIONS: Array<{ key: string; icon: React.ReactNode; label: string; ref: React.RefObject<HTMLInputElement | null> }> = [
    { key: 'camera', icon: <Camera className="w-4 h-4" />, label: 'Take Photo', ref: cameraRef },
    { key: 'gallery', icon: <ImageIcon className="w-4 h-4" />, label: 'Choose photo or video', ref: galleryRef },
    { key: 'file', icon: <FileText className="w-4 h-4" />, label: 'Choose file', ref: fileRef },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`relative ${buttonClassName || 'h-[42px] w-10 flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-50'}`}
      >
        <Paperclip className="w-4 h-4" />
        {typeof badge === 'number' && badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-500 text-[9px] leading-[14px] text-white text-center">{badge}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 z-[60] min-w-[220px] rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              onClick={() => pick(o.ref)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <span className="text-zinc-400">{o.icon}</span>
              <span>{o.label}</span>
            </button>
          ))}
          {onZipProject && (
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(zipRef)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors border-t border-zinc-800"
            >
              <span className="text-emerald-400"><Folder className="w-4 h-4" /></span>
              <span>Import project (.zip)<span className="block text-[11px] text-zinc-500">Opens your app in Files — any size</span></span>
            </button>
          )}
          {/* OPEN FOLDER — no zip at all. Gated on real capability rather than a browser sniff: the
              File System Access API is Chrome/Edge desktop only, and offering a button that throws on
              Firefox or a phone is worse than not offering it. The .zip option above stays for
              everyone, so nobody loses a way in. */}
          {onOpenFolder && isFolderImportSupported() && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onOpenFolder(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors border-t border-zinc-800"
            >
              <span className="text-sky-400"><FolderOpen className="w-4 h-4" /></span>
              <span>Open project folder<span className="block text-[11px] text-zinc-500">No zipping, no upload of extras — pick the folder itself</span></span>
            </button>
          )}
        </div>
      )}

      {/* Real, separate inputs — each offers a different native source. Hidden; triggered by the menu. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleChange} />
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple={multiple} className="hidden" onChange={handleChange} />
      <input ref={fileRef} type="file" accept={fileAccept} multiple={multiple} className="hidden" onChange={handleChange} />
      {/* Project import — its OWN single-file picker, routed to onZipProject (never onFiles), so a
          project can never re-enter the attachment/base64 path that capped it at 18 MB. */}
      <input
        ref={zipRef}
        type="file"
        accept={zipAccept()}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onZipProject?.(f);
        }}
      />
    </div>
  );
}

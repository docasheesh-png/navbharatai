import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { attachMenuPosition } from '../lib/attachMenuPosition';
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
//
// iOS Safari (admin 2026-10-26 phone report: Free paperclip "does nothing"):
//   1) `display:none` / Tailwind `hidden` file inputs ignore programmatic .click().
//   2) setTimeout(.click) drops the user-gesture, so the picker never opens.
// File/photo rows use direct native inputs. Project ZIP keeps its synchronous gesture-bound picker.

/** Visually hidden but still "visible" to iOS Safari's file-picker gesture rules. */
export const ATTACH_FILE_INPUT_CLASS =
  'nb-attach-file-input absolute top-0 left-0 h-px w-px opacity-0 overflow-clip';

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
  const zipRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  // A fixed child can still be trapped by a transformed/filtered composer ancestor.
  // Portal to body and measure the real trigger/visual viewport instead of guessing 72px.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const vv = window.visualViewport;
      setPosition(attachMenuPosition(trigger.getBoundingClientRect(), {
        left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0,
        width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight,
      }, menu.scrollHeight));
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (menuRef.current) observer?.observe(menuRef.current);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  // Close on outside tap / Escape (matches the rest of the app's popovers).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    // pointerdown covers mouse + touch without the touchstart-then-click race that could
    // dismiss the sheet before a menu item's click fires on some iOS WebKit builds.
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (ref: React.RefObject<HTMLInputElement | null>) => {
    // MUST stay in the same user-gesture turn as the tap — no setTimeout.
    // iOS Safari silently ignores file-input .click() once the gesture is gone.
    ref.current?.click();
    setOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.target.value = ''; // allow re-picking the same file
    setOpen(false);
  };

  const OPTIONS: Array<{ key: string; icon: React.ReactNode; label: string; accept: string; capture?: 'environment' }> = [
    { key: 'camera', icon: <Camera className="w-4 h-4" />, label: 'Take Photo', accept: 'image/*', capture: 'environment' },
    { key: 'gallery', icon: <ImageIcon className="w-4 h-4" />, label: 'Choose photo or video', accept: 'image/*,video/*' },
    { key: 'file', icon: <FileText className="w-4 h-4" />, label: 'Choose file', accept: fileAccept },
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`relative ${buttonClassName || 'h-[42px] w-10 flex items-center justify-center rounded border border-line text-muted hover:text-ink disabled:opacity-50'}`}
      >
        <Paperclip className="w-4 h-4" />
        {typeof badge === 'number' && badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-500 text-[9px] leading-[14px] text-on-accent text-center">{badge}</span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={position}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          role="menu"
          data-attach-menu=""
          className="fixed z-[200] rounded-2xl border border-line bg-card shadow-2xl overflow-y-auto overscroll-contain"
        >
          {OPTIONS.map((o) => (
            <label key={o.key} className="relative w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-body hover:bg-raised focus-within:bg-raised transition-colors">
              <span className="text-muted">{o.icon}</span>
              <span>{o.label}</span>
              {/* The tap lands on the native input itself. No synthetic .click(), no lost
                  user activation in iOS/WKWebView, and the input stays mounted until change. */}
              <input type="file" aria-label={o.label} role="menuitem"
                accept={o.accept || undefined} capture={o.capture}
                multiple={o.capture ? false : multiple} disabled={disabled}
                className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                onChange={handleChange} onCancel={() => setOpen(false)} />
            </label>
          ))}
          {onZipProject && (
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(zipRef)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-body hover:bg-raised transition-colors border-t border-line"
            >
              <span className="text-success"><Folder className="w-4 h-4" /></span>
              <span>Import project (.zip)<span className="block text-[11px] text-faint">Opens your app in Files — any size</span></span>
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
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-body hover:bg-raised transition-colors border-t border-line"
            >
              <span className="text-info"><FolderOpen className="w-4 h-4" /></span>
              <span>Open project folder<span className="block text-[11px] text-faint">No zipping, no upload of extras — pick the folder itself</span></span>
            </button>
          )}
        </div>, document.body
      )}

      {/* Project import — its OWN single-file picker, routed to onZipProject (never onFiles), so a
          project can never re-enter the attachment/base64 path that capped it at 18 MB. */}
      <input
        ref={zipRef}
        type="file"
        accept={zipAccept()}
        className={ATTACH_FILE_INPUT_CLASS}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onZipProject?.(f);
        }}
      />
    </div>
  );
}


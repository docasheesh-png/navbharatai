// "Use my own picture" — the attach + crop control both image generators share
// (admin 2026-09-21: "free/paid dono image generator me image to image ka option bhi add karo, user
// apni photo dal kar usme kuch badalwana chahe to woh badala ja sake").
//
// 🔑 ONE CONTROL, BOTH TIERS. The free generator and the paid studio are two screens with the same
// job here, and a second copy of "attach, crop, show, remove" is how they would end up disagreeing
// about what a picture may be — exactly what `ImageOptionSelect` was extracted to prevent.
//
// 🔒 EVERY ATTACHED PICTURE GOES THROUGH THE CROP EDITOR, and that is a safety property as much as a
// feature: what comes out is a PNG at the request's own pixel size, so a 12 MP phone photo can never
// reach the 8 MB request cap and the user has always SEEN what will be sent.

import { useRef, useState } from 'react';
import { ImagePlus, Pencil, X } from 'lucide-react';
import { ImageCropEditor } from './ImageCropEditor';
import { describeSize } from '../../lib/imageSize';

export interface ReferencePicture {
  /** What is actually sent — a PNG data URL, already cut to `size`. */
  dataUrl: string;
  /** The untouched file, kept so "Adjust" re-cuts from the original instead of a cut of a cut. */
  original: string;
  /** The pixels it was cut to, so a later size change can be pointed out rather than hidden. */
  size: { w: number; h: number };
}

interface Props {
  value: ReferencePicture | null;
  onChange: (next: ReferencePicture | null) => void;
  /** The pixels the request will be made at right now. */
  frame: { w: number; h: number };
  disabled?: boolean;
}

/** Bigger than any phone photo; a genuinely absurd file is refused here rather than at the server. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function ReferenceImagePicker({ value, onChange, frame, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const [error, setError] = useState('');

  const pick = (file: File | null | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not a picture. Please choose a JPG or PNG.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That picture is very large. Please choose one under 25 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url) { setError('That picture could not be read. Please try another one.'); return; }
      setCropping(url);
    };
    reader.onerror = () => setError('That picture could not be read. Please try another one.');
    reader.readAsDataURL(file);
  };

  const sizeChanged = !!value && (value.size.w !== frame.w || value.size.h !== frame.h);

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!value ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-line bg-raised text-xs text-body hover:border-accent-text transition-colors disabled:opacity-40"
        >
          <ImagePlus className="w-3.5 h-3.5 text-accent-text" />
          Change my own picture
        </button>
      ) : (
        <div className="flex items-center gap-2 px-2 py-2 rounded-xl border border-line bg-raised">
          <img
            src={value.dataUrl}
            alt="The picture you attached"
            className="w-10 h-10 rounded-lg object-cover border border-line shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-body truncate">Your picture · {describeSize(value.size.w, value.size.h)}</p>
            <p className="text-[10px] text-faint truncate">
              {sizeChanged
                ? `The size is now ${describeSize(frame.w, frame.h)} — tap Adjust to re-cut it.`
                : 'Describe the change you want, then send.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCropping(value.original)}
            aria-label="Adjust the picture"
            className={`p-1.5 rounded-lg hover:bg-well ${sizeChanged ? 'text-warn' : 'text-muted'}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { onChange(null); setError(''); }}
            aria-label="Remove the picture"
            className="p-1.5 rounded-lg hover:bg-well text-muted"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && <p className="text-[10px] text-warn leading-relaxed">{error}</p>}

      {cropping && (
        <ImageCropEditor
          image={cropping}
          frame={frame}
          onClose={() => setCropping(null)}
          onDone={(dataUrl) => {
            onChange({ dataUrl, original: cropping, size: { w: frame.w, h: frame.h } });
            setCropping(null);
          }}
        />
      )}
    </div>
  );
}

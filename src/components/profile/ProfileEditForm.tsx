// The ONE profile editor (admin 2026-10-01: "jo settings me profile edit kar sakte hai, wahi yaha bhi edit
// kar sake! photo bhi laga sake!!!"). Settings → Profile and the App Mart profile both render this, so the
// two can never offer different fields or save differently.
//
//  • Photo  — upload from the phone or computer (cropped and shrunk in the browser, avatarImage.ts), or
//             remove it. Saved at once on its own route, which checks it before it becomes public.
//  • Name, bio, phone — saved together with "Save changes" (PUT /api/profile). Phone is private.
//
// Colours are theme TOKENS only (tests/themeTokensOnly.test.ts).

import { useRef, useState } from 'react';
import { Camera, Trash2, Save, X, Loader2 } from 'lucide-react';
import { authHeader, authJsonHeaders } from '../../lib/authHeaders';
import { fileToAvatarDataUrl } from '../../lib/avatarImage';

export interface ProfileFields {
  displayName: string;
  bio: string;
  phone: string;
  photoUrl: string;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json() as { error?: unknown };
    return typeof j.error === 'string' && j.error ? j.error : fallback;
  } catch {
    return fallback;
  }
}

export function ProfileEditForm({ initial, onSaved, onCancel, onPhotoChange, showPhone = true, idPrefix = 'profile' }: {
  initial: ProfileFields;
  /** After "Save changes" succeeded. */
  onSaved: () => void;
  onCancel: () => void;
  /** After a photo was uploaded or removed (saved at once — it does not wait for "Save changes"). */
  onPhotoChange?: (photoUrl: string) => void;
  showPhone?: boolean;
  /** Two editors may be on screen at once (a sheet over Settings); their field ids must differ. */
  idPrefix?: string;
}) {
  const [name, setName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [phone, setPhone] = useState(initial.phone);
  const [photoUrl, setPhotoUrl] = useState(initial.photoUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setPhotoBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const res = await fetch('/api/profile/photo', { method: 'POST', headers: await authJsonHeaders(), body: JSON.stringify({ dataUrl }) });
      if (!res.ok) throw new Error(await errorOf(res, 'The photo could not be saved. Please try again.'));
      const j = await res.json() as { photoUrl?: string };
      setPhotoUrl(j.photoUrl ?? '');
      onPhotoChange?.(j.photoUrl ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be saved. Please try again.');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    setError(''); setPhotoBusy(true);
    try {
      const res = await fetch('/api/profile/photo', { method: 'DELETE', headers: await authHeader() });
      if (!res.ok) throw new Error(await errorOf(res, 'The photo could not be removed. Please try again.'));
      setPhotoUrl('');
      onPhotoChange?.('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be removed. Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    setError(''); setSaving(true);
    try {
      const body: Record<string, string> = { displayName: name, bio };
      if (showPhone) body.phone = phone;
      const res = await fetch('/api/profile', { method: 'PUT', headers: await authJsonHeaders(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not save changes. Please try again.'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder-faint focus:outline-none focus:border-accent';
  const labelCls = 'text-[10px] font-black text-muted uppercase tracking-widest';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {photoUrl ? (
          <img src={photoUrl} alt="Your profile photo" referrerPolicy="no-referrer" className="w-16 h-16 rounded-full object-cover border border-line bg-raised" />
        ) : (
          <span aria-hidden className="w-16 h-16 rounded-full border border-line bg-raised flex items-center justify-center text-xl font-black text-muted">
            {(name.trim() || '?').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Choose a profile photo" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-raised border border-line text-xs font-bold text-ink hover:bg-raised-hover disabled:opacity-50">
            {photoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} {photoUrl ? 'Change photo' : 'Add photo'}
          </button>
          {photoUrl && (
            <button type="button" onClick={() => void removePhoto()} disabled={photoBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line text-xs font-bold text-muted hover:bg-raised disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-faint">Your photo, name and bio are shown on your App Mart profile and next to your comments.</p>

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-name`} className={labelCls}>Display name</label>
        <input id={`${idPrefix}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your name" className={fieldCls} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-bio`} className={labelCls}>Bio</label>
        <textarea id={`${idPrefix}-bio`} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={2}
          placeholder="A short description about yourself" className={`${fieldCls} resize-none`} />
      </div>
      {showPhone && (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-phone`} className={labelCls}>Phone (private — never shown)</label>
          <input id={`${idPrefix}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="+91 XXXXX XXXXX" className={fieldCls} />
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={() => void save()} disabled={saving || photoBusy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-on-accent text-xs font-black disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save changes
        </button>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-raised text-muted text-xs font-bold hover:bg-raised-hover">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

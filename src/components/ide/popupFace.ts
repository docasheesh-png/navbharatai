/** Which face of the Shortcuts popup is showing (admin 2026-09-24). Remembered across opens. */
export type PopupFace = 'shortcuts' | 'custom';
export const POPUP_FACE_KEY = 'ide_shortcutsPopupFace';

interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function readPopupFace(store: KeyValueStore | null | undefined): PopupFace {
  try { return store?.getItem(POPUP_FACE_KEY) === 'custom' ? 'custom' : 'shortcuts'; } catch { return 'shortcuts'; }
}
export function writePopupFace(store: KeyValueStore | null | undefined, face: PopupFace): void {
  try { store?.setItem(POPUP_FACE_KEY, face); } catch { /* session state stands */ }
}

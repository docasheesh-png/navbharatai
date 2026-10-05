import React, { useEffect, useState } from 'react';
import { HardDriveDownload } from 'lucide-react';
import { linkedFolder, onLinkedFolderChange, planWriteBack, writeBackToFolder, writeBackSummary } from '../../lib/folderWriteBack';

/**
 * "Save to folder" (queue Q-160). Shown only when this project was opened from a folder on this computer
 * (Open Folder, Chrome/Edge desktop). Writes the changed and new files back on a press, after a confirmation
 * that names the folder and the count — never deletes, never overwrites a file edited on disk since.
 */
export function SaveToFolderButton({ files }: { files: Record<string, string> }): React.ReactElement | null {
  const [folder, setFolder] = useState(linkedFolder());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => onLinkedFolderChange(() => { setFolder(linkedFolder()); setNote(''); }), []);
  if (!folder) return null;

  const save = async () => {
    const plan = planWriteBack(files, folder.original);
    if (plan.refused) { setNote(plan.refused); return; }
    if (plan.write.length === 0) { setNote(`Nothing has changed since "${folder.name}" was opened.`); return; }
    if (!window.confirm(`Write ${plan.write.length} changed file(s) into your folder "${folder.name}"? Nothing will be deleted, and a file you changed on your computer since will not be overwritten.`)) return;
    setBusy(true);
    try {
      setNote(writeBackSummary(await writeBackToFolder(folder, files), folder.name));
    } catch (e) {
      setNote(`Could not save to the folder: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => void save()}
        disabled={busy}
        title={note || `Save your changes into "${folder.name}" on this computer`}
        className="flex items-center gap-1 px-2.5 py-1 bg-raised hover:bg-raised-hover border border-line rounded-lg text-[9px] font-black uppercase tracking-wider text-muted hover:text-ink transition-all active:scale-95"
      >
        <HardDriveDownload className="w-3 h-3" /> {busy ? 'Saving…' : 'Save to folder'}
      </button>
      {note && <span role="status" className="max-w-[16rem] truncate text-[9px] text-muted" title={note}>{note}</span>}
    </span>
  );
}

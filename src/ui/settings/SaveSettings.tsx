import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { bitRougePersistence } from '../../platform';
import { downloadSaveBackup } from '../../platform/saveBackup';
import { importSave, readSaveFile, saveFileName, saveFileText } from '../../platform/saveTransfer';
import { useInnerBack } from '../shell/backGuard';
import { IS_SANDBOX, sandboxPersistence } from '../shell/sandbox';
import { useShell } from '../storeHooks';

/** How long an armed Import or Reset key waits for the second tap; then it disarms, as the HUD's End round does. */
const CONFIRM_MS = 5000;
/** Far above any real save; stops a stray large file from being read into memory. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

interface Status { readonly text: string; readonly bad: boolean }

/** Export, import and reset. Import and reset take two taps in place; Escape and Back cancel an armed key. */
export function SaveSettings() {
  const shell = useShell(), picker = useRef<HTMLInputElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [status, setStatus] = useState<Status>({ text: '', bad: false });
  /** A file that passed the save parser and waits for the second tap. */
  const [staged, setStaged] = useState<string | null>(null), [resetArmed, setResetArmed] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const disarm = () => { clearTimeout(timer.current); setResetArmed(false); setStaged(null); };
  useInnerBack(() => {
    if (staged === null && !resetArmed) return false;
    disarm(); setStatus({ text: '', bad: false }); return true;
  });

  const exportSave = () => {
    disarm();
    try {
      const now = Date.now();
      downloadSaveBackup(saveFileText(shell.store.getState(), now), saveFileName(now));
      setStatus({ text: 'Save exported.', bad: false });
    } catch { setStatus({ text: 'Could not export the save.', bad: true }); }
  };
  const pressImport = () => {
    clearTimeout(timer.current); setResetArmed(false);
    if (staged === null) { picker.current?.click(); return; }
    const outcome = importSave(staged, IS_SANDBOX ? sandboxPersistence() : bitRougePersistence, Date.now());
    setStaged(null);
    if (outcome.ok) window.location.reload();
    else setStatus({ text: outcome.error, bad: true });
  };
  const picked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let result: ReturnType<typeof readSaveFile>, text = '';
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('size');
      text = await file.text(); result = readSaveFile(text);
    } catch { result = { ok: false, error: 'Could not read the file.' }; }
    clearTimeout(timer.current); setResetArmed(false);
    if (result.ok) {
      setStaged(text); setStatus({ text: 'Valid save. It replaces this game.', bad: false });
      timer.current = setTimeout(() => { setStaged(null); setStatus({ text: '', bad: false }); }, CONFIRM_MS);
    }
    else { setStaged(null); setStatus({ text: result.error, bad: true }); }
  };
  const pressReset = () => {
    clearTimeout(timer.current); setStaged(null);
    if (!resetArmed) {
      setResetArmed(true); setStatus({ text: '', bad: false });
      timer.current = setTimeout(() => setResetArmed(false), CONFIRM_MS);
      return;
    }
    setResetArmed(false);
    const outcome = shell.dispatch({ type: 'reset' });
    setStatus(outcome === null ? { text: 'Reset queued.', bad: false } : outcome.ok ? { text: 'Game reset.', bad: false }
      : { text: outcome.rejection.reason, bad: true });
  };

  return <section className="settings-section settings-save" aria-labelledby="settings-save-title">
    <h2 id="settings-save-title">Save</h2>
    <div className="save-keys">
      <button type="button" className="skey" data-qa-target data-testid="save-export" onClick={exportSave}>Export</button>
      <button type="button" className={`skey${staged === null ? '' : ' warn'}`} data-qa-target data-testid="save-import"
        aria-label={staged === null ? 'Import save' : 'Replace this game? Tap again'} onClick={pressImport}>{staged === null ? 'Import' : 'Replace game?'}</button>
      <input ref={picker} type="file" accept=".json,application/json" hidden tabIndex={-1} data-testid="save-file" onChange={picked} />
    </div>
    <p className={`save-status${status.bad ? ' bad' : ''}`} role="status" data-testid="save-status">{status.text}</p>
    <button type="button" className={`skey save-reset${resetArmed ? ' armed' : ''}`} data-qa-target data-testid="save-reset"
      aria-label={resetArmed ? 'Erase all progress? Tap again' : 'Reset game'} onClick={pressReset}>{resetArmed ? 'Erase all progress?' : 'Reset game'}</button>
  </section>;
}

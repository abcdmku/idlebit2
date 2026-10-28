import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { downloadSaveBackup, readSaveBackup } from '../../platform/saveBackup';
import '../styles/tokens.css';
import '../styles/save-recovery.css';

function SaveRecovery() {
  const [backup] = useState(readSaveBackup), [downloaded, setDownloaded] = useState(false), [error, setError] = useState<string | null>(null);
  const download = () => {
    if (backup.raw === null) return;
    try { downloadSaveBackup(backup.raw); setDownloaded(true); setError(null); }
    catch { setError('Could not download the backup. Try another browser tab.'); }
  };
  return <main className="br-shell save-recovery">
    <section aria-labelledby="recovery-title">
      <h1 id="recovery-title">Save recovery</h1>
      <p>The game is stopped on this page. Your saved progress stays unchanged.</p>
      {backup.error ? <p role="alert">{backup.error}</p> : backup.raw === null
        ? <p>No saved game was found in this browser. Open this page in the browser where the game freezes.</p>
        : <><p>Download a copy of your saved game for troubleshooting.</p>
          <button type="button" data-testid="recovery-download" onClick={download}>Download save backup</button>
          <p className="recovery-status" role="status">{error ?? (downloaded ? 'Backup download started.' : 'Backup ready.')}</p></>}
    </section>
  </main>;
}

export function bootRecovery(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing recovery root');
  createRoot(root).render(<SaveRecovery />);
}

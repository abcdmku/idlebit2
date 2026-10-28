export type SaveBackup = { readonly raw: string | null; readonly error: null } | { readonly raw: null; readonly error: string };

/** Read the original persistence envelope without parsing or loading any simulation state. */
export function readSaveBackup(): SaveBackup {
  try { return { raw: window.localStorage.getItem('idlebit2:save-v3'), error: null }; }
  catch { return { raw: null, error: 'Browser storage is unavailable in this tab.' }; }
}

/** Download a copy; leave the original storage entry unchanged. */
export function downloadSaveBackup(raw: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'idlebit2-save-backup.json';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

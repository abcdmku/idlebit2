import { writeFileSync } from 'node:fs';

/** Windows thumbnail/indexing readers can briefly deny artifact replacement. */
export function writeArtifact(file, bytes, options) {
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(file, bytes, options); return; }
    catch (error) {
      if (attempt >= 5 || !['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * 2 ** attempt);
    }
  }
}

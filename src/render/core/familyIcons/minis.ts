// The task types' 5×5 minis for the sled LCD, whose window is 6 art px tall (a 16 px icon can't fit).
// Chars: . clear, k plate, l/a/d the type ramp, w white. Source: artifacts/icons/index.html (MINI).
import type { TaskType } from './types';

export const TYPE_MINI: Readonly<Record<TaskType, readonly string[]>> = {
  compute: ['.a.a.', 'aaaaa', 'aadaa', 'aaaaa', '.a.a.'],
  parallel: ['aa.aa', 'aa.aa', '.....', 'aa.aa', 'aa.aa'],
  memory: ['.....', 'aaaaa', 'adada', 'aaaaa', 'll.ll'],
  accel: ['laaaa', 'ladda', 'ladda', 'laaaa', 'l.ll.'],
  storage: ['aaaaa', 'allla', 'aldla', 'allla', 'aaada'],
  cluster: ['ddddd', 'dllld', 'ddddd', 'dllld', 'ddddd'],
  zones: ['...aa', 'aa.aa', 'aalaa', 'aa.aa', 'aa.aa'],
  region: ['.aaa.', 'aadaa', '.aaa.', '..a..', 'lllll'],
};

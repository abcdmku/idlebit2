// Display text for world labels (L2 dom.js). Formatting only: every value comes from the snapshot.
const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const SHORT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Whole number with thousands separators: 1,024. */
export function whole(n: number): string { return GROUP.format(Math.floor(n)); }

const SI = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
/** Value with an SI prefix: one decimal at most, past whole units below 1,000. */
function si(v: number, unit: string, wholeBelow = 1e3): string {
  if (v < wholeBelow) return `${whole(v)} ${unit}`;
  let i = 0;
  while (v >= 1e3 && i < SI.length - 1) { v /= 1e3; i++; }
  return `${SHORT.format(v)} ${SI[i]}${unit}`;
}
/** Frequency or link speed: "1,024 Hz", "1 kHz", "2.5 MHz". Bits per second read the same (D10.4). */
export function hertz(hz: number): string {
  if (hz < 1e3 || (hz < 1e4 && hz % 1000 !== 0)) return `${whole(hz)} Hz`;
  return si(hz, 'Hz');
}
const BYTES = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
/** Capacity: "1 bit", "64 bits", "1 KiB", "2.5 MiB". */
export function bitsText(bits: number): string {
  if (bits === 1) return '1 bit';
  if (bits < 1024) return `${whole(bits)} bits`;
  let v = bits / 8 / 1024, i = 0;
  while (v >= 1024 && i < BYTES.length - 1) { v /= 1024; i++; }
  return `${SHORT.format(v)} ${BYTES[i]}`;
}
/** Data rate for storage IO: "4 b/s", "2 kb/s". */
export function bitRate(bitsPerS: number): string { return si(bitsPerS, 'b/s'); }
/** Power: "64 W", "1.2 kW". */
export function wattsText(w: number): string { return si(w, 'W'); }

/** Seconds left on a transfer, one decimal, never below 0.1 while it runs. */
export function secondsText(s: number): string { return `${Math.max(0.1, s).toFixed(1)} s`; }

export function opsText(n: number): string { return n === 1 ? '1 op' : `${whole(n)} ops`; }
export function plural(n: number, one: string, many: string): string { return `${whole(n)} ${n === 1 ? one : many}`; }

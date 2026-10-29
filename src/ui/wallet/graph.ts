import { amount, type Amount, type WalletSample } from '../../game';
import { amountText } from '../hooks/format';

export type Currency = 'credits' | 'data';

export function balanceText(value: Amount): string {
  if (Number.isFinite(Number(value))) return amountText(value);
  const digits = value.replace('-', '');
  return `${value.startsWith('-') ? '-' : ''}${digits[0]}.${digits.slice(1, 3)}e${digits.length - 1}`;
}

/** Axis ticks compact at 1,000; exact tick values stay in the title. */
export function axisText(value: Amount): string {
  const negative = value.startsWith('-'), digits = negative ? value.slice(1) : value;
  if (digits.length <= 3) return value;
  const groups = Math.floor((digits.length - 1) / 3), suffix = ['', 'k', 'M', 'B', 'T'][groups];
  if (!suffix) return `${negative ? '−' : ''}${digits[0]}${digits.slice(1, 3) === '00' ? '' : `.${digits.slice(1, 3).replace(/0+$/, '')}`}e${digits.length - 1}`;
  const head = digits.slice(0, digits.length - groups * 3), tail = digits.slice(head.length, head.length + 2).replace(/0+$/, '');
  return `${negative ? '−' : ''}${head}${tail ? `.${tail}` : ''}${suffix}`;
}

/** Round upward to a whole 1, 2 or 5 times a power of ten. */
function niceStep(value: bigint): bigint {
  if (value <= 1n) return 1n;
  const power = 10n ** BigInt(value.toString().length - 1);
  return [1n, 2n, 5n, 10n].map(n => n * power).find(n => n >= value)!;
}

/** Five evenly spaced, exact ticks. Zero stays in view, including negative Credits. */
export function balanceAxis(values: readonly Amount[]) {
  let min = 0n, max = 0n;
  for (const value of values) {
    const n = BigInt(value);
    if (n < min) min = n;
    if (n > max) max = n;
  }
  let step = niceStep((max - min + 3n) / 4n), low = 0n;
  for (;;) {
    low = (min >= 0n ? min / step : -((-min + step - 1n) / step)) * step;
    if (low + 4n * step >= max) break;
    step = niceStep(step + 1n);
  }
  const high = low + 4n * step;
  const y = (value: Amount) => 240 - Number((BigInt(value) - low) * 240_000n / (high - low)) / 1000;
  return { y, ticks: Array.from({ length: 5 }, (_, i) => amount((high - BigInt(i) * step).toString())) };
}

/** Both currencies share observation times, with independently rounded axes. */
export function balanceGraph(samples: readonly WalletSample[], tick: number, current: { credits: Amount; data: Amount }) {
  const points = samples.map(sample => ({ tick: sample.tick, credits: sample.credits, data: sample.data }));
  const last = points.at(-1);
  if (!last || last.tick !== tick || last.credits !== current.credits || last.data !== current.data) points.push({ tick, ...current });
  const start = points[0]!.tick, end = Math.max(start + 1, tick);
  const x = (at: number) => (at - start) / (end - start) * 1000;
  const series = (kind: Currency) => {
    const axis = balanceAxis(points.map(point => point[kind]));
    const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(point.tick).toFixed(2)},${axis.y(point[kind]).toFixed(2)}`).join(' ');
    return { ...axis, path };
  };
  return { points, start, end: tick, x, credits: series('credits'), data: series('data') };
}

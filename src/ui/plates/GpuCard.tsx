import { useEffect, useRef } from 'react';

/** Static card art ported from the approved GPU plate. Idle fans do not animate. */
export function GpuCard() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 96, 42); g.imageSmoothingEnabled = false;
    const r = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    r(6, 8, 84, 27, '#0e0b1c'); r(8, 9, 80, 17, '#3f3a5a'); r(8, 9, 80, 1, '#8c90ad');
    r(8, 10, 1, 16, '#5b5f7c'); r(8, 26, 80, 8, '#24203a'); r(11, 12, 74, 1, '#7a2a6e');
    for (const x of [27, 66]) {
      r(x - 9, 15, 18, 9, '#0e0b1c'); r(x - 6, 12, 12, 15, '#0e0b1c');
      r(x - 7, 16, 14, 7, '#5b5f7c'); r(x - 4, 14, 8, 11, '#5b5f7c');
      r(x - 5, 16, 5, 3, '#8c90ad'); r(x, 19, 5, 3, '#8c90ad'); r(x - 2, 17, 4, 4, '#24203a');
    }
    for (let x = 13; x < 72; x += 6) r(x, 29, 3, 2, '#0e0b1c');
    r(77, 28, 8, 4, '#5b5f7c'); r(11, 32, 64, 1, '#7a2a6e'); r(17, 35, 58, 3, '#7d5a24');
    for (let x = 19; x < 74; x += 4) r(x, 35, 2, 2, '#e8ae45');
  }, []);
  return <canvas ref={ref} width={96} height={42} aria-hidden="true" />;
}

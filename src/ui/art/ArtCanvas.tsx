import { useEffect, useRef, type CSSProperties } from 'react';

type G = CanvasRenderingContext2D;

/**
 * One piece of shell art: a `w × h` art px canvas shown at exactly N CSS px per art px (rule 2).
 * It redraws when `artKey` changes; `draw` reads only its closure.
 */
export function ArtCanvas({ w, h, n, artKey, draw, className, style }: {
  w: number; h: number; n: number; artKey: string; draw: (g: G) => void; className?: string; style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    drawRef.current(g);
  }, [artKey, w, h]);
  return <canvas ref={ref} width={w} height={h} aria-hidden="true" className={`art${className ? ` ${className}` : ''}`}
    style={{ width: w * n, height: h * n, ...style }} />;
}

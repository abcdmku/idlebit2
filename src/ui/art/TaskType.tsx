import { useEffect, useRef, type CSSProperties } from 'react';
import type { FamilyId } from '../../game';
import { paintTypeIcon, typeColor, typeName, typeOf } from '../../render/core';

/** Set the task's accent and panel rim without tinting its text. */
export function taskTypeStyle(family: FamilyId | undefined): CSSProperties {
  if (family === undefined) return {};
  const color = typeColor(typeOf(family));
  return { '--task-color': color, '--rim': color } as CSSProperties;
}

/** One art pixel wide, anchored to the card's grid-aligned left edge. */
export function TaskAccent({ n }: { n: number }) {
  return <i className="task-accent" aria-hidden="true" data-free="art" style={{ left: 0, top: 0, bottom: 0, width: n }} />;
}

/** A type label beside an existing family display. The painter preserves integer art pixels. */
export function TaskTypeLabel({ family, n }: { family: FamilyId; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null), type = typeOf(family);
  useEffect(() => {
    if (ref.current) paintTypeIcon(ref.current, type, n);
  }, [type, n]);
  return <span className="task-type" style={{ color: typeColor(type) }} data-task-type={type}>
    <canvas ref={ref} width={16 * n} height={16 * n} aria-hidden="true" />{typeName(type)}
  </span>;
}

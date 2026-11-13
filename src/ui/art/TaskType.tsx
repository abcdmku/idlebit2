import type { CSSProperties } from 'react';
import type { FamilyId } from '../../game';
import { typeColor, typeOf } from '../../render/core';

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

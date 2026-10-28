import { formatSize, type SystemSnapshot } from '../../../game';
import { P, R } from '../../core';
import type { LabelWriter, WorldFrame } from '../../core';
import { BOARD } from './layout';

const rows = [{ kind: 'ram', name: 'RAM', colour: P.ram }, { kind: 'disk', name: 'Disk', colour: P.stor }] as const;
const pitch = (frame: WorldFrame) => Math.max(9, Math.ceil(16 / (frame.scale ?? 2)));
const rowY = (frame: WorldFrame, i: number) => BOARD.y + BOARD.h + 2 + i * pitch(frame);

/** Dedicated size/use rows below the board outline. No values or fills cover the PCB. */
export function drawMemoryRows(g: CanvasRenderingContext2D, s: SystemSnapshot, frame: WorldFrame): void {
  rows.forEach((row, i) => {
    const tier = s.memory.tiers.find(t => t.tier === row.kind), y = rowY(frame, i);
    R(g, BOARD.x + 4, y, BOARD.w - 8, pitch(frame) - 1, '#211c35');
    if ((frame.scale ?? 2) < 2) return;
    const x = BOARD.x + BOARD.w - 30, w = 23;
    R(g, x, y + 3, w, 3, '#443854');
    if (tier && tier.capacityBits > 0) R(g, x, y + 3, Math.round(w * Math.min(1, tier.usedBits / tier.capacityBits)), 3, row.colour);
  });
}

export function writeMemoryRows(s: SystemSnapshot, frame: WorldFrame, out: LabelWriter): void {
  rows.forEach((row, i) => {
    const tier = s.memory.tiers.find(t => t.tier === row.kind);
    const capacity = tier?.capacityBits ?? 0, used = tier?.usedBits ?? 0;
    const value = capacity > 0 ? `${formatSize(capacity).replace(' ', '')} · ${Math.round(100 * used / capacity)}% used` : 'Not installed';
    out.label(`memory-${row.kind}`, BOARD.x + 6, rowY(frame, i), 'left').text(row.name, 'name', true).text(value, capacity > 0 ? 'value' : 'dim');
  });
}

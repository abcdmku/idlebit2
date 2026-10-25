import { ladderSpeed } from './curves';
import { BACKBONE, DATA_PLANE, networkStepPrice, networkStepsBetween, portSpeedPrice, ROOM_SWITCH, SWITCH } from './network';

// A.3 / D12: matching-generation native lanes and researched core sites, oscillator at L36.
const server = (era: 1 | 2 | 3) => [0, 8, 16, 32][era]! * [0, 2, 4, 8][era]! * 10 ** (3 * era) * 1.5 ** 35;

describe('D12 link catalog re-base', () => {
  it('fits rack and room uplink traffic in every shared port/uplink range', () => {
    const rackEras = [1, 1, 2, 2, 3, 3, 3] as const;
    // Room opens after MHz fab, even when using an earlier switch generation.
    const roomEras = [2, 2, 2, 2, 3, 3, 3] as const;
    rackEras.forEach((era, g) => expect(ladderSpeed(SWITCH.topK[g]!)).toBeGreaterThanOrEqual(12 * server(era)));
    roomEras.forEach((era, g) => expect(ladderSpeed(ROOM_SWITCH.topK[g]!)).toBeGreaterThanOrEqual(288 * server(era)));
  });

  it('fits a room per data-plane port and three zones per backbone link', () => {
    for (const top of DATA_PLANE.topK) expect(ladderSpeed(top)).toBeGreaterThanOrEqual(288 * server(3));
    for (const top of BACKBONE.topK) expect(ladderSpeed(top)).toBeGreaterThanOrEqual(3 * 288 * server(3));
  });

  it('keeps the starter rack at 1 kHz and rack, data-plane and backbone spans at 1,000', () => {
    expect(ladderSpeed(SWITCH.baseK[0]!)).toBe(1_000);
    for (const row of [SWITCH, ROOM_SWITCH, DATA_PLANE, BACKBONE]) {
      expect(row.baseK).toHaveLength(row.names.length);
      expect(row.topK).toHaveLength(row.names.length);
      row.baseK.forEach((base, g) => {
        expect(Number.isInteger(base)).toBe(true);
        expect(base).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(row.topK[g])).toBe(true);
        expect(row.topK[g]!).toBeGreaterThanOrEqual(base);
        if (row === ROOM_SWITCH || (row === SWITCH && g === 0)) return;
        expect(ladderSpeed(row.topK[g]!) / ladderSpeed(base)).toBeCloseTo(1_000, 9);
      });
    }
  });

  it('raises generation tops by at least 10×, with Subsea retaining DWDM bandwidth', () => {
    for (const row of [SWITCH, ROOM_SWITCH, DATA_PLANE, BACKBONE]) {
      row.topK.slice(1).forEach((top, i) => {
        // Three 1-2-5 rungs are exactly 10×, without rounding at EHz/ZHz scales.
        const minSteps = row === BACKBONE && i === 2 ? 0 : 3;
        expect(top - row.topK[i]!).toBeGreaterThanOrEqual(minSteps);
      });
    }
  });
});

describe('D13 upstream port defaults', () => {
  it('matches the A.3 default-speed table and data-plane/backbone spans', () => {
    expect(SWITCH.baseK).toEqual([0, 20, 28, 31, 38, 41, 44]);
    expect(ROOM_SWITCH.baseK).toEqual([21, 24, 32, 35, 42, 45, 48]);
    expect(DATA_PLANE.baseK).toEqual([50, 53, 56]);
    expect(DATA_PLANE.topK).toEqual([59, 62, 65]);
    expect(BACKBONE.baseK).toEqual([53, 56, 59, 59]);
    expect(BACKBONE.topK).toEqual([62, 65, 68, 68]);
  });

  it('never decreases defaults across generations within a ladder', () => {
    for (const row of [SWITCH, ROOM_SWITCH, DATA_PLANE, BACKBONE]) {
      row.baseK.slice(1).forEach((base, g) => {
        expect(base).toBeGreaterThanOrEqual(row.baseK[g]!);
      });
    }
  });

  it('keeps defaults at least as fast as the tier below in each matching era', () => {
    ROOM_SWITCH.baseK.forEach((base, g) => {
      expect(base).toBeGreaterThanOrEqual(SWITCH.baseK[g]!);
    });
    // A.3: data plane opens at room gen 5, backbone at room gen 6.
    // Later eras retain the final lower-tier generation once that ladder ends.
    DATA_PLANE.baseK.forEach((base, g) => {
      expect(base).toBeGreaterThanOrEqual(ROOM_SWITCH.baseK[Math.min(5 + g, ROOM_SWITCH.baseK.length - 1)]!);
    });
    BACKBONE.baseK.forEach((base, g) => {
      expect(base).toBeGreaterThanOrEqual(DATA_PLANE.baseK[Math.min(1 + g, DATA_PLANE.baseK.length - 1)]!);
    });
  });
});

describe('D14 native-clock port pricing', () => {
  it('matches the three spec steps and their approximately 415,000 Credit total', () => {
    expect([0, 1, 2].map((k) => networkStepPrice(SWITCH, k))).toEqual([31_654n, 123_006n, 260_111n]);
    expect(networkStepsBetween(SWITCH, 0, 3)).toBe(414_771n);
    expect(Math.round(Number(networkStepsBetween(SWITCH, 0, 3)) / 1_000) * 1_000).toBe(415_000);
  });

  it('prices the exact 1–10 kHz clock span, with each purchased ladder step rounded separately', () => {
    // The continuous native-clock sum at L = 1 + log_1.5(10), rounded once, is 414,770.
    // Three separate purchases add one Credit of rounding. A whole L7 clock overshoots 10 kHz.
    const levels = Math.log(10) / Math.log(1.5);
    const clockSpan = Math.ceil(15_000 * (1.7 ** levels - 1) / 0.7);
    expect(portSpeedPrice(1_000, 10_000, 1)).toBe(BigInt(clockSpan));
    expect(clockSpan).toBe(414_770);
    expect(networkStepsBetween(SWITCH, 0, 3) - BigInt(clockSpan)).toBe(1n);
  });

  it('equals native clock upgrade costs at the six actual clock-level boundaries', () => {
    const nativeSteps = [15_000n, 25_500n, 43_350n, 73_695n, 125_282n, 212_979n];
    const portSteps = nativeSteps.map((_, level) => portSpeedPrice(1_000 * 1.5 ** level, 1_000 * 1.5 ** (level + 1), 1));
    expect(portSteps).toEqual(nativeSteps);
    expect(portSteps.reduce((sum, price) => sum + price, 0n)).toBe(495_806n);
    expect(1_000 * 1.5 ** 6).toBe(11_390.625);
  });

  it('selects a clock generation by destination per-stream speed, including crossings and clamps', () => {
    for (const [base, upgrade] of [[1, 3n], [1e3, 15_000n], [1e6, 90_000_000n], [1e9, 240_000_000_000n]] as const) {
      expect(portSpeedPrice(base, base * 1.5, 1)).toBe(upgrade);
      if (base > 1) {
        expect(portSpeedPrice(base / 2, base, 1)).toBe(BigInt(Math.ceil(Number(upgrade) / 0.7 * (1 - 0.5 ** (Math.log(1.7) / Math.log(1.5))))));
      }
    }
    expect(portSpeedPrice(0.5, 0.75, 1)).toBe(2n);
    expect(portSpeedPrice(1e12, 1.5e12, 1)).toBeGreaterThan(240_000_000_000n);
  });

  it('scales rack and room ports and uplinks by the specified stream counts', () => {
    expect([SWITCH.streams, SWITCH.uplinkStreams, ROOM_SWITCH.streams, ROOM_SWITCH.uplinkStreams, DATA_PLANE.streams, BACKBONE.streams])
      .toEqual([1, 12, 12, 288, 288, 288]);
    expect(portSpeedPrice(12_000, 18_000, 12)).toBe(12n * 15_000n);
    expect(portSpeedPrice(288_000, 432_000, 288)).toBe(288n * 15_000n);
    for (const row of [SWITCH, ROOM_SWITCH]) {
      expect(networkStepPrice(row, 3, true)).toBe(portSpeedPrice(ladderSpeed(3), ladderSpeed(4), row.uplinkStreams!));
      expect(networkStepPrice(row, 3)).toBe(portSpeedPrice(ladderSpeed(3), ladderSpeed(4), row.streams));
    }
  });

  it('sums the individually rounded zone ports and same-speed port purchases', () => {
    expect(networkStepPrice(DATA_PLANE, 50, false, 3)).toBe(3n * networkStepPrice(DATA_PLANE, 50));
    expect(networkStepsBetween(DATA_PLANE, 50, 53, false, 3)).toBe(3n * networkStepsBetween(DATA_PLANE, 50, 53));
    const sameSpeedTotal = [0, 1, 2].reduce((sum, k) => sum + networkStepsBetween(SWITCH, k, 3), 0n);
    expect(sameSpeedTotal).toBe(1_057_999n);
    expect(networkStepsBetween(SWITCH, 3, 3)).toBe(0n);
  });

  it('keeps whole Credits exact beyond the safe integer range', () => {
    const price = networkStepPrice(BACKBONE, BACKBONE.topK[3]! - 1);
    expect(price).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(networkStepPrice(BACKBONE, 64)).toBe(portSpeedPrice('2e24', '5e24', 288));
    expect(networkStepPrice(DATA_PLANE, 64, false, 3) % 3n).toBe(0n);
    expect(portSpeedPrice(1_000, 1_000, 1)).toBe(0n);
    expect(() => portSpeedPrice(1_000, 2_000, 0)).toThrow(RangeError);
    expect(() => networkStepPrice(DATA_PLANE, 50, false, 0)).toThrow(RangeError);
  });
});

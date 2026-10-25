import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Isolated balance model for docs/hardware-progression.md. No runtime imports.
const REFERENCE_PRICE = 0.01;
const LEVEL_MAX = 36;
const CPU = [
  { name: 'Hz', base: 1, lanes: 1, max: LEVEL_MAX, ratio: 10, decay: 0.92, sourceDecay: 0.92, upgrade: 3n },
  { name: 'kHz', base: 1e3, lanes: 2, max: LEVEL_MAX, ratio: 6, decay: 0.93, sourceDecay: 0.93, upgrade: 15000n },
  { name: 'MHz', base: 1e6, lanes: 4, max: LEVEL_MAX, ratio: 3, decay: 0.95, sourceDecay: 0.94, upgrade: 90000000n },
  { name: 'GHz', base: 1e9, lanes: 8, max: LEVEL_MAX, ratio: 2, decay: 0.9625, sourceDecay: 0.96, upgrade: 240000000000n },
];
const RAM_CAPACITY = [1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112,
  128, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024, 1280, 1536, 1792, 2048, 3072];
const RAM = [
  { name: 'SDRAM', bits: 64, rate: 16, era: 0, upgrade: 12n },
  { name: 'DDR', bits: 128, rate: 32, era: 0, upgrade: 12n },
  { name: 'DDR2', bits: 2 ** 20, rate: 3.2e4, era: 1, upgrade: 120000n },
  { name: 'DDR3', bits: 2 ** 30, rate: 6.4e7, era: 2, upgrade: 1500000000n },
  { name: 'DDR4', bits: 2 ** 32, rate: 2.56e8, era: 2, upgrade: 1500000000n },
  { name: 'DDR5', bits: 2 ** 38, rate: 1.28e11, era: 3, upgrade: 7700000000000n },
];

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  assert.equal(quoted, false, 'Unclosed source CSV quote');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
const numeric = (value) => Number(value.replaceAll(',', ''));
function source(name, hash) {
  const bytes = readFileSync(new URL(`../docs/balance/hardware-progression/${name}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `Changed source: ${name}`);
  const rows = parseCsv(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const blocks = rows.flatMap((row, i) => row[0] === 'to_level' ? [{ headerRow: i + 1, parameters: rows[i - 1], rows: rows.slice(i + 1, i + 37) }] : []);
  assert.equal(blocks.length, 6);
  blocks.forEach((block) => block.rows.forEach((row, i) => assert.equal(numeric(row[0]), i + 1)));
  return { name, hash, blocks };
}
const cpuSource = source('cpu_cost_spec.csv', 'ce414b4f3dae69fa5e20981918c8174ca517bef2e693b616d37e0f3ede04795e');
const ramSource = source('ram_game_spec_sheet.csv', '3a801e23af5c1c9dc0680f2e5f985403a81897813d043cbfd99c35f64a79c3a7');
assert.deepEqual(ramSource.blocks[0].rows.map((r) => numeric(r[5])), RAM_CAPACITY);
CPU.forEach((era, g) => assert.equal(numeric(cpuSource.blocks[g].rows[0][3]), era.ratio));
CPU.forEach((era, g) => assert.equal(numeric(cpuSource.blocks[g].parameters[3]), era.sourceDecay));
CPU.forEach((era, g) => assert.equal(numeric(ramSource.blocks[g].rows[0][3]), era.ratio));

function checkLevel(level, max) { assert.ok(Number.isInteger(level) && level >= 1 && level <= max, `Invalid level ${level}`); }
const factor = (level) => 1.5 ** (level - 1);
function upgrade(base, level, max, drive = 1n, multiplier = 1n, denominator = 1n) {
  checkLevel(level, max); assert.ok(level < max, 'No upgrade at the cap');
  const power = BigInt(level - 1), divisor = 10n ** power * denominator;
  return (base * 17n ** power * drive * multiplier + divisor - 1n) / divisor;
}
function power(native, rate, ratio, decay) {
  const push = Math.max(1, rate / native), exponent = -Math.log(decay) / Math.log(1.5);
  const efficiency = ratio / push ** exponent;
  const fullW = rate / (REFERENCE_PRICE * efficiency);
  const idleW = 0.1 * Math.min(native / (REFERENCE_PRICE * ratio) * push ** 0.25, fullW);
  const loadW = fullW - idleW;
  assert.ok(loadW >= 0);
  return { efficiency, fullW, idleW, loadW, energyShare: fullW * REFERENCE_PRICE / rate };
}
function cpu(g, level, lanes = CPU[g].lanes, clock = CPU[g].base * factor(level)) {
  const era = CPU[g]; checkLevel(level, era.max);
  const rate = lanes * clock, p = power(era.base * era.lanes, rate, era.ratio, era.decay);
  return { era: era.name, level, clockHz: clock, rate, ...p, net: rate - p.fullW * REFERENCE_PRICE,
    upgradeCredits: level < era.max ? upgrade(era.upgrade, level, era.max, BigInt(lanes)).toString() : null };
}
function ram(g, level, ecc = false, registered = false) {
  const max = LEVEL_MAX;
  checkLevel(level, max);
  const row = RAM[g], era = CPU[row.era], rate = row.rate * factor(level);
  return { technology: row.name, level, capacityBits: row.bits * RAM_CAPACITY[level - 1] * (ecc && registered ? 2 : 1), bandwidth: rate,
    ...power(row.rate, rate, era.ratio, era.decay),
    upgradeCredits: level < max ? upgrade(row.upgrade, level, max, 1n, ecc ? 5n : 1n, ecc ? 4n : 1n).toString() : null };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12);
close(cpu(0, 18).clockHz, 985.2612533569336);
assert.equal(cpu(3, 6).clockHz, 7593750000);
assert.equal(cpu(3, 6).clockHz * 1.25, 9492187500);
assert.equal(upgrade(3n, 2, LEVEL_MAX), 6n); // ceil(3 × 1.7), independently check currency rounding.
assert.equal(ram(0, 1, true).upgradeCredits, '15'); // ECC applies before the final rounding.
assert.throws(() => cpu(3, 37));
assert.throws(() => upgrade(3n, 36, 36));
assert.throws(() => ram(0, 37));
for (const ecc of [false, true]) for (const registered of [false, true]) {
  assert.ok(ram(0, 36, ecc, registered).capacityBits > 0);
  assert.throws(() => ram(0, 37, ecc, registered));
}
assert.equal(ram(0, 36).capacityBits, 64 * 3072);
assert.equal(ram(0, 36, true, true).capacityBits, 64 * 3072 * 2);
assert.equal(ram(0, 36, false, true).capacityBits, ram(0, 36).capacityBits);
assert.equal(ram(0, 36, true, true).bandwidth, ram(0, 36).bandwidth);

const cpuRows = CPU.flatMap((era, g) => Array.from({ length: era.max }, (_, i) => cpu(g, i + 1)));
const ramRows = RAM.flatMap((_, g) => Array.from({ length: LEVEL_MAX }, (_, i) => ram(g, i + 1)));
const summaries = CPU.map((era, g) => {
  const rows = cpuRows.filter((r) => r.era === era.name);
  rows.forEach((r, i) => {
    close(r.efficiency, era.ratio * era.decay ** i);
    close(r.idleW + r.loadW, r.fullW);
    if (i) { assert.ok(r.clockHz > rows[i - 1].clockHz); assert.ok(r.efficiency < rows[i - 1].efficiency); }
  });
  const badEdge = rows.find((r, i) => i > 0 && r.net <= rows[i - 1].net);
  const operatingLoss = rows.find((r) => r.net < 0);
  assert.ok(operatingLoss, 'Every era reaches operating loss before the cap');
  assert.ok(rows[operatingLoss.level - 2].net >= 0, 'Operating-loss boundary must be the first');
  for (const row of rows.slice(operatingLoss.level - 1, -1)) {
    assert.ok(row.upgradeCredits !== null, 'Loss-making upgrades remain quoted until the common cap');
  }
  const nativeNext = g < 3 ? cpu(g + 1, 1) : null;
  const last = rows.at(-1);
  if (nativeNext) {
    assert.ok(cpu(g, 19).clockHz > nativeNext.clockHz, 'Old hardware may run faster than the next native tier');
    assert.ok(last.clockHz > nativeNext.clockHz * 1000, 'Old hardware may cross multiple tier speed boundaries');
    assert.ok(nativeNext.efficiency > last.efficiency);
    // Compare watts at matched throughput, without pretending the two complete the same task mix.
    const oldAtRate = power(era.base * era.lanes, nativeNext.rate, era.ratio, era.decay);
    assert.ok(oldAtRate.fullW > nativeNext.fullW);
  }
  return { era: era.name, levels: era.max, upgrades: era.max - 1, maxClockHz: last.clockHz,
    nativeEnergyPercent: rows[0].energyShare * 100, maxEnergyPercent: last.energyShare * 100,
    maxRatio: last.efficiency, firstNonPositiveMarginalUpgrade: badEdge ? `${badEdge.level - 1}->${badEdge.level}` : null,
    firstOperatingLossLevel: operatingLoss.level,
    nextNativeRatioRecovery: nativeNext ? nativeNext.efficiency / last.efficiency : null };
});
RAM.forEach((row, g) => {
  const values = ramRows.filter((r) => r.technology === row.name);
  values.forEach((r, i) => {
    close(r.efficiency, CPU[row.era].ratio * CPU[row.era].decay ** i);
    if (i) { assert.ok(r.capacityBits > values[i - 1].capacityBits); assert.ok(r.bandwidth > values[i - 1].bandwidth); }
  });
  assert.equal(values.find((r) => r.energyShare > 1).level, summaries[row.era].firstOperatingLossLevel);
  assert.ok(ram(g, 35).energyShare > 1 && ram(g, 35).upgradeCredits !== null);
  assert.equal(ram(g, 36).upgradeCredits, null);
  assert.equal(ram(g, 36, true, true).capacityBits, 2 * ram(g, 36).capacityBits);
  assert.throws(() => ram(g, 37, true, true));
});
const mixedOldCore = cpu(0, 1, 1, 1000), newCore = cpu(1, 1);
assert.ok(mixedOldCore.efficiency < newCore.efficiency, 'New oscillator must not modernize old core efficiency');
const newCoreOldClock = cpu(3, 1, 8, 1);
assert.ok(newCoreOldClock.loadW >= 0, 'A slow old oscillator on a newer core must not produce negative load watts');
close(newCoreOldClock.idleW / newCoreOldClock.fullW, 0.1);
const regionExample = cpu(3, 1);
close(regionExample.fullW * 0.014 / regionExample.rate, 0.7);
assert.deepEqual(summaries.map((r) => r.firstOperatingLossLevel), [29, 26, 23, 20]);
assert.ok(cpu(3, 35).net < 0 && cpu(3, 35).upgradeCredits !== null);
assert.equal(cpu(3, 36).upgradeCredits, null);

const ramReplacements = RAM.slice(0, -1).map((row, g) => {
  const old = ram(g, LEVEL_MAX);
  const next = Array.from({ length: LEVEL_MAX }, (_, i) => ram(g + 1, i + 1)).find((r) => r.capacityBits >= old.capacityBits);
  assert.ok(next, `Capacity-preserving ${row.name} replacement must fit`);
  return { from: row.name, to: next.technology, oldLevel: LEVEL_MAX, newLevel: next.level,
    capacityRatio: next.capacityBits / old.capacityBits, bandwidthRatio: next.bandwidth / old.bandwidth };
});
assert.ok(ramReplacements[0].bandwidthRatio < 1, 'Capacity-preserving RAM replacement may lose bandwidth');

const output = { scope: 'Isolated CPU/RAM rules probe; not a campaign or runtime verification',
  sources: [cpuSource, ramSource].map(({ name, hash, blocks }) => ({ name, hash, blocks: blocks.length, rowsPerBlock: 36 })),
  summaries, ramReplacements, cpuRows, ramRows };
if (process.argv.includes('--json')) console.log(JSON.stringify(output, null, 2));
else {
  console.log(output.scope);
  console.table(summaries);
  console.log(`PASS: 2 source exports, 12 blocks, ${cpuRows.length} CPU levels and ${ramRows.length} RAM levels; caps, exact prices, mixed cores, ECC/RDIMM and tariffs.`);
}

# Hardware progression source examples

Borg supplied these two CSV exports on 24 October 2026 to illustrate hardware cost, throughput and efficiency progression. They are reference calculations, not a literal production catalog.

| Saved file | Original attachment | SHA-256 |
|---|---|---|
| `cpu_cost_spec.csv` | `cpu_game_spec_sheet.xlsm - cpu_cost_spec.csv` | `ce414b4f3dae69fa5e20981918c8174ca517bef2e693b616d37e0f3ede04795e` |
| `ram_game_spec_sheet.csv` | `cpu_game_spec_sheet.xlsm - ram_game_spec_sheet (1).csv` | `3a801e23af5c1c9dc0680f2e5f985403a81897813d043cbfd99c35f64a79c3a7` |

Both files are preserved byte for byte. Each has six blocks, Hz through PHz, with 36 levels per block. CPU headers are on rows 2, 41, 80, 119, 158 and 197. RAM uses the same header rows. The parameter and auxiliary columns are part of the source, not additional hardware records.

The exports contain displayed values, not workbook formulas. CPU `new cost` and `Calculated` are different series. Rounded clocks sometimes compound prior rounding. Negative profit and negative time-to-afford values appear in late rows. Those times cannot describe an affordable purchase. The RAM `idle uW` column has its own scale and must not be imported as game watts without conversion.

The adopted rules and deliberate departures are in [the hardware progression specification](../../hardware-progression.md). All 36 source levels are retained for CPU clock and RAM upgrades, even after running costs exceed output. The later-era decay is slightly tuned to the user's roughly-L30-to-L20 operating-loss target. The THz and PHz blocks do not add native CPU generations; old-generation overclocks can still display those prefixes.

Run `node scripts/probe-hardware-progression.mjs` from the repository root to verify the source shape, compare the adopted curves and inspect the tier transitions. Add `--json` for the complete derived rows. This is an isolated balance calculation, not a live campaign result.

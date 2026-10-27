# CPU and RAM progression

24 October 2026. Rules adopted from Borg's CPU and RAM calculation examples and corrected after the user's follow-up. The binding ruling is the **CPU/RAM progression** entry in `decisions.md` §15a. This document supplies the formulas referenced by `game-spec.md` §§9 and 12. Numeric starting values are **(s)**. Every CPU clock and RAM generation has 36 levels. Generation boundaries and negative profit never impose an earlier upgrade cap. No additional THz/PHz native CPU generations are required.

This pass changes the specification and provides a balance probe. The shared runtime still needs integration by the game thread. These formulas have not yet been validated by a legal full-game campaign.

## 1. What the examples establish

The original exports are preserved with hashes in [balance/hardware-progression](balance/hardware-progression/README.md). Each contains six illustrative tiers and 36 levels. Their recurring pattern is:

- Throughput rises about 1.5× per level. The CPU `new cost` series rises about 1.7×. The `Calculated` price column is a separate series and is not the adopted price formula.
- Efficiency falls with each pushed level. The native CPU ratios in the first four blocks are 10, 6, 3 and 2. Their per-level retention factors are 0.92, 0.93, 0.94 and 0.96.
- A new tier restores efficiency compared with a heavily pushed old tier. Its native efficiency is lower than the previous tier's native efficiency, so energy management matters more as the game advances.
- RAM capacity has its own stepped ladder. Bandwidth and capacity need not grow at the same rate.

The formulas below use unrounded values. Display rounding never feeds the next level. Auxiliary C-state, boot-loader, manual and voltage columns are design examples. Existing research effects remain the production rules. Negative spreadsheet times-to-afford become **no payback**, never a negative wait.

The user's correction is explicit: hardware can be upgraded past the next tier's native speed, and eventually costs more to run than it produces, roughly around level 30 early and level 20 later. The player may keep buying upgrades anyway. They allowed 36 or 32 levels; this revision uses 36 to match the source sheets. It replaces the rejected L18/L6 clock and L18/L22 RAM limits.

## 2. CPU clocks

Level 1 is the native clock. Reaching level `L` takes `L - 1` upgrades.

```text
clockFactor(L) = 1.5^(L - 1)
ratedClock(g, L) = clockBase[g] × clockFactor(L)
clockBase = [1, 1e3, 1e6, 1e9] Hz
clockLevelMax = 36                              // every generation, 35 upgrades from L1
```

| Era | Native L1 | Maximum level | Upgrades from L1 | Maximum rated clock |
|---|---:|---:|---:|---:|
| Hz | 1 Hz | 36 | 35 | 1.456110 MHz |
| kHz | 1 kHz | 36 | 35 | 1.456110 GHz |
| MHz | 1 MHz | 36 | 35 | 1.456110 THz |
| GHz | 1 GHz | 36 | 35 | 1.456110 PHz |

These limits replace the generic `2^(L-1)` clock curve and `11 + g` clock cap. Every era crosses the next era's native clock at L19 and the following era's native clock at L36. For example, a Hz-generation clock at L19 runs at 1,477.891880 Hz, faster than the native kHz clock. It remains Hz-generation hardware, with its old-generation energy penalty. Replacement is an economic choice, not a forced speed transition.

Turbo still multiplies the effective clock by 1.25 under its existing conditions. It grants no levels or new era. THz/PHz in a displayed overclock is a unit prefix, not a new fabrication tier. Caches keep their existing capacity curves. No cache limit is inferred from the clock limit.

**D34 (25 Oct):** there are no lanes. A core runs one thread at its clock; one research node (Multi-core) opens all 32 core sites, and each added core costs `EXTRA_CORE_GROWTH` (2.2) times the last. Sockets and threads still come from their research. CPU fab research grants availability. The player must buy and install the new hardware to gain its native efficiency.

## 3. Efficiency and watts

`E` is a hardware energy ratio. It is potential gross Credits per second divided by the part's full-use electrical Credits per second, at the fixed home reference price of **0.010 Credits/J**. It is not the thermal or configuration efficiency percentage. It does not multiply task payouts or production rates.

For a core, before DVFS, turbo, power caps, configuration and temperature modifiers:

```text
native = baseLanes[g_core] × clockBase[g_core]
rate   = installedLanes × installedRatedClock
push   = max(1, rate / native)
a[g]   = -ln(decay[g]) / ln(1.5)
E      = nativeRatio[g_core] / push^a[g_core]
nativeRatio = [10, 6, 3, 2]
decay       = [0.92, 0.93, 0.95, 0.9625]
```

With native lanes and a matching-generation oscillator, `E = nativeRatio[g] × decay[g]^(L_clock - 1)`. Extra lane levels also increase `push`. Extra cores add their own watts. The oscillator does not carry the cores' load a second time.

Hz cores and RAM retain the source's decay. **Departure (lead ruling, 25 Oct, D29):** the kHz **core** decays 0.85 per pushed level instead of the source's 0.93. It keeps kHz compute climbing across the System era so the 100 kHz pipe wall lands near Rack (D29): with 0.93 a single kHz core stays economic to about 266k ops/s and the clock (15–60 s per level at the CSV prices) races to the pipe within 20 min of the kHz package; with 0.85 a kHz core turns uneconomic near 18k ops/s, so compute grows with the Data-gated core count (2, 4, 8). The CSV's prices and clocks are unchanged, and kHz-era RAM (DDR2) keeps 0.93. MHz/GHz use 0.95/0.9625 **(s)** instead of the source's 0.94/0.96 to place operating loss near L23/L20 under the user's latest roughly-30-to-20 target. These are adopted balance values, not claims about the source cells.

**The core generation owns this ratio.** Putting a new clock on old cores does not grant the new cores' native ratio. `push` still compares against those old cores' native lanes and clock. Research completion alone never changes installed parts' generation.

For CPU cores and RAM only, replace the generic `wPerUnit × rate × push^0.3` rule with:

```text
referencePrice = 0.010 Credits/J                 // fixed normalization, not the site's current price
nativeFullW = native / (referencePrice × nativeRatio[g])
fullW = rate / (referencePrice × E)
idleW = 0.1 × min(nativeFullW × push^0.25, fullW)
loadW = fullW - idleW
actualW = idleW × idleFactor + loadW × utilization × loadFactor
```

For RAM, substitute native/rated bandwidth and the RAM ratio table below. `idleShare = 0.1` **(s)**. `fullW` includes idle, so a fully used part at default factors has exactly ratio `E`. The `min` also covers a newer core driven below its native rate by an old clock. Idle stays at most 10% of `fullW`, and load never becomes negative. This replaces the old push exponent for these parts. Applying both would bill the efficiency penalty twice.

Sites still bill actual joules at their region's price. Hardware does not change watts when moved between regions. At regional price `p`, the full-use electrical cost per potential Credit of work is `(p / 0.010) / E`. Supply losses and cooling are additional real costs.

The existing C-states, DVFS, turbo, power caps, low-voltage RAM, configuration efficiency and thermal rules still apply in their existing places. `E` already raises electrical watts and therefore heat as it falls. Do not divide heat by `E` again. The existing heat divisor `η_cfg × e(T)` remains separate.

### Native versus pushed CPU economics

The following is an isolated, fully used core with native lanes, at the home price, before supply losses, cooling and other parts. Gross potential is normalized to 1 Credit per op. These are not whole-system profit forecasts.

| Era | L1 energy / potential gross | First upgrade with no marginal payback | First level costing more to run than it produces |
|---|---:|---:|---:|
| Hz | 10.00% | L26 → L27 | L29 |
| kHz | 16.67% | L23 → L24 | L26 |
| MHz | 33.33% | L20 → L21 | L23 |
| GHz | 50.00% | L17 → L18 | L20 |

An upgrade loses marginal payback before the hardware's entire operation becomes loss-making. These are separate warnings. In this reference case, operational break-even is `E = 1`, and `E < 1` means the electrical bill alone exceeds gross potential. By L36 every era is loss-making, but L35 → L36 is still a valid purchase. Supply losses, cooling, configuration, tariffs and utilization can move the actual loss earlier. Efficiency research can delay it. These thresholds are balance checks, not action gates.

Replacement restores efficiency relative to pushed old hardware. A native part may be slower than a heavily upgraded older part, so show its actual throughput rather than promising an automatic speed gain. More cores, cache, RAM, workload handling and efficiency research remain progression choices alongside further overclocking.

## 4. RAM capacity and bandwidth

Keep the six existing RAM technologies and their gates. They are independent of CPU fab purchases. Their capacity and bandwidth bases in game-spec A.1 remain starting values. The source's one-bit RAM does not add RAM to the one-bit-cache boot state.

D46 makes bandwidth apply to initial loading as well as later memory traffic. SDRAM, DDR, DDR2, DDR3, DDR4 and DDR5 each have their own base rate and 36 levels of speed upgrades within the generation. Rates are the game's scaled bit/s, not real-world DIMM MHz ratings. A cache load consumes CPU operations. HDD, SSD, NVMe and SCM load at their own drive IO rates and retain their existing level upgrades.

Every RAM generation has 36 levels, with or without ECC or registered DIMMs. Registered DIMM research grants **2× capacity to ECC modules** **(s)** instead of adding levels beyond the common ceiling. It changes neither bandwidth nor the saved level. This replaces the old `ramLevelBonus = 4` effect. The saved module level is shared by capacity, bandwidth, price and efficiency, but those properties use different curves:

```text
capacity(g, L)  = capacityBase[g] × capacityFactor[L - 1] × registeredFactor
registeredFactor = 2 if ECC and rdimm researched, otherwise 1
bandwidth(g,L) = bandwidthBase[g] × 1.5^(L - 1)
E_ram(g, L)    = nativeRatio[g] × decay[g]^(L - 1)
capacityFactor = [1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40,
                  48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
                  384, 448, 512, 640, 768, 896, 1024, 1280, 1536, 1792, 2048, 3072]
```

| RAM generation | Era for energy | Native ratio | Retention per level |
|---|---|---:|---:|
| SDRAM | Hz | 10 | 0.92 |
| DDR | Hz | 10 | 0.92 |
| DDR2 | kHz | 6 | 0.93 |
| DDR3 | MHz | 3 | 0.95 |
| DDR4 | MHz | 3 | 0.95 |
| DDR5 | GHz | 2 | 0.9625 |

Mapping SDRAM/DDR and DDR3/DDR4 to a shared era preserves existing technology research while applying the four energy eras. These mappings are **(s)**. At L36 a module has 3,072× native capacity and 1,456,109.606050× native bandwidth. Registered ECC has 6,144× native capacity at the same level and bandwidth. ECC's existing 1.1× watts and low-voltage RAM's 0.7× watts remain separate modifiers. Without them or supporting costs, RAM's normalized first operating-loss levels follow the era table above.

Bandwidth is bit/s, not a separate CPU clock. Crossing the next RAM technology's bandwidth or capacity never disables upgrades on the old module. Dual/quad-channel and board rules keep their current effects. Low-voltage RAM remains worth buying because it lowers watts without altering the memory capacity gate.

RAM earns no independent payout. Its normalized energy ratio prices memory work. Actual revenue still arrives only when complete tasks pay. A capacity increase can admit a new task family without creating an equal speed or revenue increase. Idle-heavy and capacity-heavy fleets must be checked using their real utilization.

## 5. Purchases and research

Clock and RAM level prices use the source's simple step growth **(s)**:

```text
upgrade(g, L -> L + 1) = ceil(upgradeBase[g] × 1.7^(L - 1) × drive)
```

Use the existing per-generation `upgrade` arrays as initial `upgradeBase`. For clocks, `drive` is the lanes on one CPU, then the total price is multiplied by CPU count. For RAM, `drive = 1`, with existing extra-unit and ECC multipliers. Round once after all multipliers, using exact decimal or rational currency arithmetic. A quote at the cap is unavailable. Other part price curves keep their rules.

The only level cap for these curves is L36. Reaching a new tier's native speed, `E <= 1`, negative net income, or a negative marginal return never invalidates an upgrade quote. The purchase still needs its normal research, wallet and hardware requirements. Do not add profitability locks, automatic replacement, or automatic shutdown because an efficiency ratio crossed 1. Existing insolvency and supply/thermal failure rules still apply.

The 1.7× cost growth exceeds the 1.5× throughput growth. Within-tier upgrades buy time immediately but take longer to recover their cost as efficiency worsens. Preserve separate **Upgrade**, **Replace** and **Research next generation** choices. Buying a level must not automatically unlock or install a generation.

- Ordinary replacement starts at the newer generation's L1. Capacity-preserving replacement chooses the lowest legal level meeting the capacity being preserved. It may be unavailable if no legal level fits. It never silently drops a working set.
- For RAM, preserve **capacity bits** and preview bandwidth separately. A replacement may save energy yet reduce bandwidth. Show both changes. Compare watts at matched delivered bandwidth/utilization when claiming energy savings.
- For a whole CPU replacement, keep the existing rule of preserving core lanes and cache capacity, resetting the new clock to L1. Show the resulting throughput and electrical costs.
- Before the next fab is researched, it must be possible to earn its Data and complete its work using a profitable prior-era fleet. Do not make a known loss-making final overclock a prerequisite for escaping that era.
- Every era's clock and RAM levels can continue through L36, even beyond the economical range. There is no special GHz cutoff. Fleet width, cores, cache, RAM, workload handling and efficiency research remain alternatives.

## 6. Quotes and balance checks

The CPU and RAM plates show current and next throughput, capacity where relevant, full-use watts and normalized energy ratio. Show energy per minute at the site's actual tariff. Compare current and new hardware at the same workload when describing savings. An isolated energy ratio is not a promise of round income.

For a purchase that changes actual completion rate, `incrementalNet = nextNet - currentNet` and `payback = price / incrementalNet`. Use the same workload, tariff and support costs on both sides. If `incrementalNet <= 0`, show **No payback at this load**. The player can still choose capacity or speed to protect SLA. Do not describe that choice as a profitable upgrade. Do not calculate payback by dividing price by all current income.

Separately, if the hardware's total operating cost exceeds attributable gross output, show **Costs more to run than it produces**. Keep the upgrade action available at its normal position through L35 → L36. A warning does not grant an additional reason to reject the action. Show a real workload estimate when available; RAM's normalized ratio alone is not a standalone payout.

`node scripts/probe-hardware-progression.mjs` checks the source blocks, all 36 levels, prices, native recovery, RAM gates and region arithmetic. It independently reports first marginal no-payback and first whole-part operating-loss levels, and checks that loss-making upgrades remain quoted. It does not simulate arrivals, SLA, research affordability, losses or cooling.

Runtime integration needs a legal campaign pass before the balance is called complete:

1. Check Boot → System → kHz → MHz → GHz using only public actions, real Data and paid research work. Record choice cadence and wall time against the existing pacing targets.
2. Check that each next-era research is affordable before the previous era needs loss-making overclocks. Compare upgrade, additional hardware and research choices at each transition.
3. Re-size supplies/coolers against native and pushed fleets. The old 1%-of-gross energy calibration and 2.5× draw per flow level do not apply to CPU/RAM anymore.
4. Exercise mixed-generation clocks/cores, every era at L36/L37, ECC/RDIMM capacity, CPU copies, saved configurations, low utilization, regional tariffs and heat. Confirm that a well-funded player can buy an operating-loss upgrade, including L35 → L36. Preserve delta invariance and save validation.

## 7. Integration ownership

Research integration status during the GPU wave: generated research data and text preserve this reference's 36-level and registered-capacity rules. `src/game/build/research/runtimeCompatibility.ts` keeps only DDR's deployed effect description and RDIMM's functional `ramLevelBonus = 4` effect and description in runtime `RESEARCH`. This does not implement the new CPU/RAM formulas. The separate CPU/RAM pass must add `registeredCapacity` to the runtime rule contract, apply its factor only to ECC capacity without changing bandwidth or saved level, remove the old RDIMM level bonus, and integrate the common L36 purchase/config/save boundaries. Remove DDR's override when RAM's capacity/bandwidth and energy curves land, and RDIMM's when its rule consumers and boundaries land. Keep both generated files synced to the reference throughout, then prove runtime definitions and views match it after removing the overrides.

This parallel rules pass owns this document, its source directory, `scripts/probe-hardware-progression.mjs`, and CPU/RAM paragraphs in game-spec, research and program. It makes no shared runtime edits. The GPU thread owns GPU progression and the shared integration paths until a separate path handoff is agreed.

Anticipated CPU/RAM work: focused clock/RAM progression definitions, catalog chip and RAM portions of board, compile power/capacity calculations, curve/price/replacement helpers, plate previews and boundary tests. New curve names and energy parameters need contract-owner review. Keep GPU changes when touching shared types, compile, pricing or save validation. Levels outside the new ceilings require the project's pre-live reset or an explicit migration. Do not silently clamp a save into different hardware.

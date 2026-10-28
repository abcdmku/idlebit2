# Upgrade experience

**Final UI direction, 26 Oct (D40):** progress appears only in the round report. It uses task counts and an endless count ruler, with Best on its own row, Next era, expandable details, Auto return and Return. The user removed the Next goal row, failure summary and fix key. Research uses approved mockup C, with runway costs behind the Next era strip and no Pays now list. The implementation notes below record earlier, superseded slices.

**User correction, 26 Oct:** automatic skipping, outgrown/closing and the skip-based report UI are rejected and being reverted. Unsupported heads must expire into SLA failures; manual dismissal remains the active-play advantage. The sections below retain the rejected work's history and evidence, not instructions to continue it. Only the SLA correction and its verification are authorized, then work stops. The unrelated GPU tier changes remain.

Opus design decision, 26 October 2026, following the user's request for satisfying upgrades, visible processing changes and simpler GPU choices. The first GPU slice is implemented; the reward-loop work remains incomplete.

## Measured problem

Opus replayed the same seeded rounds from earned bot saves at 24 minutes, 2 hours, 5 hours and 8 hours, applying one public purchase at a time without other purchases. These are simulation comparisons, not human enjoyment tests.

| Save | Observation |
|---|---|
| 24 minutes | None of eight offered upgrades moved peak intensity. One clock purchase reduced net income by 92%. Memory capacity was the limiting resource. |
| 2 hours | A GPU improvement moved the frontier, while many other purchases did not. |
| 5 hours | Gross work was about 98.8k/s against a 100k/s pipe. None of 30 offered purchases improved the measured round. |
| 8 hours | Network purchases improved net results by about 100–217%; the earlier bottleneck had become actionable. |

A temporary, reverted experiment failed permanently unrunnable heads immediately. The same frontier took 9 instead of 115 seconds at 24 minutes, and 47 instead of 140 seconds at 2 hours. This identifies substantial waiting at the end of rounds. It does not establish an acceptable replacement: nine-second rounds are not the target, and transient waits must be distinguished from work the fleet cannot support.

Evidence and probe scripts are in `artifacts/qa/upgrade-experience-opus/`. The latest canonical campaign also misses late-unlock and decision-cadence targets; a locally improved GPU does not prove a balanced campaign.

## Benchmark and interpretation

[The Tower's developer listing](https://play.google.com/store/apps/details?id=com.TechTreeGames.TheTower) describes waves, permanent Workshop purchases, research and cards. [Cookie Clicker's official listing](https://store.steampowered.com/app/1454400/Cookie_Clicker/) describes reinvesting production into more production and permanent upgrades. These establish progression patterns, not controlled performance or retention comparisons.

Opus's design inference is that purchases should produce a legible change in capability or rate, and that repeat play should demonstrate the value of durable investment. In idlebit2, a purchase targeting a resource that is not limiting completion often gives no paid-work gain. Better feedback must reveal the real processing change and its constraint; it cannot manufacture a gain with decorative animation.

## Adopted first slice

Each GPU is a stable generation/type/tier item. Research opens generations; a type is chosen at installation; tiers advance 30 → 50 → 60 → 70 → 80 → 90 in place. Tier and generation steps cost the difference in whole card values. The separate push counter and large model picker are removed. The exact contract and version-18 migration are in [GPU progression](gpu-progression.md).

An earned two-hour comparison measured the 1330 → 1350 step at 2M Credits and about 16.7% more net per minute. This is evidence for that fleet and workload. GPU purchases still lose money once the pipe binds around five hours. The full incentive problem remains open.

## Next decisions

Opus prioritizes removing the dead waiting tail with an appropriate opening rebalance, resolving the pre-Rack pipe plateau, then applying the state-first presentation to CPU and RAM while retaining their 36-level ladders. These changes need legal, seeded before/after tests of active processing, net earnings, attainable work and meaningful decision cadence.

### Second slice: skip unsupported work, finish taken work

Unsupported uncommitted heads now skip at the market step, without payout, SLA loss or dismissal count. A runnable head resets the skip streak; ten consecutive skips close the market to new takes. Taken work finishes or fails normally before the round ends as `outgrown`; SLA and the 120 s no-completion safeguard still apply. Busy, sleeping, booting and cold-swapping systems remain in the static capability set; temporary fleet-down conditions retain their actual power, heat or offline diagnosis. This removes the `autoSkip` research node and amends D10.3/spec §5.2. The report gains skipped count, unpaid work and the missing-capability detail.

Skipping recovers runnable paying tasks interleaved among unsupported offers without consuming SLA. Draining is necessary: an immediate ending would discard most pay from work already taken. At 24 minutes, the old/new comparison pays 275k → 866k per round, takes 114 → 74 s and nets 833 → 3,999 per second. At two hours pay rises 2.31M → 4.18M, while net/s falls 8,740 → 6,446 because the pushed clock now stays busy longer. Five/eight-hour pipe-bound results are unchanged. The two-hour closing phase lasts 3–4.5 minutes.

Save version 19 migrates v17 GPU builds and v18 state, adds skip/closing fields and defaults skipped data on earlier kept reports. It retires completed, queued, parked and active `autoSkip`, releases its holders and adjusts stored research indices. Root loaded all five earlier earned probe saves plus the coverage fixture with GPUs intact. Opus's slice-2 verification passes 1,850 tests, typecheck, build and the overall bench. Root's four-viewport native tier purchases also pass with exact charges and fixed frames.

Opus reduces Rack research to 9M Data/90M Credits, retaining 25M ops work. The measured policy reaches Rack at 3:54, with its after-first-hour choice gap down from 58 to 39 min. D19's Rack band becomes about 3.5–5 h; later milestone targets stay unchanged. About 1.3 h of pipe plateau remains. The no-purchase opening now takes 57–147 s across four seeds, outside D20's 45–75 s range. Neither drift is hidden by the successful checks.

Root's independent post-regeneration eight-hour run confirms Rack at 3:54:04 and 264 purchases. It ends with four systems and 1.66B Credits; System arrives at 22:59.5. The active first round still lasts 9:36.8, and choice gaps remain 13.1/39.4 minutes. The report is `artifacts/qa/balance/2026-10-26T22-15-49-960Z/`; its old 5–7 h Rack expectation needs the adopted-band update. A successful `--no-fail` command is not a pacing pass. Root also passes all 1,850 tests, typecheck and build after regeneration.

The next slice should quantify the missing memory/work capacity and expose a purchase that clears the wall. A cheap cache or RAM level often does not. Skipped work is nominal unpaid payout, not a guaranteed income forecast; another resource or energy can still limit completion. Broader component feedback and full campaign quality remain open.

### Third slice, report first

The dev report now shows a required-capacity range against the fleet, a strip of logged skipped tasks and up to two quoted routes. Each route counts tasks that fit through the market's own capability check. A two-purchase route shows both costs, the total and wallet shortfall before either buy; step 2 is disabled until step 1 succeeds, then enables in the same frame. A normalized RAM energy ratio below one warns on its route. The first 64 skips are logged; the dominant gate and fit counts describe that bounded log, not every skipped task in a longer round. Only the dominant gate is shown in this first implementation.

Version 20 adds `hot.skipLog` and `report.skipped.tasks`. Versions 17–19 migrate with an empty log on older reports, preserving the existing GPU and retired-research migrations. The report does not reconstruct historical skipped tasks it did not log.


Opus reports 198 files/1,859 tests, typecheck and build passing. Root independently checks two native buys at 390×780, 320×568, 1280×800 and 844×390: each action's wallet and full build match the pure public action, the second starts locked and opens after the first, both charges match, and the report frame holds. One task lights after the route. Small phone and landscape each need one native wheel scroll to reach the route; no extra click. The first snapshot is not fully visible there. Evidence is `root-report3/`. RAM/cache plates and the broader incentive fix are not included in this handoff.

The user assigned the improvement decision to Opus 5.5 high. Root owns integration and documentation. Hardware opening must spend nothing, purchases retain concise prices and visible consequences, and internal clicks keep popup frames stable. The first slice does not establish complete interaction, touch, accessibility or campaign approval.

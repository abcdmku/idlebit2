# Backlog

Known issues carried past ship (lead, 25 Oct 2026). Decision IDs (D15, …) refer to [decisions.md](decisions.md).

- **Flat economy after Rack.** The real bot holds one rack of 12 kHz servers from Rack to Regions, with energy at about 1/3 of gross. Milestones land on time because Data accrues steadily and the research tiers are sized to that flat income. Fleet growth (more racks, rooms) must become the driver of income and pace; then W11–W15 get re-tuned. This is the first post-ship balance pass. **Rules answer: D25** (divisible tasks, router queues). In the design model, each doubling of a homogeneous fleet adds about 1 `I` and doubles income per round through 3 rooms, where whole tasks stall above 8 racks (`docs/tasks.md` §9, D25 run). Open after D25 lands:
  - re-run the real bot chain and re-tune W9–W15 and the post-Rack rungs to the stronger income;
  - teach the bot to buy racks and LB queue levels;
  - measure `fleetMax` with splits (architecture §1.10).
- **D25 base split on mixed hardware.** First-fit spread gives equal shares, so the slowest server sets a task's finish time, and the first server to free up can take a whole head alone. The model only covers homogeneous lockstep fleets. The real sim must show how much early-Rack income this costs before `lbWeighted`, Gather and shard stealing, especially for the starter rack, which mixes the old pre-Rack system with new barebones servers.
- **Choice gaps before Rack.** Up to about 2 h, while saving for `fabKhz` and `rack` with the Hz parts maxed. Pre-Rack rounds are 3–4 min, under the 4–10 min band.
- **The model and the real economy disagree** on absolute Credits (about 5e11 against 3e7 per round at Rack); they match on timing only.
- **GPU timing.** The first GPU comes at about 4 h; GPU tasks only pay after Rack (D15).
- **Desktop touch targets.** `npm run qa` flags three desktop controls under 44 px at boot (1280×800): the head task's Dismiss, the tray's buy row and the Research row. The phone layout passes.
- **D26 windows are loose on purpose.** At 2× the first draft, completion windows bind on whole tasks and under-levelled fleets, but barely on a well-built split fleet (−0.6 `I`). At the first draft's size they flattened D25 scaling, because the D25.11 floor's shards queue behind full K+Q system queues. The real sim should measure take-to-met latency per band before tightening `windowS`. If it must be tighter, measure from the first shard's start instead (the model kept scaling with that, 37.7 `I` at 864 systems).
- **D26 drive IO re-base needs a real-sim check.** Drives are now 1/16–1/2 of their era's RAM bandwidth, and a slow drive can be worse than none: it accepts work it can't finish in time. The model's HDD-speed rack earned 4.8e9 against 3.2e10 with no drive. Watch the Storage-era (System to Rack) choice: the first drive should still feel like a win for a RAM-poor box.

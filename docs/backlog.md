# Backlog

Known issues carried past ship (lead, 25 Oct 2026). Decision IDs (D15, …) refer to [decisions.md](decisions.md).

- **Flat economy after Rack.** The real bot holds one rack of 12 kHz servers from Rack to Regions, with energy at about 1/3 of gross. Milestones land on time because Data accrues steadily and the research tiers are sized to that flat income. Fleet growth (more racks, rooms) must become the driver of income and pace; then W11–W15 get re-tuned. This is the first post-ship balance pass.
- **Choice gaps before Rack.** Up to about 2 h, while saving for `fabKhz` and `rack` with the Hz parts maxed. Pre-Rack rounds are 3–4 min, under the 4–10 min band.
- **The model and the real economy disagree** on absolute Credits (about 5e11 against 3e7 per round at Rack); they match on timing only.
- **GPU timing.** The first GPU comes at about 4 h; GPU tasks only pay after Rack (D15).
- **Desktop touch targets.** `npm run qa` flags three desktop controls under 44 px at boot (1280×800): the head task's Dismiss, the tray's buy row and the Research row. The phone layout passes.

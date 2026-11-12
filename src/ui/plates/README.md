# Component popups

## Shared layout

Every hardware plate has the same title line and the same bottom action row. Both are in PlateFrame, so a plate passes data and never lays them out itself.

Title line: title, generation tag (`sub`), live usage (`usage`), then Close at the right. Examples: `RAM 1 · DDR · 0 b used`, `Generation · Solar farm · L1 · 928 mW / 100 MW`, `PDU · Metered PDU · L10 · 85.9 mW / 1.02 MW`. A usage that does not fit wraps under the title inside the title block. Nothing in the title line is cut short. A usage meter stays as the first row of the body.

Bottom action row (`.plate-actions`): one line, 44px tall. Downgrade and Remove sit at the left (ComponentActions, from the simulation's quotes), each with its refund on a second line. The next-generation key (`generation`, a GenerationAction) fills the rest of the line. A missing key leaves its room empty, and a disabled key stays in place, so the row never moves. Core removal says Remove core.

The next-generation key has two lines: `Upgrade to <target>`, then the resulting specs and the price. A key too narrow for a whole line first drops `Upgrade to`, then the specs. The target and the price always show whole. It uses the secondary tone unless the level ladder has ended, when it is the component's only purchase and uses the primary tone. Plates get the key from `generationKey` (PartKeys), `powerGeneration` (PowerKeys) or `switchGeneration` (SwitchPlate).

Level purchases stay above the bottom row: in the footer (PartKeys, memory tracks) or in the body (PowerKeys, the switch and GPU keys). Lock reasons remain intact; enabled actions retain visible keyboard focus.

Downgrade content is explicitly centered. Memory decrease controls use a centered pixel minus mark. Tier actions keep the target and resulting specs in one inline phrase, with the price aligned right; omit component names already shown in the header.

RAM and drives show separate Space and Speed rows. Each row contains its current value, a minus control, and an upgrade showing the resulting value and price. Remove is in the bottom row. Usage is on the title line, above the meter; repeated speed text is omitted so the complete panel keeps its height.

One-action hardware buys on its source control with price and stat gain (D72). Links, one-choice empty slots and parts without another generation or operating setting do not open a confirmation popup. Power and wallet limits disable that control in place. A choice between builds, generations or operating settings keeps its menu. Navigating to a simple part reveals the source control without purchasing it.

Component popups show current facts and buy only that component. Shared purchase text is in purchaseText.ts; QuoteKey renders the action, price and gain in one 44px button. A power limit disables that same button and displays Can't upgrade / No available power. RAM and drives use two 36px rows for independent Space and Speed changes. Generation changes start both tracks at level 1. While research locks the next generation, its key reads Research and opens the required research entry without purchasing or starting it. Once unlocked, it shows the target name, quoted specs and price and buys that component.


## Ownership audit

| Popup | Purchases |
|---|---|
| CPU package | CPU package replacement only |
| Cores | Core count only; no clock buy |
| Clock / cache | The selected CPU part |
| RAM / drive | The selected module; no additional module buy |
| GPU / NPU | The selected accelerator bay |
| Empty component site | One installation into that component slot |
| System queue | Its scheduler capacity; queue settings stay local |
| Rack PDU / room UPS / site grid | The selected supply |
| Rack / room cooling | The selected cooler |
| Rack / room switch | Its ports, uplinks and switch generation |
| Rack / room load balancer | Its router queue; local routing settings |
| Global scheduler | Its router queue; local routing settings |
| Pipe / uplink / zone link / backbone | That link's own speed |
| Power control | Its battery and integrated start controller |
| Room / global start controller | That controller |
| Site generation | That generator |
| Data plane | Its data plane and integrated router |
| Unit overview | Component navigation or a quoted one-action component row; room rows remain a room structural action |
| New system / rack / room / site | One selected whole build |

Supply menus do not sell start controllers. Overviews show a quoted component action when it is the only choice, or open that component's menu when it has choices or settings. Each purchase still belongs to the selected component. Room switch and load-balancer views are separate.

## Verification

Run npm run verify and the documented QA captures at all four standard viewport sizes. Check component ownership, direct controls, and local list scrolling. Temporary probes and captures stay under artifacts/qa and are not committed.

D73: no dropdowns or accordions. Use ChoiceStrip for visible choices and local scroll-list regions only for long lists. ComponentActions renders simulation-owned downgrade/removal quotes. Save belongs beside Close. Next-generation actions show resulting specs only.

Phone rules (mobile first): nothing is truncated and no label touches its key's edge. Router strategy keys keep 6px of padding on a portrait phone; a name wraps at a space, or after its hyphen when one word is wider than the key (320px). Queue order keys are as wide as their names plus an equal share of the spare room. The Cores list is one column unless a column can hold the longest task name. The switch always lists its ports (a line each while matched, a key each while not), so Match port speeds never resizes the plate. A list that can scroll fades at the edge that hides more (`data-above`, `data-below`, set by PlateFrame). Close and the stepper keys have 44px square touch areas. Stepper minus and plus are drawn from the same 2px bars. `artifacts/qa/nine/m-plates/stability.mjs` checks all of this, and Escape, Close and phone Back, at 390, 320, 844 and 1280.

Control size: `--ctl` is 32px for a mouse and 40px on the phone layout or a coarse pointer, where each control's hit area reaches 2px into the 4px gaps (44px targets that never overlap). Router strategy names are never abbreviated: a portrait phone wraps a long name onto the key's second line, and the desktop router plate is wide enough for one line. A purchase research still locks (QuoteKey) opens that research. An empty queue shows one quiet line in a list of fixed height.

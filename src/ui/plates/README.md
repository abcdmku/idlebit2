# Component popups

Downgrade controls use compact buttons sized to their labels. Remove is an underlined text button at the right of the same row, with no border or fill. Core removal says Remove core. Lock reasons remain intact; enabled actions retain visible keyboard focus.

Downgrade content is explicitly centered. Memory decrease controls use a centered pixel minus mark. Tier actions keep the target and resulting specs in one inline phrase, with the price aligned right; omit component names already shown in the header.

RAM and drives show separate Space and Speed rows. Each row contains its current value, a minus control, and an upgrade showing the resulting value and price. Remove stays separate. Usage remains above the meter; repeated speed text is omitted so the complete panel keeps its height.

One-action hardware buys on its source control with price and stat gain (D72). Links, one-choice empty slots and parts without another generation or operating setting do not open a confirmation popup. Power and wallet limits disable that control in place. A choice between builds, generations or operating settings keeps its menu. Navigating to a simple part reveals the source control without purchasing it.

Component popups show current facts and buy only that component. Shared purchase text is in purchaseText.ts; QuoteKey renders the action, price and gain in one 44px button. A power limit disables that same button and displays Can't upgrade / No available power. RAM and drives use two 36px rows for independent Space and Speed changes. Generation changes start both tracks at level 1. GenerationAction uses a compact transparent text button with tier, specs and price inline. While locked, Research opens the required research entry without purchasing or starting it. Once unlocked, Upgrade shows the target name, quoted specs and price and buys that component.


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

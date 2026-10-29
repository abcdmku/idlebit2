# Component popups

Component popups show current facts and buy only that component. Shared purchase text is in purchaseText.ts; QuoteKey renders the action, price and gain in one 48px button. A power limit disables that same button and displays Can't upgrade / No available power. RAM and drives have separate Space and Speed buttons side by side in that same footer height. Generation changes start both tracks at level 1. GenerationAction renders a transparent 44px text button for the next generation. While locked, Research opens the required research entry without purchasing or starting it. Once unlocked, Upgrade to shows the target name, quoted specs and price and buys that component.

No popup inserts a supply-preparation purchase, another component's upgrade, or a separate stat-increase/cold-swap paragraph. Empty fact rows are omitted. The next generation is directly visible; operating settings use disclosures. Opening a disclosure can resize the popup; runtime status, wallet and quote updates retain its geometry. Empty-slot popups close after a successful installation.

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
| Unit overview | Component navigation; room rows remain a room structural action |
| New system / rack / room / site | One selected whole build |

Supplies do not sell start controllers. The site overview does not sell generation or data-plane queues. Those parts have their own popups through component navigation. Room switch and load-balancer views are separate.

## Verification

The task QA manifest covers every family above, installed and empty states, and the power-limit case at 1280x800, 844x390, 390x780 and 320x568. Browser checks inspect each purchase action for component ownership, confirm the 48px key height, and reject standalone upgrade prose. Explicit settings/type disclosures and real purchases are checked separately. Use the repository's scripts/qa/capture.mjs workflow with the development server for screenshots and the layout audit. Generated captures and temporary probes belong under artifacts/qa and are not committed.

# Plates

A tap on hardware opens its plate and spends nothing. Targets without a plate use the upgrade callout (`callout/`). `PlateLayer` renders the full plate for `useViewState().selected`. A save icon opens its prompt at once. Each plate reads `../storeHooks` (`useShell`, `useGameSelector`, `useViewState`, `useQuote`).

## What the plates need from the shell

- `surface.plateBounds` (safe rect), `surface.renderer.anchor(id, out)` (plates sit under or over their target), `surface.frameListeners` (re-place on camera frames), `surface.layout.kind`.
- View commands used: `cancel` (close), `select` (server ‹ ›, "Save this …" opens the save prompt as a `save` target), `openResearch {project}`, `drill` (server "Go inside").

## Target → plate

| `HitTarget` | Plate | Quote request |
|---|---|---|
| `slot` at rack / room / global | Configuration plate (server / rack / zone or site) | `add` (parent = `target.unit` or the focus unit) |
| `slot` at chip / system | Part plate (via `target.part`) | `part`, else `tray` |
| `part` psu, pdu, ups, grid | Supply plate | `part` (psu, grid) or `infra power` |
| `part` rackCooler, roomCooler | Cooler plate | `infra cooling` |
| `part` lb | Load balancer plate | `infra lb` |
| `part` switch / `port` (rack) | Switch plate | `switch` |
| `part` roomSwitch, roomLb / `port` (room) | Network rack plate | `switch` + `infra lb` |
| `part` globalScheduler | Load balancer plate (global) | `part` |
| any other `part` / `link` | Part plate (upgrade vs replace, payback) | `part` |
| `unit` | Server plate (‹ › ≥ 44 px), or system / rack / room / site plate with the online row | — |
| `save` | Save-name prompt, pinned top | — |

Quote order the plates read follows contract request R13.

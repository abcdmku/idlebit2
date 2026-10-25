# Renderer: how to build a level

The renderer consumes `RenderSnapshot` level snapshots and draws them; it owns camera and cosmetic effects only.

## Rules

- Import the sim only through `src/game` (types and constants). Tests and dev pages may also import `src/game/fixtures`.
- Import render helpers from `../../core` (the core barrel), never from `src/render/index.ts`, because that barrel imports the levels.
- A level only displays state. It reads its level snapshot and returns hit targets. It never computes prices or game values, requests quotes or changes state.
- Keep files under 300 lines.

## Plug in

Create `levels/<id>/index.ts` and export one factory. `levels/index.ts` finds it with `import.meta.glob`:

| Level | Factory |
|---|---|
| chip | `createChipRenderer(registry)` |
| system | `createSystemRenderer(registry)` |
| rack | `createRackRenderer(registry)` |
| room | `createRoomRenderer(registry)` |
| global | `createGlobalRenderer(registry)` |

Each factory receives the shared `LevelRegistry`. A parent level draws a child's mini with `registry.level('system').drawMini(...)`.

## `LevelRenderer<L>` (core/types.ts)

Every geometry method takes an optional trailing `form` (`'desktop' | 'phone'`, from `RestFraming.form`; desktop by default). A level may lay out per form; keep each form stable.

| Member | Contract |
|---|---|
| `size(s, out, form)` | The world size in art px. It sizes the world buffer. |
| `focus(s, viewport, out, form)` | The rect inside `size` that the rest camera frames. |
| `entry?(s, out, form)` | Where the inbound link meets the art, at its top (D17): CPU the IN pad, System the port cable (x 33, y 0), Rack the ceiling uplink, Room the gateway fibre, World the backbone hub. The framed rest puts it on the lattice, and the core's pipe drops into it. Without it the core uses the top centre of a target with id `entry` (pipe only, no snap). |
| `miniRect?(s, out, form)` | The rect of this world that a parent's mini of it shows; defaults to `size`. The CPU reports its package, so System → CPU dives into the socket. |
| `draw(g, s, view, frame)` | Draws the full world into the buffer in art px. `g` is already offset by `size.x/y`. |
| `labels?(s, view, frame, out)` | Value labels through `LabelWriter` (see Text). The core draws them, at rest only. |
| `drawMini(g, source, rect, frame)` | This level as a mini in a parent world: `chip` gets `SystemSnapshot`, `system` `ServerSlotView`, `rack` `RackSlotView`, `room` `ZoneView`. |
| `children(s, out, form)` | Drillable children `{ ref, rect, world? }` from index 0; return the count (at most `MAX_CHILDREN`). `rect` is the tap rect. `world` (reset to null before each call) is where the child's world lands in the zoom when that differs: the rack row's span, the board on the sled. |
| `targets(s, view, out, from, form)` | Tap targets, back to front, from `from` (the children already fill `out[0..from)`). Reuse entries with `resetHitTarget`; at most `MAX_TARGETS`. |
| `followFocus?(s)` | True while the player drags the view (rack row): the rest camera follows the focus with no 0.25 s lerp. |
| `unitAnchor?`, `faults?`, `icon` | Payout coin rect, live fault rects (they smoke), the 16×16 rail icon. |

## Hits and commands

The renderer does not emit commands. `renderer.hit(x, y)` returns a borrowed `HitTarget`; the UI maps it to a `ViewCommand` or a callout. `renderer.anchor(id, out)` gives a target's CSS rect, for placing its callout beside it.

| `kind` | Fields | The UI does |
|---|---|---|
| `child` | `drill` (the core sets it) | Zooms in. |
| `part` | `part: PartRef`; `drill` when the part can be entered (System CPU) | Opens its upgrade callout ("x → x", price, Buy). A second tap or Open drills when `drill` is set. |
| `slot` | `slot` (`BuildSlotView.index`, or the server or rack slot), `unit` | Opens the add callout or the configuration plate. |
| `save` | `unit` | Opens the save-name prompt. |
| `unit` | `unit` | Opens the online switch row (the lamp). |
| `port` | `sw`, `port` (`-1` = uplink) | Opens the switch plate on that port. |
| `link` | level-specific `id`; `pipe` (CPU, System) has `unit` | Opens the link callout. The pipe stays at its default until its upstream device exists (D15.5). |

- Give every target a stable `id`; it is the selection key, and the core brackets `view.selectedId`.
- Rects are in focus-world art px. Do not pad them; the core pads every target to 44 CSS px. Overlaps: exact hits win, then the nearest, then the frontmost.
- CPU targets: `clock`, `cache`, `queue` (part, or slot before a scheduler), `core<i>` (part), `site<i>` (slot), `pipe` (link). System targets: see `levels/system/index.ts` (`cpu<k>` with drill, `ram<i>`, `gpu<i>`, `drive<i>`, `psu`, `pipe`, `slot-*`, `save`, `unit`).

## Rest framing (L2, D17)

`renderer.resize(w, h, dpr, viewport, framing)` takes a `RestFraming` (`DESKTOP_FRAMING`, `PHONE_FRAMING` in `core/camera.ts`):

- `scale` N (3 desktop, 2 phone): every rest draws 1:1, one art px = N CSS px.
- `top`: CSS px from the viewport top to the free world, the band plus the queue strip (96 desktop, 128 phone). The focus centres below it. A focus taller than that keeps its top, where the link enters, and crops at the bottom.
- `lattice` (24 desktop, 8 phone): the level's `entry()`, else its world origin, snaps to it from the viewport origin.
- `pipe` (optional, CSS px `{ x, y, runY }`): the core draws the inbound pipe from under the head slot down to `runY`, across, and into the entry, 4 art px wide, with the link label and packet tag under the run. A transfer rides it at its real progress; one shorter than 0.25 s is a landing flash (`core/pipe.ts`). During a zoom only the first drop shows. `inbound(snapshot)` gives each level's link name, speed and transfer.
- At rest `frame.visible` is the world rect (art px) below `top`; it is null during a zoom.

Without a framing the old largest-integer fit applies (harness, previews).

## Zooms, partners and minis

- The sim publishes two level snapshots: `snapshot.focus` and, during a zoom, `snapshot.partner`. The renderer starts a zoom when the focus changes and `partner` is the previous focus, one level apart. Any other change cuts.
- **Timing and easing are the mockup's** (core/view.js): one cubic in-out over `min(2.6, 0.62 + 0.56 n)` s for n levels; a 0.26 s cross-fade under reduced motion. The UI chains a multi-level jump one level per transition. Set `ViewPresentation.zoomGoal` to the goal level (ViewState.goal) and the core plays the steps as slices of one curve (`core/chain.ts`), so the camera does not stop between levels.
- **Rapid requests queue in the UI, and the last one wins.** While `renderer.transition` is non-null, keep the focus and store the goal. After a draw where it is null, drop the partner and step toward the goal. `core/sequence.test.ts` drives exactly this protocol in both directions.
- During a zoom the parent world is drawn in full. The child's world fades in over the parent's mini at its child rect (`world ?? rect`), through the child's `miniRect`. Draw the mini as the child world shrunk into that rect.
- **Choreography** (`core/choreo.ts`). A level finds itself on the zoom with `zoomLink(frame.zoom, keyOf(s), link)` (no allocation), then:
  - Rack ↔ System: `sledOut(link, reduced)` slides the drilled server's sled out (mockup rack/world.js `drillOf`).
  - Room ↔ Rack: `hallDim(link, reduced)` dims the hall ahead of the push-in (datacenter/world.js `transInfo`).
  - World ↔ Room: `siteSink(link, reduced)` sinks the site into the map (global.js `diveOf`).
  - System ↔ CPU: the camera alone dives into the package (`miniRect`).
- `transitionAlpha(frame.zoom, key)` tells a mini how far its full world has faded in. `drawContained(g, rect, size, draw)` draws a world into a rect with the zoom's contain transform.
- Labels and selection brackets hide during a zoom. The HUD and deck are DOM and never move.
- **One bad frame never stops the loop.** Every level call (draw, labels, targets, children, entry, faults) is guarded. A failure is logged once per place and message (`reportRenderError`) and the frame goes on. A throw anywhere else cuts the zoom, and the next frame draws at rest.

## Motion: real state at its real rate

Program §1 and v2 program §7 apply:

- Read time only from `frame.timeMs`: `simTimeMs` plus at most 100 ms of extrapolation, frozen while `frame.paused`. Never read `performance.now()` or `Date`.
- Lanes, clock LEDs and meters: `rateAnimation(rate, frame.timeMs, cells, active, out)`. A 1 Hz part steps once per second; at `EYE_RATE_HZ` (30) or above it is steady. Idle hardware is still.
- Fans: `fanAnimation(key, frame.timeMs, cooler.duty, out)`; 3 rev/s at 100% duty on every level.
- Transfers: `transferProgress(transfer, simTimeMs, timeMs)`; packets travel only when the transfer lasts at least `MIN_VISIBLE_TRANSFER_S`.
- Timers: `drawUnitLamp(...)`; feed countdowns `secondsLeft(...)`.
- Glow is temperature (`heatFx`), a fault is `faultFx` while it holds, offline is `darkFx`.
- While `frame.paused`, draw steady power LEDs only. The core draws the veil.
- No idle twinkles, breathing pulses, sheens or decorative blinks.

## Text (D2.1, D11)

- World labels (block names, part values) are written by the level through `labels()` and drawn by the core in Chakra Petch at the one body size (16/24 desktop, 13/16 phone), weight 500, or 700 for names, on the 8 px text grid, crisp at device resolution. `out.label(id, x, y, align, tag).text(text, tone, bold).br()`.
- Values: the formatters in `core/format.ts` (`hertz`, `bitsText`, `bitRate`, `wattsText`, `whole`, `opsText`, `secondsText`) over snapshot fields. Never compute a value.
- Prices and callouts are DOM (U).
- Canvas text waits for the font (`loadCanvasFont`, D11.4).
- `silk` (3×5 glyphs) is only for silkscreen markings that are part of the art. Never scale it up into a label.

## Shared world pieces (core)

- `unit.ts`: `drawSaveIcon`, `saveIconRect`, `lampState`, `drawUnitLamp`, `drawVeil`.
- `feed.ts`: `drawCart`, `drawFamilyGlyph` (by `FamilyId`), `drawReq`, `drawCause`, `deadlineMs`.
- `pipe.ts`: `drawPipe`, `inbound`, `transferProgress`.
- `familyIcons/` (task types and family icons, D23, for the canvas and the UI shell):
  - Task types group the catalog bands. Each type has one colour and one frame silhouette:

    | Type | Bands | Colour | Frame |
    | --- | --- | --- | --- |
    | `compute` Compute | bits, ints | `#7fe3ff` | chip with pins |
    | `parallel` Parallel | threads | `#b18cff` | two stacked plates |
    | `memory` Memory | ram | `#ff8c42` | RAM stick with contacts |
    | `accel` Accelerated | gpu | `#c2e05a` | tensor cube |
    | `storage` Storage | storage | `#d6ab78` | disk cylinder |
    | `cluster` Distributed | rackDist, roomDist | `#aab3d4` | four linked nodes |
    | `zones` Multi-zone | multiAz | `#4f9dff` | twin-gable halls |
    | `region` Regional | region | `#ff8fb3` | globe |

  - A family icon is its type's frame with the family's glyph on the frame's dark plate, so a type's families read as a set. Every icon is a 16×16 art cell: a 14×14 silhouette with a 1 px ink outline baked into the margin, so it reads on the void, the cards and the core purple. Each run of one colour is one fill of N px height, on the N grid.
  - `typeOf(family)`, `typeColor(type)`, `typeName(type)`, `TASK_TYPES`, `TYPE` (name, bands, `a` colour, `d` shade, `l` light, `k` plate), `BAND_TYPE`.
  - `drawFamilyIcon(g, family, x, y, N = 1, tone = 'type' | 'fail')` and `drawTypeIcon(g, type, x, y, N = 1, tone)`: draw the icon in the 16×16 cell at (x, y). `family` is a `FamilyId` or its key (`familyKey`).
  - `paintFamilyIcon(canvas, family, N, dpr = 1, tone)` and `paintTypeIcon(canvas, type, N, dpr, tone)`: for DOM. They size `canvas` to 16N × 16N CSS px (backed at `dpr`), set `image-rendering: pixelated` and paint the icon.
  - `bandColor(family)` returns the family's type colour, and `BAND[band]` carries its type's colours. `familyName`, `familyBand`, `hasFamilyIcon` and `FAMILY` read the game catalog. Also `FAMILY_CELL` (16) and `FAMILY_ICON` (14). Requirement pips: `drawPip(g, req, x, y, N, mini)` and `PIPS`.
  - The art lives in `familyIcons/art/` (`types.mjs`: types, colours, frames; `glyphs-*.mjs`: 10×10 glyphs; `catalog.mjs`: band and family names, requirement pips). Regenerate the data with `node src/render/core/familyIcons/generate.mjs`. The generator refuses glyphs that leave the plate, bands without a type, and duplicate icons.
- Task numbers are never drawn (user): a task shows as its family icon and name.
- `px.ts`, `palette.ts`, `glyphs.ts`, `sprites.ts`, `decoration.ts`: pixel primitives, one palette, the 3×5 glyphs, the sprite cache and state overlays.

## Try it

- `/src/render/core/l2.html`: the real levels over the sim's view fixtures in the L2 D17 frame (N, lattice, band, strip, pipe). Query: `form=desktop|phone`, `level=chip|system|rack|room|global`, `zoom=<from level>&hold=<0..1>`, `scene=boot|landing|mid|max|paused` (CPU QA scenes), `boot` (boot fixtures: a general board). Captures: `MSYS_NO_PATHCONV=1 node scripts/qa/capture.mjs --manifest=artifacts/qa/port/ra/manifest.json --out=artifacts/qa/port/ra --game-path=/src/render/core/l2.html`.
- `/src/render/core/harness.html`: every registered level over `LEVEL_FIXTURES`, with zoom buttons and a hold slider. `window.__r1` exposes `go(level)` and `hold(progress)`.

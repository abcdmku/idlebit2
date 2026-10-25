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
| `focus(s, viewport, out, form, area?)` | The rect inside `size` that the rest camera frames, whole (see Rest framing). `area` (the free world in CSS px and the shell's N) lets a wide world frame part of itself: the rack row, the World map. |
| `entry?(s, out, form)` | Where the inbound link meets the art, at its top (D17): CPU the IN pad, System the port cable (x 33, y 0), Rack the ceiling uplink, Room the gateway fibre, World the backbone hub. The framed rest puts it on the lattice, and the core's pipe drops into it. Without it the core uses the top centre of a target with id `entry` (pipe only, no snap). |
| `miniRect?(s, out, form)` | The rect of this world that a parent's mini of it shows; defaults to `size`. The CPU reports its package, so System → CPU dives into the socket. |
| `draw(g, s, view, frame)` | Draws the full world into the buffer in art px. `g` is already offset by `size.x/y`. |
| `labels?(s, view, frame, out)` | Value labels through `LabelWriter` (see Text). The core draws them, at rest only. |
| `drawMini(g, source, rect, frame)` | This level as a mini in a parent world: `chip` gets `SystemSnapshot`, `system` `ServerSlotView`, `rack` `RackSlotView`, `room` `ZoneView`. |
| `children(s, out, form)` | Drillable children `{ ref, rect, world? }` from index 0; return the count (at most `MAX_CHILDREN`). `rect` is the tap rect. `world` (reset to null before each call) is where the child's world lands in the zoom when that differs: the rack row's span, the board on the sled. |
| `targets(s, view, out, from, form)` | Tap targets, back to front, from `from` (the children already fill `out[0..from)`). Reuse entries with `resetHitTarget`; at most `MAX_TARGETS`. |
| `followFocus?(s)` | True while the player drags the view (rack row): the rest camera follows the focus with no 0.25 s lerp. |
| `payoutAnchor?(s, c, out, form)` | The component that completed `c` (a `CompletionView`): CPU core, System socket or GPU card, Rack sled, Room rack, World site. Writes its rect and returns a key stable per component, or -1 when it isn't shown. See Payouts. |
| `popWindowMs?`, `partVersion?(s, id)`, `restEaseS?` | How long completions join a component's pop (Room 1 s). A number that rises when part target `id` is upgraded, for the purchase flash. Seconds the rest camera eases to a new focus (rack row 0.15). |
| `faults?`, `icon` | Live fault rects (they smoke), the 16×16 rail icon. |

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

- `scale` N (3 desktop, 2 phone): the shell's art scale; one art px = N CSS px.
- `top`: CSS px from the viewport top to the free world, the band plus the queue strip (144 at 1440×900, 192 at 390×780).
- **Contain-fit (A05, D15.2).** The free world is the view below `top` minus the gutters (`gutters()`; `RestFraming.gutters` overrides). Desktop: left 216 (the pipe's vertical run and its tag), right 312 (the UI's callout dock, 288 plus a lattice); phone: a lattice each side; both: the pipe run on top. The focus rests whole and centred there at N, or at the largest lower integer scale that fits (`fitScale`), never cropped, and never below 2 (N = 1 is too small to read): a level that doesn't fit whole at 2 rests at 2 and pans (`core/restPan.ts`, `restPan`), centred by `restCentre` (Room: the active rack's row; World: the owned sites) and snapped by `panSnap`. Only `wholeAtRest` levels (System, D15.2) skip the pan; on desktop the core reports one that doesn't fit at 2. `frame.scale` is that rest scale; labels pick their arrangement and type by it (`typeForScale`: the desktop type at 3, the phone type at 2 and below).
- `lattice` (24 desktop, 8 phone): the level's `entry()`, else its world origin, snaps to it from the viewport origin.
- `pipe` (optional, CSS px `{ x, y, runY }`): the core draws the inbound pipe from under the head slot down to `runY`, across, and into the entry, 4 art px wide, with the link tag and the packet tag under it, in the left gutter. A transfer rides it at its real progress; one shorter than 0.25 s is a landing flash (`core/pipe.ts`). During a zoom the pipe follows the entry as it moves between the two worlds (A27). `inbound(snapshot)` gives each level's link name, speed and transfer.
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
- Labels fade out over the first 15% of the eased zoom and in over the last 20%, each through its own world's camera (`core/zoomLayer.ts`, A27). Selection brackets hide during a zoom. The HUD and deck are DOM and never move.
- **Rack row (A06, `rack/row.ts`).** Clamped so the row's first and last racks stop at the view edges. Ending a gesture snaps to the rack pitch in 0.15 s. A tapped neighbour holds for a frame, then eases to the framed rest. The UI divides drag px by `rackRowScroll.scale` (the rest scale) and may call `release(velocity)`.
- **World (A09, `global/pan.ts`).** The rest frames the owned sites plus one region of context, cut to the free world. When that doesn't fit at 2 the core's `restPan` pans the map (`worldPan` is the same object), clamped to it.
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

## Payouts

Work pays on the component that ran it. Nothing flows out to the deck or the HUD; no level draws an output trace. Tasks still enter every level from the top, over the inbound pipe.

- The sim lists each completion in `snapshot.completions` (`system`, `cpu`, `core`, `gpu`, `rack`, `room`, `site`, `type`, `credits`, `data`, `tick`, `tau`, `seq`). The core reads each `seq` once. At rest and while running, it asks the focus level's `payoutAnchor` where the completion lands. Completions during a zoom, a pause or a load are only consumed.
- `core/pops.ts` (`PayoutPops`) draws a plate on that component at the completion's time, `(tick + tau) × TICK_MS`. The plate shows the coin and `+Credits` in gold, then the gem and `+Data` in the Data green, the HUD's icons and colours. It uses whole numbers, Chakra Petch 700 at the body size, 8 art px icons at N, and edges on the N grid. It rises 3 art px, one px at a time, then fades out at 1 s.
- **No spray.** Completions on one component within 250 ms sum into one pop. Each component has at most one live pop; a later completion replaces it. A plate that would cover another component's pop in its first half waits, and keeps summing, until it fits. Anything older than 1 s is dropped. There are at most 24 pops.
- Reduced motion: no rise or fade; the pop shows for its second.
- **Pay is per whole task (user).** A pop means a task completed and paid. A task run on several members, or (D25) split into shards, pays once, with its whole payout, on the component that finished its last member or shard; the sim lists only those completions. A shard that finishes earlier shows only its piece emptying, with no currency. A level's `payoutAnchor` rects are also the targets a split task's pieces flow to.
- L2 harness: `l2.html?level=<id>&pops=<age ms>` holds QA pops at that age on the level's first components.
- **Other feedback (`core/feedback.ts`).** A failure (`snapshot.failures`, by `seq`) beats its red cause mark at the pipe mouth for 0.4 s (A11). A part whose `partVersion` rises, or that appears, flashes gold with a 1·N bracket for 0.3 s, once (A10).

## Split tasks (D25)

- A task arrives from the top and splits into shards. Each shard is one transfer (`FlowView`, `core/flows.ts`): a shared uplink carries a task's shards in turn (one travels, the rest wait as a stack at its mouth), ports carry them in parallel. Shards of one take share `taskId` and draw in their task type's colour; `drawFork` marks the router where their paths diverge. Positions come only from `bitsSent / bits`; a transfer shorter than `MIN_VISIBLE_TRANSFER_S` is a landing flash.
- Level flows: `RackSnapshot.flows` (uplink, ports), `RoomSnapshot.flows` (zone link, rack uplinks), `GlobalSnapshot.flows` (data plane, backbone), `SystemSnapshot.inbound` (its port). The core pipe reads each level's top-link shard (`inbound`).
- Pay is for the whole task: one completion, one pop, on the component that finished the last shard. A finished non-final shard (`RenderSnapshot.shardsDone`, by `seq`) only drains its piece on that component for 300 ms (`core/shardDone.ts`), located by the level's `payoutAnchor`.
- Router queues: `LbView.queue` wells in the LB's slot (`drawLbQueue`), filled by queued entries in their task colour.

## Text (D2.1, D11)

- World labels (block names, part values) are written by the level through `labels()` and drawn by the core in Chakra Petch at the one body size (16/24 desktop, 13/16 phone), weight 500, or 700 for names, on the 8 px text grid, crisp at device resolution. `out.label(id, x, y, align, tag).text(text, tone, bold).br()`; `.leader(x, y)` adds a 1·N leader from the label to an art point (the Room's fixture tags, A20).
- Values: the formatters in `core/format.ts` (`hertz`, `bitsText`, `bitRate`, `wattsText`, `whole`, `opsText`, `secondsText`) over snapshot fields. Never compute a value.
- Prices and callouts are DOM (U).
- Canvas text waits for the font (`loadCanvasFont`, D11.4).
- `silk` (3×5 glyphs) is only for silkscreen markings that are part of the art. Never scale it up into a label.

## Shared world pieces (core)

- `unit.ts`: `drawSaveIcon`, `saveIconRect`, `lampState`, `drawUnitLamp`, `drawVeil`.
- `pops.ts`: `PayoutPops`, `completionMs`, the `Completion` shape (see Payouts).
- `feed.ts`: `drawCart`, `drawFamilyGlyph` (by `FamilyId`), `drawReq`, `drawCause`, `deadlineMs`.
- `pipe.ts`: `drawPipe`, `inbound`, `transferProgress`.
- `familyIcons/` (task types and their icons, D23, set F, for the canvas and the UI shell):
  - Task types group the catalog bands; each has one colour ramp (`TYPE`: name, bands, `a` colour, `d` shade, `l` light, `k` plate) and one icon. Compute, Parallel, Memory, Accelerated, Storage, Distributed, Multi-zone, Regional.
  - **Every family shows its type's icon** in its type colour (set F, `setF.ts`): family glyphs are retired, and the family name is text on the card. Icons are 16×16 art cells, a 14×14 silhouette with a 1 px ink ring baked into the margin, so they read on the void, the cards, the purple core tile and the LCD.
  - `drawFamilyIcon(g, family, x, y, N = 1, tone = 'type' | 'fail')` and `drawTypeIcon(g, type, x, y, N, tone)` draw the icon at integer scale N; `paintFamilyIcon` and `paintTypeIcon` paint it into a DOM canvas (16N × 16N CSS px at `dpr`, pixelated). `drawTypeMini(g, type, x, y, N)` draws the 5×5 mini the sled LCD uses.
  - `typeOf(family)`, `typeColor`, `typeName`, `TASK_TYPES`, `BAND_TYPE`, `bandColor`, `BAND`, `familyName`, `familyBand`, `FAMILY`, `FAMILY_CELL` (16), `FAMILY_ICON` (14). Requirement pips: `drawPip(g, req, x, y, N, mini)` and `PIPS`.
  - The matrices are literal (`setF.ts`, from `artifacts/icons/index.html`); there is no generator.
- Task numbers are never drawn (user): a task shows as its family icon and name.
- `px.ts`, `palette.ts`, `glyphs.ts`, `sprites.ts`, `decoration.ts`: pixel primitives, one palette, the 3×5 glyphs, the sprite cache and state overlays.

## Try it

- `/src/render/core/l2.html`: the real levels over the sim's view fixtures in the L2 D17 frame (N, lattice, band, strip, pipe). Query: `form=desktop|phone`, `level=chip|system|rack|room|global`, `zoom=<from level>&hold=<0..1>`, `scene=boot|landing|mid|max|paused` (CPU QA scenes), `boot` (boot fixtures: a general board). Captures: `MSYS_NO_PATHCONV=1 node scripts/qa/capture.mjs --manifest=artifacts/qa/port/ra/manifest.json --out=artifacts/qa/port/ra --game-path=/src/render/core/l2.html`.
- `/src/render/core/harness.html`: every registered level over `LEVEL_FIXTURES`, with zoom buttons and a hold slider. `window.__r1` exposes `go(level)` and `hold(progress)`.

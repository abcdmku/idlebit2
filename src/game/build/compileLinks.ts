import { LINK_COMPILED, LINK_KIND, type CompiledBuffers } from '../core/buffers';
import { MAX_RACK_PORTS, MAX_ROOM_PORTS, MAX_UPLINKS, MAX_ZONES_PER_SITE, REGIONS, secondsToTicks } from '../core/constants';
import { ensureRows } from '../core/table';
import type { BuildState, SwitchBuild } from '../types/build';
import { REGION_IDS } from '../types/catalog';
import type { Unlocks } from '../types/state';
import { ladderSpeed, LADDERS, portWatts, type LadderDef } from './catalog';
import { hasRule, ruleParam } from './research/unlocks';

/*
 * Links (spec §7.2). The link table is rebuilt whole on every compile. sys.pipeSpeed is every
 * system's rack-switch port speed (D13); before Rack it carries the lone system's tasks. One row per link:
 *   server   one per rack switch port of an opened rack, owner = rack. Ports go to occupied server
 *            slots in slot order: sys.port = p, rack.portLink[p] = row. Spare ports still draw idle.
 *   rack     one per opened rack, owner = rack, channels = rack uplinks. Speed is the slowest
 *            channel, min(uplink, the rack's room port) once Room opens; every rack.uplinkLink[j]
 *            and room.portLink[the rack's room slot] point at it (R25). Room ports go to occupied rack
 *            slots in slot order; a rack past the port count has no link. Watts: rack uplinks + room port.
 *   zone     one per opened room, owner = room, channels = room uplinks, min(uplink, data plane)
 *            once Global opens; latency = data plane latency. room.uplinkLink[j], site.dpLink[zone].
 *   backbone one per opened non-gateway site, owner = the remote site, k and latency by generation
 *            (× subseaLatency factor between continents on Subsea).
 * `rung` is the slowest channel's ladder index.
 */
interface LinkRow { kind: number; owner: number; channels: number; rung: number; speed: number; latency: number; idle: number; load: number }

const portW = (row: LadderDef, gen: number, ks: readonly number[]) =>
  ks.reduce((acc, k) => { const w = portWatts(row, gen, k); return { idle: acc.idle + w.idle, load: acc.load + w.load }; }, { idle: 0, load: 0 });

function channelLink(kind: number, owner: number, row: LadderDef, sw: SwitchBuild, capK: number | null, extra: { idle: number; load: number }, latency = 0): LinkRow {
  const ks = sw.uplinks.map((k) => (capK === null ? k : Math.min(k, capK)));
  const rung = ks.length ? Math.min(...ks) : 0;
  const w = portW(row, sw.gen, sw.uplinks);
  return { kind, owner, channels: sw.uplinks.length, rung, speed: sw.uplinks.length ? ladderSpeed(rung) : 0, latency, idle: w.idle + extra.idle, load: w.load + extra.load };
}

export function compileLinks(c: CompiledBuffers, build: BuildState, u: Unlocks): void {
  const links: LinkRow[] = [];
  const add = (row: LinkRow) => links.push(row) - 1;
  const sw = LADDERS.switch, rsw = LADDERS.roomSwitch, dp = LADDERS.dataPlane, bb = LADDERS.backbone;

  /** Room port index and k for each rack (ports go to occupied rack slots in slot order). */
  const roomPort = new Map<number, { room: number; slot: number; k: number }>();
  for (const room of build.rooms) {
    if (!room?.opened) continue;
    let p = 0;
    room.racks.forEach((rackId, slot) => {
      if (rackId === null || !build.racks[rackId]) return;
      if (p < room.switch.ports.length) roomPort.set(rackId, { room: room.id, slot, k: room.switch.ports[p]! });
      p += 1;
    });
  }

  for (const rack of build.racks) {
    if (!rack) continue;
    // D13: a system's pipe is its rack-switch port, in slot order. Before Rack it is the only link.
    let p = 0;
    for (let slot = 0; slot < rack.servers.length; slot += 1) {
      const sys = rack.servers[slot];
      if (sys === null || sys === undefined || !build.systems[sys]) continue;
      const k = rack.switch.ports[p];
      c.sys.pipeSpeed[sys] = k === undefined ? 0 : ladderSpeed(k);
      c.sys.pipeWPerBit[sys] = sw.wPerUnit;
      if (rack.opened) c.sys.port[sys] = k === undefined ? -1 : p;
      p += 1;
    }
    if (!rack.opened) continue;
    rack.switch.ports.forEach((k, port) => {
      const w = portW(sw, rack.switch.gen, [k]);
      c.rack.portLink[rack.id * MAX_RACK_PORTS + port] = add({ kind: LINK_KIND.server, owner: rack.id, channels: 1, rung: k, speed: ladderSpeed(k), latency: 0, idle: w.idle, load: w.load });
    });
    const rp = roomPort.get(rack.id);
    const room = rp ? build.rooms[rp.room]! : null;
    const extra = rp && room ? portW(rsw, room.switch.gen, [rp.k]) : { idle: 0, load: 0 };
    const row = add(channelLink(LINK_KIND.rack, rack.id, sw, rack.switch, rp ? rp.k : null, extra));
    for (let j = 0; j < Math.min(MAX_UPLINKS, rack.switch.uplinks.length); j += 1) c.rack.uplinkLink[rack.id * MAX_UPLINKS + j] = row;
    if (rp) c.room.portLink[rp.room * MAX_ROOM_PORTS + rp.slot] = row;
  }

  for (const room of build.rooms) {
    if (!room?.opened) continue;
    const site = build.sites[room.site];
    const plane = site?.opened ? site.dataPlane : null;
    const extra = plane ? portW(dp, plane.gen, [plane.k]) : { idle: 0, load: 0 };
    const latency = plane ? secondsToTicks(dp.latency[plane.gen]!) : 0;
    const row = add(channelLink(LINK_KIND.zone, room.id, rsw, room.switch, plane ? plane.k : null, extra, latency));
    for (let j = 0; j < Math.min(MAX_UPLINKS, room.switch.uplinks.length); j += 1) c.room.uplinkLink[room.id * MAX_UPLINKS + j] = row;
    if (plane && room.zone < MAX_ZONES_PER_SITE) c.site.dpLink[room.site * MAX_ZONES_PER_SITE + room.zone] = row;
  }

  const gateway = build.sites[0];
  const home = gateway ? REGIONS[REGION_IDS.indexOf(gateway.region)]!.continent : 'americas';
  for (const site of build.sites) {
    if (!site?.opened || !site.backbone) continue;
    const { gen, k } = site.backbone;
    const continent = REGIONS[REGION_IDS.indexOf(site.region)]!.continent;
    const subsea = gen === 3 && continent !== home && hasRule(u, 'subseaLatency') ? ruleParam(u, 'subseaLatency', 'factor', 0.5) : 1;
    const w = portW(bb, gen, [k]);
    c.site.backboneLink[site.id] = add({ kind: LINK_KIND.backbone, owner: site.id, channels: 1, rung: k, speed: ladderSpeed(k), latency: secondsToTicks(bb.latency[gen]! * subsea), idle: w.idle, load: w.load });
  }

  const t = ensureRows(LINK_COMPILED, c.link, links.length);
  t.len = links.length;
  links.forEach((l, i) => {
    t.kind[i] = l.kind; t.owner[i] = l.owner; t.channels[i] = l.channels; t.rung[i] = l.rung; t.speed[i] = l.speed;
    t.latencyTicks[i] = l.latency; t.idleW[i] = l.idle; t.loadW[i] = l.load;
  });
}

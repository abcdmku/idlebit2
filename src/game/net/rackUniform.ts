import type { CompiledBuffers } from '../core/buffers';
import { MAX_RACK_PORTS, SERVERS_PER_RACK } from '../core/constants';
import { STORAGE_NODE } from '../exec/slots';

/**
 * Per compiled: the racks whose systems that could ever admit are filed under the rack and share
 * one finite Keff and one server port term (no port link: `port` 0; else links of one `speed` and
 * latency `lat`). In such a rack, systems with one est share every term of finishOn but the backlog.
 */
export interface RackUniform {
  readonly uni: Uint8Array; readonly keff: Float64Array;
  readonly port: Uint8Array; readonly speed: Float64Array; readonly lat: Float64Array;
}
const uniformMemo = new WeakMap<CompiledBuffers, RackUniform>();
export function rackUniform(c: CompiledBuffers): RackUniform {
  const hit = uniformMemo.get(c);
  if (hit) return hit;
  const racks = c.rack.len;
  const u: RackUniform = {
    uni: new Uint8Array(racks), keff: new Float64Array(racks),
    port: new Uint8Array(racks), speed: new Float64Array(racks), lat: new Float64Array(racks),
  };
  for (let rack = 0; rack < racks; rack += 1) {
    let first = true, ok = true;
    for (let k = 0; k < SERVERS_PER_RACK && ok; k += 1) {
      const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
      if (s < 0 || c.sys.alive[s] !== 1 || c.sys.kind[s] === STORAGE_NODE) continue;
      if (c.sys.rack[s] !== rack) { ok = false; break; }
      // linkOf(w, s, LINK_KIND.server); a system of an opened rack without a port never admits.
      const opened = c.rack.opened[rack] === 1, p = c.sys.port[s]!;
      if (opened && p < 0) continue;
      const l = opened && p < MAX_RACK_PORTS ? c.rack.portLink[rack * MAX_RACK_PORTS + p]! : -1;
      const keff = Math.max(1, c.sys.keff[s]!), port = l >= 0 ? 1 : 0;
      const speed = l >= 0 ? c.link.speed[l]! : 0, lat = l >= 0 ? c.link.latencyTicks[l]! : 0;
      if (first) { first = false; u.keff[rack] = keff; u.port[rack] = port; u.speed[rack] = speed; u.lat[rack] = lat; ok = keff < Infinity; continue; }
      ok = Object.is(keff, u.keff[rack]) && port === u.port[rack] && Object.is(speed, u.speed[rack]) && Object.is(lat, u.lat[rack]);
    }
    u.uni[rack] = ok && !first ? 1 : 0;
  }
  uniformMemo.set(c, u);
  return u;
}

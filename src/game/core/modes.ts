import { UNIT_MODES, type UnitMode } from '../types/views';

/** u8 code of each mode in hot sys.mode. A leaf module: any domain may import it at load time. */
export const MODE = Object.fromEntries(UNIT_MODES.map((m, i) => [m, i])) as { readonly [M in UnitMode]: number };

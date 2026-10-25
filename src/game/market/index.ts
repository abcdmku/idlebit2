/**
 * Market, rounds and SLA (S2). core/tick.ts calls the three phases; core/timers.ts calls startRound
 * for auto-return. Exec and net take the head through the queue helpers.
 */
export { deadlinePhase, marketPhase, promoteHead } from './queue';
export { roundPhase, startRound } from './rounds';
export { canRunOn } from './fleet';

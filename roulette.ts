// Server-only roulette module. Re-exports the client-safe shared data
// and adds the RNG-using drawPocket + spin.
//
// DO NOT IMPORT FROM A CLIENT COMPONENT. It transitively imports
// node:crypto via rng.ts; the browser bundle resolves that to a stub
// and randomInt becomes undefined at runtime. Client code should
// import from `@/lib/games/roulette-data` instead.

import { rollInt } from "./rng";
import {
  evaluate,
  MAX_BETS_PER_SPIN,
  type Bet,
  type SpinResult,
} from "./roulette-data";

export * from "./roulette-data";

/**
 * Draws a uniform pocket number in [0, 37). Uses node:crypto.randomInt
 * via rollInt, which is rejection-sampled — no modulo bias.
 */
export function drawPocket(): number {
  return rollInt(0, 37);
}

/**
 * Spin the wheel. Caller may pass `providedNumber` to rig the result
 * for tests, mirroring slots.spin(bet, providedGrid?).
 *
 * Multiple bets of the same outside type are allowed — chip-stacking
 * on the same position is a normal play pattern. Each bet is
 * evaluated independently and their payouts sum.
 *
 * Throws on empty/oversize arrays so the route can map to 400; the
 * zod schema in lib/validation/roulette.ts performs the same checks
 * at the API edge, but this is defence in depth.
 */
export function spin(bets: readonly Bet[], providedNumber?: number): SpinResult {
  if (bets.length === 0) throw new Error("no_bets");
  if (bets.length > MAX_BETS_PER_SPIN) throw new Error("too_many_bets");

  const winning = providedNumber ?? drawPocket();
  return evaluate(bets, winning);
}

// Server-only slots module. Re-exports everything from slots-data and
// adds the RNG-dependent draw + spin functions.
//
// DO NOT IMPORT THIS FROM A CLIENT COMPONENT. It transitively imports
// `node:crypto` via rng.ts; the browser bundle resolves that to a stub
// and `randomInt` becomes undefined at runtime. Client code should
// import from `@/lib/games/slots-data` instead.

import { rollInt } from "./rng";
import {
  SYMBOLS,
  SYMBOL_WEIGHTS,
  WEIGHT_TOTAL,
  evaluate,
  type Grid,
  type Reel,
  type SlotSymbol,
  type SpinResult,
} from "./slots-data";

export * from "./slots-data";

// ---------------------------------------------------------------------
// Drawing (server-side, crypto-strong)
// ---------------------------------------------------------------------

function drawSymbol(): SlotSymbol {
  const roll = rollInt(0, WEIGHT_TOTAL);
  let cum = 0;
  for (const sym of SYMBOLS) {
    cum += SYMBOL_WEIGHTS[sym];
    if (roll < cum) return sym;
  }
  // Mathematically unreachable; satisfies TS narrowing.
  return SYMBOLS[SYMBOLS.length - 1];
}

export function drawReel(): Reel {
  return [drawSymbol(), drawSymbol(), drawSymbol()];
}

function drawGrid(): Grid {
  return [drawReel(), drawReel(), drawReel(), drawReel(), drawReel()] as Grid;
}

// ---------------------------------------------------------------------
// Spin
// ---------------------------------------------------------------------

export function spin(bet: number, providedGrid?: Grid): SpinResult {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const grid = providedGrid ?? drawGrid();
  return evaluate(grid, bet);
}

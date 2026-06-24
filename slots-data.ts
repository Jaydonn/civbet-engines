// Client-safe slots constants, types, and pure evaluation logic.
// Does NOT import from rng.ts (which uses node:crypto and breaks in
// the browser). Both the server (lib/games/slots.ts) and the client
// components (components/games/slots/*) import from here.

// ---------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------

export const SYMBOLS = [
  "coal",
  "iron",
  "redstone",
  "gold",
  "emerald",
  "diamond",
] as const;

export type SlotSymbol = (typeof SYMBOLS)[number];

export const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  coal: 38,
  iron: 26,
  redstone: 17,
  gold: 11,
  emerald: 6,
  diamond: 2,
};

export const WEIGHT_TOTAL: number = Object.values(SYMBOL_WEIGHTS).reduce(
  (s, w) => s + w,
  0,
);

// ---------------------------------------------------------------------
// Paytable & paylines
// ---------------------------------------------------------------------

export const PAYTABLE: Record<SlotSymbol, [number, number, number]> = {
  // [3, 4, 5]
  diamond: [200, 1000, 5000],
  emerald: [80, 400, 1500],
  gold: [40, 150, 600],
  redstone: [15, 60, 200],
  iron: [8, 30, 100],
  coal: [3, 8, 24],
};

export const PAYLINES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 0], // 0: top
  [1, 1, 1, 1, 1], // 1: middle
  [2, 2, 2, 2, 2], // 2: bottom
  [0, 1, 2, 1, 0], // 3: V
  [2, 1, 0, 1, 2], // 4: inverted V
  [0, 1, 0, 1, 0], // 5: zig-top
  [2, 1, 2, 1, 2], // 6: zig-bot
] as const;

export const PAYLINE_COUNT = PAYLINES.length;

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type Reel = [SlotSymbol, SlotSymbol, SlotSymbol];
export type Grid = [Reel, Reel, Reel, Reel, Reel];

export type LineWin = {
  line: number;
  symbol: SlotSymbol;
  count: 3 | 4 | 5;
  multiplier: number;
  payout: number; // coins (integer)
};

export type SpinResult = {
  grid: Grid;
  lineWins: LineWin[];
  totalPayout: number;
  bet: number;
};

// ---------------------------------------------------------------------
// Evaluation — pure, no RNG, safe everywhere.
// ---------------------------------------------------------------------

function lineWinFor(
  grid: Grid,
  lineIndex: number,
  bet: number,
): LineWin | null {
  const rows = PAYLINES[lineIndex];
  const first = grid[0][rows[0]];
  let count = 1;
  for (let r = 1; r < 5; r++) {
    if (grid[r][rows[r]] === first) count++;
    else break;
  }
  if (count < 3) return null;
  const [m3, m4, m5] = PAYTABLE[first];
  const multiplier = count === 3 ? m3 : count === 4 ? m4 : m5;
  const payout = Math.floor((bet * multiplier) / PAYLINE_COUNT);
  if (payout <= 0) return null;
  return {
    line: lineIndex,
    symbol: first,
    count: count as 3 | 4 | 5,
    multiplier,
    payout,
  };
}

export function evaluate(grid: Grid, bet: number): SpinResult {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const lineWins: LineWin[] = [];
  let totalPayout = 0;
  for (let l = 0; l < PAYLINES.length; l++) {
    const w = lineWinFor(grid, l, bet);
    if (w) {
      lineWins.push(w);
      totalPayout += w.payout;
    }
  }
  return { grid, lineWins, totalPayout, bet };
}

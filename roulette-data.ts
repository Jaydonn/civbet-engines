// Client-safe Roulette constants, types, and pure logic.
// No node:crypto import anywhere in this file's transitive graph;
// both server (lib/games/roulette.ts) and client components import
// from here.

// ---------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------

// European single-zero wheel. Standard pocket order.
// House edge: 1/37 ≈ 2.70 %.
export const POCKETS: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const POCKET_COUNT = POCKETS.length; // 37

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
export const BLACK_NUMBERS: ReadonlySet<number> = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
]);

export type PocketColor = "red" | "black" | "green";

export function colorOf(n: number): PocketColor {
  if (n === 0) return "green";
  if (RED_NUMBERS.has(n)) return "red";
  return "black";
}

// ---------------------------------------------------------------------
// Bets
// ---------------------------------------------------------------------

export const OUTSIDE_BET_TYPES = [
  "red",
  "black",
  "even",
  "odd",
  "low",
  "high",
  "dozen1",
  "dozen2",
  "dozen3",
  "column1",
  "column2",
  "column3",
] as const;

export type OutsideBetType = (typeof OUTSIDE_BET_TYPES)[number];
export type BetType = "straight" | OutsideBetType;

export type Bet =
  | { type: "straight"; number: number; amount: number }
  | { type: OutsideBetType; amount: number };

export const MAX_BETS_PER_SPIN = 50;

// ---------------------------------------------------------------------
// Bet coverage & payouts
// ---------------------------------------------------------------------
// Convention: payoutMultiplier × amount is the TOTAL return (stake + win).
// For every bet type: coverage × payoutMultiplier === 36.
// (37 / 36 ≈ 2.70 % house edge; verified by the unit test
// `static invariant: coverage × multiplier === 36`.)

export function coverageFor(type: BetType): number {
  if (type === "straight") return 1;
  if (type === "dozen1" || type === "dozen2" || type === "dozen3") return 12;
  if (type === "column1" || type === "column2" || type === "column3") return 12;
  return 18; // red/black, even/odd, low/high
}

export function payoutMultiplierFor(type: BetType): number {
  if (type === "straight") return 36;
  if (type.startsWith("dozen") || type.startsWith("column")) return 3;
  return 2;
}

const COLUMN_1 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
const COLUMN_2 = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
const COLUMN_3 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

const DOZEN_1 = Array.from({ length: 12 }, (_, i) => 1 + i);
const DOZEN_2 = Array.from({ length: 12 }, (_, i) => 13 + i);
const DOZEN_3 = Array.from({ length: 12 }, (_, i) => 25 + i);

const LOW = Array.from({ length: 18 }, (_, i) => 1 + i);
const HIGH = Array.from({ length: 18 }, (_, i) => 19 + i);
const EVEN = Array.from({ length: 18 }, (_, i) => 2 * (i + 1));
const ODD = Array.from({ length: 18 }, (_, i) => 2 * i + 1);

export function numbersFor(bet: Bet): ReadonlySet<number> {
  // Server-side expansion. The client never tells us which numbers a
  // type covers — only the type. This is the central anti-tamper move.
  switch (bet.type) {
    case "straight":
      return new Set([bet.number]);
    case "red":
      return RED_NUMBERS;
    case "black":
      return BLACK_NUMBERS;
    case "even":
      return new Set(EVEN);
    case "odd":
      return new Set(ODD);
    case "low":
      return new Set(LOW);
    case "high":
      return new Set(HIGH);
    case "dozen1":
      return new Set(DOZEN_1);
    case "dozen2":
      return new Set(DOZEN_2);
    case "dozen3":
      return new Set(DOZEN_3);
    case "column1":
      return new Set(COLUMN_1);
    case "column2":
      return new Set(COLUMN_2);
    case "column3":
      return new Set(COLUMN_3);
  }
}

// ---------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------

export type BetResult = {
  bet: Bet;
  won: boolean;
  payout: number; // 0 on loss; amount * payoutMultiplier(type) on win
};

export type SpinResult = {
  winning: number;
  color: PocketColor;
  bets: BetResult[];
  totalStake: number;
  totalPayout: number;
};

// ---------------------------------------------------------------------
// Pure evaluation (no RNG; safe everywhere)
// ---------------------------------------------------------------------

function validateBetShape(bet: Bet): void {
  if (!Number.isInteger(bet.amount) || bet.amount <= 0) {
    throw new Error("invalid_bet_amount");
  }
  if (bet.type === "straight") {
    if (
      !Number.isInteger(bet.number) ||
      bet.number < 0 ||
      bet.number > 36
    ) {
      throw new Error("invalid_straight_number");
    }
  }
}

export function evaluate(
  bets: readonly Bet[],
  winning: number,
): SpinResult {
  if (!Number.isInteger(winning) || winning < 0 || winning > 36) {
    throw new Error("invalid_winning_number");
  }

  const results: BetResult[] = [];
  let totalStake = 0;
  let totalPayout = 0;

  for (const bet of bets) {
    validateBetShape(bet);
    totalStake += bet.amount;

    const won = numbersFor(bet).has(winning);
    const payout = won ? bet.amount * payoutMultiplierFor(bet.type) : 0;
    if (won) totalPayout += payout;
    results.push({ bet, won, payout });
  }

  return {
    winning,
    color: colorOf(winning),
    bets: results,
    totalStake,
    totalPayout,
  };
}

// ---------------------------------------------------------------------
// Client-side bet-array integrity helpers (also used server-side)
// ---------------------------------------------------------------------

export function hasDuplicateOutsideTypes(bets: readonly Bet[]): boolean {
  const seen = new Set<string>();
  for (const b of bets) {
    if (b.type === "straight") continue;
    if (seen.has(b.type)) return true;
    seen.add(b.type);
  }
  return false;
}

export function sumStakes(bets: readonly Bet[]): number {
  let s = 0;
  for (const b of bets) s += b.amount;
  return s;
}

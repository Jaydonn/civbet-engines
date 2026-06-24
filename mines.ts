import { rollInt } from "./rng";

// Outcomes from the player's perspective. Reuses the values introduced
// by Crash so OUTCOME_LABEL / resultTone in components/history/HistoryList.tsx
// render Mines rows without further changes.
export type Outcome = "cashed_out" | "busted";

export type CashOut = {
  multiplier: number; // server-decided multiplier at cash-out time, 2dp
  at: number;         // ms epoch when the cash-out was accepted
};

export type MinesState = {
  bet: number;
  mines: number;            // total mines placed, 1..MAX_MINES
  minePositions: number[];  // sorted ascending; hidden from client while live
  revealed: number[];       // indices already safely revealed, in order
  finished: boolean;
  outcome?: Outcome;
  cashOut?: CashOut;
};

// Tuning. 1% house edge keeps Mines in the same family as the other games.
// MAX_MINES_MULTIPLIER bounds the tail (a full clear at high mine counts
// is astronomical otherwise).
export const GRID_SIZE = 25;
export const MIN_MINES = 1;
export const MAX_MINES = 24;
export const HOUSE_EDGE = 0.01;
export const MAX_MINES_MULTIPLIER = 1_000_000;

// ---------------------------------------------------------------------
// Random mine placement — partial Fisher-Yates over [0..24] using the
// cryptographic RNG. Returns indices sorted ascending for stable storage
// and deterministic test assertions.
// ---------------------------------------------------------------------
export function pickMinePositions(mines: number): number[] {
  if (!Number.isInteger(mines) || mines < MIN_MINES || mines > MAX_MINES) {
    throw new Error("invalid_mines");
  }
  const bag: number[] = [];
  for (let i = 0; i < GRID_SIZE; i++) bag.push(i);
  // Partial shuffle: bring the first `mines` slots into a uniformly
  // random sample without paying for a full shuffle.
  for (let i = 0; i < mines; i++) {
    const j = rollInt(i, GRID_SIZE);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag.slice(0, mines).sort((a, b) => a - b);
}

export function startRound(
  bet: number,
  mines: number,
  providedPositions?: number[],
): MinesState {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const minePositions = providedPositions
    ? [...providedPositions].sort((a, b) => a - b)
    : pickMinePositions(mines);
  return {
    bet,
    mines,
    minePositions,
    revealed: [],
    finished: false,
  };
}

export function isMine(state: MinesState, index: number): boolean {
  return state.minePositions.includes(index);
}

export function isRevealed(state: MinesState, index: number): boolean {
  return state.revealed.includes(index);
}

// ---------------------------------------------------------------------
// Multiplier math
// ---------------------------------------------------------------------
// C(n, k) using BigInt so we don't lose precision when k is large.
// (Project targets ES2017, so we avoid BigInt-literal syntax.)
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);

function comb(n: number, k: number): bigint {
  if (k < 0 || k > n) return BIG_ZERO;
  if (k === 0 || k === n) return BIG_ONE;
  const kk = Math.min(k, n - k);
  let num = BIG_ONE;
  let den = BIG_ONE;
  for (let i = 0; i < kk; i++) {
    num *= BigInt(n - i);
    den *= BigInt(i + 1);
  }
  return num / den;
}

// Multiplier after `k` safe reveals with `m` mines on the grid.
// fair = C(25, k) / C(25 - m, k); quoted = (1 - HOUSE_EDGE) * fair,
// floored to 2dp (in the house's favour) and clamped to MAX_MINES_MULTIPLIER.
// k = 0 returns 1.00 (no reveals yet).
export function multiplierAt(state: MinesState, revealedCount?: number): number {
  const k = revealedCount ?? state.revealed.length;
  const m = state.mines;
  if (k <= 0) return 1.0;
  if (k > GRID_SIZE - m) return MAX_MINES_MULTIPLIER;
  const numer = comb(GRID_SIZE, k);
  const denom = comb(GRID_SIZE - m, k);
  if (denom === BIG_ZERO) return MAX_MINES_MULTIPLIER;
  // (1 - edge) * numer/denom, computed in 1e6 fixed-point so we stay
  // in BigInt territory until the final divide.
  const edgeBp = BigInt(Math.round((1 - HOUSE_EDGE) * 1_000_000));
  const scaled = (numer * edgeBp * BigInt(100)) / (denom * BigInt(1_000_000));
  const value = Number(scaled) / 100;
  if (!Number.isFinite(value)) return MAX_MINES_MULTIPLIER;
  return Math.min(MAX_MINES_MULTIPLIER, Math.max(1.0, Math.floor(value * 100) / 100));
}

// Multiplier the player would get for the *next* safe reveal.
export function nextMultiplier(state: MinesState): number {
  return multiplierAt(state, state.revealed.length + 1);
}

// ---------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------
export function applyReveal(
  state: MinesState,
  index: number,
  nowMs: number,
): MinesState {
  if (state.finished) throw new Error("hand_finished");
  if (!Number.isInteger(index) || index < 0 || index >= GRID_SIZE) {
    throw new Error("index_out_of_range");
  }
  if (isRevealed(state, index)) throw new Error("already_revealed");

  if (isMine(state, index)) {
    // Bust — mine positions stay in state so toClientView can reveal them.
    return { ...state, finished: true, outcome: "busted" };
  }

  const revealed = [...state.revealed, index];
  const next: MinesState = { ...state, revealed };

  // Full clear (revealed every safe tile) → auto cash-out at the
  // max multiplier for this mine count. The player can't unlock more,
  // and a sitting "active" session with nothing left to do is dead state.
  if (revealed.length >= GRID_SIZE - state.mines) {
    next.finished = true;
    next.outcome = "cashed_out";
    next.cashOut = { multiplier: multiplierAt(next), at: nowMs };
  }
  return next;
}

export function applyCashOut(state: MinesState, nowMs: number): MinesState {
  if (state.finished) throw new Error("hand_finished");
  if (state.revealed.length === 0) throw new Error("nothing_to_cash");
  return {
    ...state,
    finished: true,
    outcome: "cashed_out",
    cashOut: { multiplier: multiplierAt(state), at: nowMs },
  };
}

// Total coins to credit back at end of round (the stake was already
// debited at start). Floored in the house's favour.
export function payoutFor(state: MinesState): number {
  if (!state.finished) return 0;
  if (state.outcome !== "cashed_out" || !state.cashOut) return 0;
  return Math.floor(state.bet * state.cashOut.multiplier);
}

// ---------------------------------------------------------------------
// Client-safe view. Hides minePositions while the round is live —
// sending them would trivially break fairness. Reveals the full layout
// on settlement so the bust UI can show every mine.
// ---------------------------------------------------------------------
export type ClientView = {
  bet: number;
  mines: number;
  revealed: number[];
  finished: boolean;
  outcome: Outcome | null;
  currentMultiplier: number;
  nextMultiplier: number;
  cashOutMultiplier: number | null;
  payout: number;
  minePositions: number[] | null;
};

export function toClientView(state: MinesState): ClientView {
  const finished = state.finished;
  return {
    bet: state.bet,
    mines: state.mines,
    revealed: state.revealed,
    finished,
    outcome: state.outcome ?? null,
    currentMultiplier: multiplierAt(state),
    nextMultiplier: finished ? multiplierAt(state) : nextMultiplier(state),
    cashOutMultiplier: state.cashOut?.multiplier ?? null,
    payout: payoutFor(state),
    minePositions: finished ? state.minePositions : null,
  };
}

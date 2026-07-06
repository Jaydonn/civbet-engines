import { rollInt } from "./rng";

// Outcomes from the player's perspective.
export type Outcome = "cashed_out" | "busted";

export type CashOut = {
  multiplier: number; // server-decided multiplier at cash-out time, 2dp
  at: number;         // ms epoch when the cash-out was accepted
  roll: number;       // dither draw in [0, 1) for unbiased fractional settlement
};

export type CrashState = {
  bet: number;
  crashPoint: number;  // hidden from the client while round is live
  startedAt: number;   // ms epoch when the round was created
  growthRate: number;  // per-second exponential growth rate
  autoCashOut: number | null; // server-honored auto cash-out target (×), or null
  cashOut: CashOut | null;
  finished: boolean;
  outcome?: Outcome;
};

// Tuning. GROWTH_RATE is per-second: 0.06 ⇒ 2.00x ≈ 11.55s, 5.00x ≈ 26.8s.
// HOUSE_EDGE is baked into the crash curve multiplicatively (see
// rollCrashPoint), which gives RTP = (1 - HOUSE_EDGE) ≈ 97% at every
// cash-out target and reproduces the instant-bust at exactly HOUSE_EDGE.
// MAX_CRASH caps the tail so we never persist absurd outliers.
export const GROWTH_RATE = 0.06;
export const HOUSE_EDGE = 0.03;
export const MAX_CRASH = 1_000_000;

// Resolution of the random draw (must match what we pass to rollInt).
const ROLL_DENOM = 1_000_000;

export function rollCrashPoint(): number {
  // r ∈ [0, 1); ROLL_DENOM=1e6 gives 4dp resolution which is plenty.
  const r = rollInt(0, ROLL_DENOM) / ROLL_DENOM;
  // Bake the edge into the curve: crashPoint = (1 - edge) / (1 - r).
  // This yields RTP = (1 - edge) at EVERY cash-out target. When r < edge
  // the raw value falls below 1.0 and the clamp below busts the round at
  // 1.00 — reproducing the instant-bust at exactly the HOUSE_EDGE rate.
  //
  // The previous form carved out a separate 3% instant-bust band on top
  // of a plain 1/(1-r) curve. That curve has no edge of its own, and the
  // bust band sits inside the region where the player would already have
  // lost, so the realised edge was ~0% for any target above ~1.03x.
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  const capped = Math.min(raw, MAX_CRASH);
  // Floor to 2dp; values below 1.00 clamp up to an instant bust.
  return Math.max(1.0, Math.floor(capped * 100) / 100);
}

// Normalise a requested auto cash-out target to a clean 2dp multiplier,
// or null when it isn't a usable target (missing, ≤ 1.00, non-finite).
// A target of exactly 1.00 would "cash out" for no gain, so we treat it
// as no auto target at all.
export function normaliseAutoCashOut(target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  const rounded = Math.floor(target * 100) / 100;
  if (rounded <= 1.0) return null;
  return Math.min(rounded, MAX_CRASH);
}

export function startRound(
  bet: number,
  providedCrashPoint?: number,
  autoCashOut?: number | null,
): CrashState {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const crashPoint = providedCrashPoint ?? rollCrashPoint();
  return {
    bet,
    crashPoint,
    startedAt: Date.now(),
    growthRate: GROWTH_RATE,
    autoCashOut: normaliseAutoCashOut(autoCashOut),
    cashOut: null,
    finished: false,
  };
}

// Elapsed seconds since startedAt, never negative.
function elapsed(state: CrashState, nowMs: number): number {
  return Math.max(0, (nowMs - state.startedAt) / 1000);
}

// Multiplier at time `nowMs`, clamped to crashPoint and floored to 2dp.
// Clamping is the server's anti-cheat backbone: the displayed/awarded
// multiplier can never exceed the round's crash point.
export function multiplierAt(state: CrashState, nowMs: number): number {
  const t = elapsed(state, nowMs);
  const raw = Math.exp(state.growthRate * t);
  const clamped = Math.min(raw, state.crashPoint);
  return Math.floor(clamped * 100) / 100;
}

// True once the round's elapsed time has reached the crash point.
// tCrash = ln(crashPoint) / growthRate.
export function hasCrashed(state: CrashState, nowMs: number): boolean {
  const tCrash = Math.log(state.crashPoint) / state.growthRate;
  return elapsed(state, nowMs) >= tCrash;
}

function assertRoll(roll: number): void {
  if (!(Number.isFinite(roll) && roll >= 0 && roll < 1)) {
    throw new Error("invalid_roll");
  }
}

// `roll` is stored on the cashOut so payoutFor stays a pure function of
// state — anyone auditing can recompute the exact settlement.
export function applyCashOut(
  state: CrashState,
  nowMs: number,
  roll: number,
): CrashState {
  if (state.finished) throw new Error("hand_finished");
  if (hasCrashed(state, nowMs)) throw new Error("already_crashed");
  assertRoll(roll);
  const multiplier = multiplierAt(state, nowMs);
  return {
    ...state,
    cashOut: { multiplier, at: nowMs, roll },
    finished: true,
    outcome: "cashed_out",
  };
}

export function applyCrashTimeout(state: CrashState): CrashState {
  if (state.finished) throw new Error("hand_finished");
  return { ...state, finished: true, outcome: "busted" };
}

// Seconds for the multiplier to grow to `m` (m > 1). Inverse of the
// exp(rate * t) curve: t = ln(m) / rate.
function timeToReach(state: CrashState, m: number): number {
  return Math.log(m) / state.growthRate;
}

// If the round carries an auto cash-out target that lands at or before
// the crash, return the terminal cashed-out state — stamped at the exact
// moment the multiplier reached the target, NOT at `nowMs`. This is what
// makes auto cash-out deterministic and independent of when (or whether)
// the client is alive to fire it: the payout is the same whether the tab
// stayed open, was backgrounded, or was closed and reopened minutes later.
// Returns null when there is no eligible auto target (unset, or set above
// the crash point so it was never reached).
//
// `roll` is stored on the cashOut for unbiased fractional settlement.
// Drawing it at settlement time is safe because it's independent of the
// player's target and outcome — nothing about the roll can be manipulated
// after the target is set.
export function autoCashOutSettlement(
  state: CrashState,
  roll: number,
): CrashState | null {
  const target = state.autoCashOut;
  if (target == null || target <= 1.0) return null;
  // A target above the crash point is never reached — the round busts.
  if (target > state.crashPoint) return null;
  assertRoll(roll);
  const at = state.startedAt + timeToReach(state, target) * 1000;
  return {
    ...state,
    cashOut: { multiplier: target, at, roll },
    finished: true,
    outcome: "cashed_out",
  };
}

// Server-authoritative settlement for a round the server is resolving on
// its own clock (state poll, resume, or a late-arriving cash-out). Returns
// the terminal state if the round should now be settled, or null if it is
// still live. An eligible auto cash-out always wins over a bust because it
// lands first (its target sits at or below the crash point, so its time is
// at or before the crash time).
export function settle(
  state: CrashState,
  nowMs: number,
  roll: number,
): CrashState | null {
  if (state.finished) return null;
  const auto = autoCashOutSettlement(state, roll);
  if (auto && elapsed(state, nowMs) >= timeToReach(state, state.autoCashOut!)) {
    return auto;
  }
  if (hasCrashed(state, nowMs)) return applyCrashTimeout(state);
  return null;
}

// Total coins to credit back at end of round (the stake was already
// debited at start). Uses unbiased fractional settlement: floor + pay
// one extra coin when `roll < frac`. Expected payout is `bet * mult`
// exactly, so realised RTP holds at every stake — a plain floor collapses
// a bet-1 cash-out at 1.50x to `P(cash) * 1` (~64.6% RTP) instead of 97%.
export function payoutFor(state: CrashState): number {
  if (!state.finished) return 0;
  if (state.outcome !== "cashed_out" || !state.cashOut) return 0;
  const raw = state.bet * state.cashOut.multiplier;
  const base = Math.floor(raw);
  const frac = raw - base;
  return base + (state.cashOut.roll < frac ? 1 : 0);
}

// Client-safe view. Hides crashPoint while live — revealing it would
// trivially break fairness. Includes serverNow so the client can correct
// for clock skew on resume.
export type ClientView = {
  bet: number;
  startedAt: number;
  growthRate: number;
  serverNow: number;
  multiplier: number;          // server-clamped current multiplier
  finished: boolean;
  outcome: Outcome | null;
  cashOutMultiplier: number | null;
  payout: number;              // total coins returned (0 if busted)
  crashPoint: number | null;   // revealed only once finished
};

// `nowMs` is optional so that React server components can build a view
// without calling Date.now() at render time (lint forbids impure calls
// in render). Callers that have a concrete clock — API routes — should
// always pass it; the client reconciles via its own rAF loop.
export function toClientView(state: CrashState, nowMs: number = state.startedAt): ClientView {
  const finished = state.finished;
  return {
    bet: state.bet,
    startedAt: state.startedAt,
    growthRate: state.growthRate,
    serverNow: nowMs,
    multiplier: multiplierAt(state, nowMs),
    finished,
    outcome: state.outcome ?? null,
    cashOutMultiplier: state.cashOut?.multiplier ?? null,
    payout: payoutFor(state),
    crashPoint: finished ? state.crashPoint : null,
  };
}

import { rollInt } from "./rng";

// Outcomes from the player's perspective.
export type Outcome = "cashed_out" | "busted";

export type CashOut = {
  multiplier: number; // server-decided multiplier at cash-out time, 2dp
  at: number;         // ms epoch when the cash-out was accepted
};

export type CrashState = {
  bet: number;
  crashPoint: number;  // hidden from the client while round is live
  startedAt: number;   // ms epoch when the round was created
  growthRate: number;  // per-second exponential growth rate
  cashOut: CashOut | null;
  finished: boolean;
  outcome?: Outcome;
};

// Tuning. GROWTH_RATE is per-second: 0.06 ⇒ 2.00x ≈ 11.55s, 5.00x ≈ 26.8s.
// HOUSE_EDGE is the instant-bust probability — the rest of the distribution
// is the standard 1/(1-r) curve, so expected RTP ≈ (1 - HOUSE_EDGE) ≈ 97%.
// MAX_CRASH caps the tail so we never persist absurd outliers.
export const GROWTH_RATE = 0.06;
export const HOUSE_EDGE = 0.03;
export const MAX_CRASH = 1_000_000;

// Resolution of the random draw (must match what we pass to rollInt).
const ROLL_DENOM = 1_000_000;

export function rollCrashPoint(): number {
  // r ∈ [0, 1); ROLL_DENOM=1e6 gives 4dp resolution which is plenty.
  const r = rollInt(0, ROLL_DENOM) / ROLL_DENOM;
  if (r < HOUSE_EDGE) return 1.0;
  const raw = 1 / (1 - r);
  const capped = Math.min(raw, MAX_CRASH);
  // Floor to 2dp, clamp to >= 1.00.
  return Math.max(1.0, Math.floor(capped * 100) / 100);
}

export function startRound(bet: number, providedCrashPoint?: number): CrashState {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const crashPoint = providedCrashPoint ?? rollCrashPoint();
  return {
    bet,
    crashPoint,
    startedAt: Date.now(),
    growthRate: GROWTH_RATE,
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

export function applyCashOut(state: CrashState, nowMs: number): CrashState {
  if (state.finished) throw new Error("hand_finished");
  if (hasCrashed(state, nowMs)) throw new Error("already_crashed");
  const multiplier = multiplierAt(state, nowMs);
  return {
    ...state,
    cashOut: { multiplier, at: nowMs },
    finished: true,
    outcome: "cashed_out",
  };
}

export function applyCrashTimeout(state: CrashState): CrashState {
  if (state.finished) throw new Error("hand_finished");
  return { ...state, finished: true, outcome: "busted" };
}

// Total coins to credit back at end of round (the stake was already
// debited at start). Floored in the house's favour.
export function payoutFor(state: CrashState): number {
  if (!state.finished) return 0;
  if (state.outcome !== "cashed_out" || !state.cashOut) return 0;
  return Math.floor(state.bet * state.cashOut.multiplier);
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

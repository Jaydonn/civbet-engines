import { rollInt } from "./rng";

export type Side = "heads" | "tails";

export type FlipResult = {
  result: Side;
  win: boolean;
  payout: number;
};

// 1% house edge implemented as a 1.98x win payout (rather than a rigged
// coin). Same RTP as `prob(0.495) × 2.00`, but more honest UX — the
// player sees exactly what their winning bet returns.
export const WIN_MULTIPLIER = 1.98;
export const HOUSE_EDGE = 0.01;

export function flip(): Side {
  return rollInt(0, 2) === 0 ? "heads" : "tails";
}

export function resolve(bet: number, choice: Side, result: Side): FlipResult {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const win = result === choice;
  // Floor in the house's favour on odd bets (standard).
  const payout = win ? Math.floor(bet * WIN_MULTIPLIER) : 0;
  return { result, win, payout };
}

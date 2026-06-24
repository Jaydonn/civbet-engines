import { describe, expect, it } from "vitest";
import { WIN_MULTIPLIER, flip, resolve } from "./coinflip";

describe("flip", () => {
  it("returns only heads or tails", () => {
    for (let i = 0; i < 1_000; i++) {
      const s = flip();
      expect(s === "heads" || s === "tails").toBe(true);
    }
  });

  it("is approximately uniform over many trials", () => {
    const N = 25_000;
    let heads = 0;
    for (let i = 0; i < N; i++) {
      if (flip() === "heads") heads++;
    }
    const ratio = heads / N;
    // ±2% tolerance is generous for N=25k on a cryptographic RNG.
    expect(ratio).toBeGreaterThan(0.48);
    expect(ratio).toBeLessThan(0.52);
  });
});

describe("resolve", () => {
  it("flags a win when choice matches result", () => {
    expect(resolve(10, "heads", "heads").win).toBe(true);
    expect(resolve(10, "tails", "tails").win).toBe(true);
  });

  it("flags a loss when choice misses", () => {
    expect(resolve(10, "heads", "tails").win).toBe(false);
    expect(resolve(10, "tails", "heads").win).toBe(false);
  });

  it("pays floor(bet * WIN_MULTIPLIER) on a win, 0 on a loss", () => {
    expect(resolve(100, "heads", "heads").payout).toBe(
      Math.floor(100 * WIN_MULTIPLIER),
    );
    expect(resolve(100, "heads", "tails").payout).toBe(0);
  });

  it("floors in the house's favour on odd bets", () => {
    // 7 * 1.98 = 13.86 → floor → 13 (not 14)
    expect(resolve(7, "heads", "heads").payout).toBe(13);
    // 3 * 1.98 = 5.94 → floor → 5
    expect(resolve(3, "tails", "tails").payout).toBe(5);
  });

  it("rejects non-positive integer bets", () => {
    expect(() => resolve(0, "heads", "heads")).toThrow("invalid_bet");
    expect(() => resolve(-1, "heads", "heads")).toThrow("invalid_bet");
    expect(() => resolve(1.5, "heads", "heads")).toThrow("invalid_bet");
  });

  it("returns the result it was given", () => {
    expect(resolve(10, "heads", "tails").result).toBe("tails");
    expect(resolve(10, "tails", "heads").result).toBe("heads");
  });
});

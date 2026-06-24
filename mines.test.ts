import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  HOUSE_EDGE,
  MAX_MINES,
  MAX_MINES_MULTIPLIER,
  MIN_MINES,
  applyCashOut,
  applyReveal,
  multiplierAt,
  payoutFor,
  pickMinePositions,
  startRound,
  toClientView,
  type MinesState,
} from "./mines";

// Hand-checked combinatorics: C(25,k)/C(25-m,k) * (1 - 0.01), floor to 2dp.
// m=1,k=1: 25/24 = 1.04166… * 0.99 = 1.03125 → 1.03
// m=3,k=5: 53130/26334 = 2.01777… * 0.99 = 1.99760 → 1.99
// m=5,k=3: 2300/1140  = 2.01754… * 0.99 = 1.99737 → 1.99
// m=24,k=1: 25/1 = 25 * 0.99 = 24.75 → 24.75
function makeState(over: Partial<MinesState> = {}): MinesState {
  return {
    bet: 100,
    mines: 3,
    minePositions: [0, 1, 2],
    revealed: [],
    finished: false,
    ...over,
  };
}

describe("pickMinePositions", () => {
  it("returns the right count with all values in range and distinct", () => {
    for (const m of [1, 3, 5, 10, 24]) {
      for (let trial = 0; trial < 500; trial++) {
        const out = pickMinePositions(m);
        expect(out).toHaveLength(m);
        const set = new Set(out);
        expect(set.size).toBe(m);
        for (const v of out) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(GRID_SIZE);
        }
      }
    }
  });

  it("returns indices sorted ascending", () => {
    for (let trial = 0; trial < 100; trial++) {
      const out = pickMinePositions(10);
      const sorted = [...out].sort((a, b) => a - b);
      expect(out).toEqual(sorted);
    }
  });

  it("rejects out-of-range mine counts", () => {
    expect(() => pickMinePositions(0)).toThrow("invalid_mines");
    expect(() => pickMinePositions(25)).toThrow("invalid_mines");
    expect(() => pickMinePositions(-1)).toThrow("invalid_mines");
    expect(() => pickMinePositions(2.5)).toThrow("invalid_mines");
  });

  it("approximates a uniform distribution over many draws", () => {
    // Each position should appear in ~(mines/25) of single-mine draws.
    const N = 25_000;
    const counts = new Array(GRID_SIZE).fill(0);
    for (let i = 0; i < N; i++) {
      for (const idx of pickMinePositions(1)) counts[idx]++;
    }
    const expected = N / GRID_SIZE;
    for (const c of counts) {
      // Allow ±15% — Chi-square tolerance for this sample size.
      expect(c).toBeGreaterThan(expected * 0.85);
      expect(c).toBeLessThan(expected * 1.15);
    }
  });
});

describe("multiplierAt", () => {
  it("returns 1.00 with no reveals", () => {
    expect(multiplierAt(makeState({ mines: 3 }))).toBe(1.0);
  });

  it("matches the closed-form values for hand-checked (m,k) pairs", () => {
    expect(multiplierAt(makeState({ mines: 1 }), 1)).toBe(1.03);
    expect(multiplierAt(makeState({ mines: 3 }), 5)).toBe(1.99);
    expect(multiplierAt(makeState({ mines: 5 }), 3)).toBe(1.99);
    expect(multiplierAt(makeState({ mines: 24 }), 1)).toBe(24.75);
  });

  it("never exceeds MAX_MINES_MULTIPLIER", () => {
    // A full clear at high mine counts is astronomical without the cap.
    const huge = multiplierAt(makeState({ mines: 20 }), 5);
    expect(huge).toBeLessThanOrEqual(MAX_MINES_MULTIPLIER);
  });

  it("respects HOUSE_EDGE — quoted multiplier is below the fair value", () => {
    // Fair m=1,k=1 = 25/24 ≈ 1.04166; quoted with 1% edge ≈ 1.03125 → 1.03.
    const quoted = multiplierAt(makeState({ mines: 1 }), 1);
    const fair = 25 / 24;
    expect(quoted).toBeLessThan(fair);
    expect(quoted).toBeGreaterThan(fair * (1 - HOUSE_EDGE) - 0.011); // within 2dp floor
  });
});

describe("applyReveal", () => {
  it("rejects out-of-range, duplicates, and post-finish", () => {
    const s = makeState({ minePositions: [0] });
    expect(() => applyReveal(s, -1, 1)).toThrow("index_out_of_range");
    expect(() => applyReveal(s, 25, 1)).toThrow("index_out_of_range");
    const after = applyReveal(s, 5, 1);
    expect(() => applyReveal(after, 5, 2)).toThrow("already_revealed");
    expect(() => applyReveal({ ...s, finished: true }, 5, 1)).toThrow("hand_finished");
  });

  it("busts when revealing a mine", () => {
    const s = makeState({ minePositions: [7] });
    const next = applyReveal(s, 7, 1);
    expect(next.finished).toBe(true);
    expect(next.outcome).toBe("busted");
    expect(next.cashOut).toBeUndefined();
  });

  it("appends safely revealed indices", () => {
    const s = makeState({ minePositions: [0] });
    const a = applyReveal(s, 5, 1);
    const b = applyReveal(a, 6, 2);
    expect(b.revealed).toEqual([5, 6]);
    expect(b.finished).toBe(false);
  });

  it("auto-cashes on a full clear", () => {
    // 24 mines, 1 safe tile (index 12). Revealing it should auto-cash.
    const mp: number[] = [];
    for (let i = 0; i < 25; i++) if (i !== 12) mp.push(i);
    const s = makeState({ mines: 24, minePositions: mp });
    const next = applyReveal(s, 12, 7);
    expect(next.finished).toBe(true);
    expect(next.outcome).toBe("cashed_out");
    expect(next.cashOut?.multiplier).toBe(24.75);
    expect(next.cashOut?.at).toBe(7);
  });
});

describe("applyCashOut", () => {
  it("rejects with no reveals", () => {
    expect(() => applyCashOut(makeState(), 1)).toThrow("nothing_to_cash");
  });

  it("rejects on a finished state", () => {
    const s = makeState({ finished: true, outcome: "busted", revealed: [5] });
    expect(() => applyCashOut(s, 1)).toThrow("hand_finished");
  });

  it("stamps the cash-out multiplier and marks finished", () => {
    const s = makeState({ mines: 3, revealed: [5, 6, 7, 8, 9] });
    const next = applyCashOut(s, 42);
    expect(next.finished).toBe(true);
    expect(next.outcome).toBe("cashed_out");
    expect(next.cashOut?.multiplier).toBe(1.99); // C(25,5)/C(22,5) * 0.99
    expect(next.cashOut?.at).toBe(42);
  });
});

describe("payoutFor", () => {
  it("returns 0 on bust", () => {
    const s = makeState({ finished: true, outcome: "busted" });
    expect(payoutFor(s)).toBe(0);
  });

  it("returns floor(bet * cashOutMultiplier) on cashouts", () => {
    const s = makeState({
      bet: 100,
      finished: true,
      outcome: "cashed_out",
      cashOut: { multiplier: 1.99, at: 1 },
    });
    expect(payoutFor(s)).toBe(199);
  });

  it("floors in the house's favour", () => {
    const s = makeState({
      bet: 7,
      finished: true,
      outcome: "cashed_out",
      cashOut: { multiplier: 1.99, at: 1 },
    });
    // 7 * 1.99 = 13.93 → floor → 13
    expect(payoutFor(s)).toBe(13);
  });
});

describe("startRound", () => {
  it("rejects bad bets", () => {
    expect(() => startRound(0, 3)).toThrow("invalid_bet");
    expect(() => startRound(-1, 3)).toThrow("invalid_bet");
    expect(() => startRound(1.5, 3)).toThrow("invalid_bet");
  });

  it("accepts a provided mine layout (for tests)", () => {
    const s = startRound(50, 3, [4, 1, 2]);
    expect(s.minePositions).toEqual([1, 2, 4]); // sorted
    expect(s.bet).toBe(50);
    expect(s.mines).toBe(3);
    expect(s.finished).toBe(false);
  });

  it("respects mine count bounds via pickMinePositions", () => {
    expect(() => startRound(50, MIN_MINES - 1)).toThrow("invalid_mines");
    expect(() => startRound(50, MAX_MINES + 1)).toThrow("invalid_mines");
  });
});

describe("toClientView", () => {
  it("hides minePositions while running", () => {
    const s = makeState({ minePositions: [3, 7, 11] });
    const v = toClientView(s);
    expect(v.minePositions).toBeNull();
    expect(v.finished).toBe(false);
    expect(v.currentMultiplier).toBe(1.0);
    expect(v.nextMultiplier).toBeGreaterThan(1.0);
  });

  it("reveals minePositions once finished", () => {
    const s = applyReveal(makeState({ minePositions: [4] }), 4, 1);
    const v = toClientView(s);
    expect(v.minePositions).toEqual([4]);
    expect(v.finished).toBe(true);
    expect(v.outcome).toBe("busted");
  });

  it("exposes cashOutMultiplier and payout on a clean cash-out", () => {
    const s = applyCashOut(makeState({ bet: 100, mines: 3, revealed: [5, 6, 7, 8, 9] }), 1);
    const v = toClientView(s);
    expect(v.cashOutMultiplier).toBe(1.99);
    expect(v.payout).toBe(199);
  });
});

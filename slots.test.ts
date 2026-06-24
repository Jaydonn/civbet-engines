import { describe, expect, it } from "vitest";
import {
  PAYLINE_COUNT,
  SYMBOLS,
  SYMBOL_WEIGHTS,
  drawReel,
  evaluate,
  spin,
  type Grid,
  type Reel,
  type SlotSymbol,
} from "./slots";

const ALL = (s: SlotSymbol): Reel => [s, s, s];

// Helper: build a grid where each reel is the given column (top/mid/bot).
function gridOf(...cols: Reel[]): Grid {
  if (cols.length !== 5) throw new Error("need 5 cols");
  return cols as unknown as Grid;
}

describe("drawReel", () => {
  it("returns only valid symbols and three of them", () => {
    for (let i = 0; i < 100; i++) {
      const r = drawReel();
      expect(r).toHaveLength(3);
      for (const s of r) expect(SYMBOLS).toContain(s);
    }
  });

  it("frequencies converge to weights over many draws (±2%)", () => {
    const counts: Record<string, number> = {};
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      for (const s of drawReel()) {
        counts[s] = (counts[s] ?? 0) + 1;
      }
    }
    const totalSlots = N * 3;
    for (const s of SYMBOLS) {
      const expected = SYMBOL_WEIGHTS[s] / 100;
      const actual = (counts[s] ?? 0) / totalSlots;
      expect(Math.abs(actual - expected)).toBeLessThan(0.02);
    }
  });
});

describe("evaluate", () => {
  it("all-diamond middle row → 1 line win, 5-of-a-kind", () => {
    // Middle is diamond on every reel; other rows are coal (no line of coal possible without breaking middle).
    const col: Reel = ["coal", "diamond", "coal"];
    const g = gridOf(col, col, col, col, col);
    const r = evaluate(g, 100);
    // Just the middle line wins.
    const middleWins = r.lineWins.filter((w) => w.line === 1);
    expect(middleWins).toHaveLength(1);
    expect(middleWins[0].symbol).toBe("diamond");
    expect(middleWins[0].count).toBe(5);
    expect(middleWins[0].payout).toBe(Math.floor((100 * 5000) / PAYLINE_COUNT));
  });

  it("left-anchored only — [coal, diamond×4] middle does NOT win diamond 4-of-a-kind", () => {
    const breakCol: Reel = ["iron", "coal", "iron"]; // first reel middle is coal
    const dCol: Reel = ["iron", "diamond", "iron"];
    const g = gridOf(breakCol, dCol, dCol, dCol, dCol);
    const r = evaluate(g, 100);
    // The middle line starts with coal, then diamonds — only 1 coal in a row, not a win.
    // No other line should match either.
    const middleWin = r.lineWins.find((w) => w.line === 1);
    expect(middleWin).toBeUndefined();
  });

  it("all-coal grid → all 7 lines win 5-coal", () => {
    const c: Reel = ALL("coal");
    const g = gridOf(c, c, c, c, c);
    const r = evaluate(g, 70);
    expect(r.lineWins).toHaveLength(7);
    for (const w of r.lineWins) {
      expect(w.symbol).toBe("coal");
      expect(w.count).toBe(5);
      expect(w.payout).toBe(Math.floor((70 * 24) / PAYLINE_COUNT));
    }
    expect(r.totalPayout).toBe(7 * Math.floor((70 * 24) / PAYLINE_COUNT));
  });

  it("V-line (rows 0,1,2,1,0): diamonds along V only, garbage elsewhere", () => {
    // Build columns where the row-along-V is diamond and the others are
    // intentionally non-matching to avoid horizontal lines.
    // Reel 0: V-row 0 → diamond, so col = [diamond, iron, gold]
    // Reel 1: V-row 1 → diamond,           col = [iron,    diamond, gold]
    // Reel 2: V-row 2 → diamond,           col = [iron,    gold,    diamond]
    // Reel 3: V-row 1 → diamond,           col = [iron,    diamond, gold]
    // Reel 4: V-row 0 → diamond,           col = [diamond, iron,    gold]
    const g = gridOf(
      ["diamond", "iron", "gold"],
      ["iron", "diamond", "gold"],
      ["iron", "gold", "diamond"],
      ["iron", "diamond", "gold"],
      ["diamond", "iron", "gold"],
    );
    const r = evaluate(g, 100);
    const vLine = r.lineWins.find((w) => w.line === 3);
    expect(vLine).toBeDefined();
    expect(vLine!.symbol).toBe("diamond");
    expect(vLine!.count).toBe(5);
    // Only the V-line wins on this grid; no horizontal or zigzag aligns.
    expect(r.lineWins).toHaveLength(1);
  });

  it("rejects bet < 1 or non-integer", () => {
    const c: Reel = ALL("coal");
    const g = gridOf(c, c, c, c, c);
    expect(() => evaluate(g, 0)).toThrow();
    expect(() => evaluate(g, -1)).toThrow();
    expect(() => evaluate(g, 1.5)).toThrow();
  });
});

describe("spin", () => {
  it("rigged spin is deterministic", () => {
    const c: Reel = ALL("coal");
    const g = gridOf(c, c, c, c, c);
    const a = spin(50, g);
    const b = spin(50, g);
    expect(a).toEqual(b);
  });

  it("non-rigged smoke: integer payout, ≥ 0, valid grid shape", () => {
    for (let i = 0; i < 200; i++) {
      const r = spin(70);
      expect(Number.isInteger(r.totalPayout)).toBe(true);
      expect(r.totalPayout).toBeGreaterThanOrEqual(0);
      expect(r.grid).toHaveLength(5);
      for (const reel of r.grid) {
        expect(reel).toHaveLength(3);
        for (const s of reel) expect(SYMBOLS).toContain(s);
      }
    }
  });

  it("empirical RTP over 200k spins is between 0.85 and 1.05", () => {
    const N = 200_000;
    const bet = 100; // multiple of 7 not required; flooring keeps house edge
    let totalIn = 0;
    let totalOut = 0;
    for (let i = 0; i < N; i++) {
      const r = spin(bet);
      totalIn += bet;
      totalOut += r.totalPayout;
    }
    const rtp = totalOut / totalIn;
    // Bound is intentionally wide so an accidental retune trips the test
    // but normal sample variance does not. House edge should land mid-range.
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(1.05);
  }, 30_000);
});

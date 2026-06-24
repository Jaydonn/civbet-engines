import { describe, expect, it } from "vitest";
import {
  BLACK_NUMBERS,
  OUTSIDE_BET_TYPES,
  POCKETS,
  POCKET_COUNT,
  RED_NUMBERS,
  colorOf,
  coverageFor,
  evaluate,
  numbersFor,
  payoutMultiplierFor,
  type Bet,
  type BetType,
  type OutsideBetType,
} from "./roulette-data";
import { drawPocket, spin } from "./roulette";

const BET_TYPES_ALL: BetType[] = ["straight", ...OUTSIDE_BET_TYPES];

describe("static invariants", () => {
  it("coverage × payoutMultiplier === 36 for every bet type", () => {
    // The single invariant that pins the house edge. If anyone tweaks a
    // payout multiplier without adjusting coverage (or vice versa), this
    // catches it before the change ships.
    for (const t of BET_TYPES_ALL) {
      expect(coverageFor(t) * payoutMultiplierFor(t)).toBe(36);
    }
  });

  it("POCKETS contains 0..36 exactly once each", () => {
    expect(POCKET_COUNT).toBe(37);
    const set = new Set(POCKETS);
    expect(set.size).toBe(37);
    for (let i = 0; i <= 36; i++) expect(set.has(i)).toBe(true);
  });

  it("RED and BLACK partition 1..36 disjointly", () => {
    expect(RED_NUMBERS.size).toBe(18);
    expect(BLACK_NUMBERS.size).toBe(18);
    for (const n of RED_NUMBERS) expect(BLACK_NUMBERS.has(n)).toBe(false);
    for (let n = 1; n <= 36; n++) {
      expect(RED_NUMBERS.has(n) || BLACK_NUMBERS.has(n)).toBe(true);
    }
  });
});

describe("colorOf", () => {
  it("0 is green; reds are red; blacks are black", () => {
    expect(colorOf(0)).toBe("green");
    for (const n of RED_NUMBERS) expect(colorOf(n)).toBe("red");
    for (const n of BLACK_NUMBERS) expect(colorOf(n)).toBe("black");
  });
});

describe("numbersFor", () => {
  it("straight → just the chosen number", () => {
    const s = numbersFor({ type: "straight", number: 17, amount: 1 });
    expect(Array.from(s)).toEqual([17]);
  });

  it("dozens cover 1-12 / 13-24 / 25-36", () => {
    expect([...numbersFor({ type: "dozen1", amount: 1 })].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect([...numbersFor({ type: "dozen2", amount: 1 })].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 13),
    );
    expect([...numbersFor({ type: "dozen3", amount: 1 })].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 25),
    );
  });

  it("columns cover every third number starting from 1, 2, 3", () => {
    expect([...numbersFor({ type: "column1", amount: 1 })].sort((a, b) => a - b)).toEqual(
      [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
    );
    expect([...numbersFor({ type: "column2", amount: 1 })].sort((a, b) => a - b)).toEqual(
      [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
    );
    expect([...numbersFor({ type: "column3", amount: 1 })].sort((a, b) => a - b)).toEqual(
      [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
    );
  });

  it("low covers 1-18; high covers 19-36", () => {
    expect([...numbersFor({ type: "low", amount: 1 })].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    expect([...numbersFor({ type: "high", amount: 1 })].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 19),
    );
  });

  it("even and odd exclude 0", () => {
    const e = numbersFor({ type: "even", amount: 1 });
    const o = numbersFor({ type: "odd", amount: 1 });
    expect(e.has(0)).toBe(false);
    expect(o.has(0)).toBe(false);
    expect(e.size).toBe(18);
    expect(o.size).toBe(18);
  });

  it("red and black match the canonical sets", () => {
    expect(numbersFor({ type: "red", amount: 1 })).toBe(RED_NUMBERS);
    expect(numbersFor({ type: "black", amount: 1 })).toBe(BLACK_NUMBERS);
  });
});

describe("evaluate", () => {
  it("straight win pays 36×", () => {
    const r = evaluate([{ type: "straight", number: 17, amount: 10 }], 17);
    expect(r.bets[0].won).toBe(true);
    expect(r.bets[0].payout).toBe(360);
    expect(r.totalPayout).toBe(360);
    expect(r.totalStake).toBe(10);
  });

  it("straight on the wrong number loses", () => {
    const r = evaluate([{ type: "straight", number: 17, amount: 10 }], 3);
    expect(r.bets[0].won).toBe(false);
    expect(r.bets[0].payout).toBe(0);
    expect(r.totalPayout).toBe(0);
  });

  it("red bet pays 2× on a red number", () => {
    const r = evaluate([{ type: "red", amount: 100 }], 3);
    expect(r.bets[0].won).toBe(true);
    expect(r.bets[0].payout).toBe(200);
  });

  it("dozen1 pays 3× on a 1-12 number", () => {
    const r = evaluate([{ type: "dozen1", amount: 50 }], 8);
    expect(r.bets[0].won).toBe(true);
    expect(r.bets[0].payout).toBe(150);
  });

  it("multi-bet spin: results are independent", () => {
    // 3 is red, in dozen1, odd, low. The straight on 3 wins (360); red
    // wins (200); dozen1 wins (150); straight on 17 loses.
    const r = evaluate(
      [
        { type: "straight", number: 3, amount: 10 },
        { type: "red", amount: 100 },
        { type: "dozen1", amount: 50 },
        { type: "straight", number: 17, amount: 10 },
      ],
      3,
    );
    expect(r.totalStake).toBe(170);
    expect(r.totalPayout).toBe(360 + 200 + 150);
    expect(r.bets[3].won).toBe(false);
  });

  it("0 loses every outside bet", () => {
    for (const type of OUTSIDE_BET_TYPES) {
      const r = evaluate([{ type, amount: 10 } as Bet], 0);
      expect(r.bets[0].won, `outside type ${type} won on 0`).toBe(false);
    }
  });

  it("0 wins a straight bet on 0", () => {
    const r = evaluate([{ type: "straight", number: 0, amount: 10 }], 0);
    expect(r.bets[0].payout).toBe(360);
  });

  it("rejects invalid winning number", () => {
    expect(() => evaluate([{ type: "red", amount: 10 }], 37)).toThrow();
    expect(() => evaluate([{ type: "red", amount: 10 }], -1)).toThrow();
    expect(() => evaluate([{ type: "red", amount: 10 }], 1.5)).toThrow();
  });

  it("rejects invalid bet amounts", () => {
    expect(() => evaluate([{ type: "red", amount: 0 }], 3)).toThrow();
    expect(() => evaluate([{ type: "red", amount: -1 }], 3)).toThrow();
    expect(() => evaluate([{ type: "red", amount: 1.5 }], 3)).toThrow();
  });

  it("rejects out-of-range straight numbers", () => {
    expect(() => evaluate([{ type: "straight", number: 37, amount: 10 }], 3)).toThrow();
    expect(() => evaluate([{ type: "straight", number: -1, amount: 10 }], 3)).toThrow();
  });
});

describe("spin", () => {
  it("rigged spin is deterministic", () => {
    const bets: Bet[] = [
      { type: "straight", number: 7, amount: 10 },
      { type: "black", amount: 100 },
    ];
    const a = spin(bets, 7);
    const b = spin(bets, 7);
    expect(a).toEqual(b);
  });

  it("rejects empty bets and over-cap", () => {
    expect(() => spin([], 17)).toThrow("no_bets");
    const many: Bet[] = Array.from({ length: 51 }, () => ({
      type: "straight",
      number: 0,
      amount: 1,
    }));
    expect(() => spin(many, 17)).toThrow("too_many_bets");
  });

  it("accepts duplicate outside-bet types and sums payouts (chip stacking)", () => {
    // Two chips on red: should evaluate as two independent winning
    // bets when red comes up, with payouts summed.
    const bets: Bet[] = [
      { type: "red", amount: 5 },
      { type: "red", amount: 5 },
    ];
    const r = spin(bets, 3); // 3 is red
    expect(r.bets).toHaveLength(2);
    expect(r.bets.every((b) => b.won)).toBe(true);
    expect(r.totalStake).toBe(10);
    expect(r.totalPayout).toBe(20); // each pays 5 × 2 = 10
  });

  it("allows multiple straights on different numbers", () => {
    const bets: Bet[] = [
      { type: "straight", number: 1, amount: 10 },
      { type: "straight", number: 2, amount: 10 },
    ];
    expect(() => spin(bets, 1)).not.toThrow();
  });
});

describe("drawPocket fairness", () => {
  it("returns only 0..36", () => {
    for (let i = 0; i < 500; i++) {
      const p = drawPocket();
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(36);
      expect(Number.isInteger(p)).toBe(true);
    }
  });

  it("uniform distribution over 100k draws (each pocket ±1.5 % of 1/37)", () => {
    const N = 100_000;
    const counts: number[] = new Array(37).fill(0);
    for (let i = 0; i < N; i++) counts[drawPocket()]++;

    const expected = 1 / 37;
    for (let n = 0; n <= 36; n++) {
      const observed = counts[n] / N;
      expect(
        Math.abs(observed - expected),
        `pocket ${n} observed ${observed} expected ${expected}`,
      ).toBeLessThan(0.015);
    }
  }, 30_000);
});

describe("empirical RTP", () => {
  it("200k straight-bet spins land within 95–100 % (theoretical 97.30 %)", () => {
    const N = 200_000;
    const bet = 1;
    let totalIn = 0;
    let totalOut = 0;
    for (let i = 0; i < N; i++) {
      const r = spin([{ type: "straight", number: 17, amount: bet }]);
      totalIn += bet;
      totalOut += r.totalPayout;
    }
    const rtp = totalOut / totalIn;
    expect(rtp).toBeGreaterThan(0.95);
    expect(rtp).toBeLessThan(1.00);
  }, 30_000);

  it("100k red-bet spins land within 94–100 % (theoretical 97.30 %)", () => {
    const N = 100_000;
    const bet = 1;
    let totalIn = 0;
    let totalOut = 0;
    for (let i = 0; i < N; i++) {
      const r = spin([{ type: "red" as OutsideBetType, amount: bet }]);
      totalIn += bet;
      totalOut += r.totalPayout;
    }
    const rtp = totalOut / totalIn;
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(1.00);
  }, 30_000);
});

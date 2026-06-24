import { describe, expect, it } from "vitest";
import {
  GROWTH_RATE,
  HOUSE_EDGE,
  MAX_CRASH,
  applyCashOut,
  applyCrashTimeout,
  hasCrashed,
  multiplierAt,
  payoutFor,
  rollCrashPoint,
  startRound,
  toClientView,
  type CrashState,
} from "./crash";

function makeState(over: Partial<CrashState> = {}): CrashState {
  return {
    bet: 100,
    crashPoint: 2.0,
    startedAt: 1_000_000,
    growthRate: GROWTH_RATE,
    cashOut: null,
    finished: false,
    ...over,
  };
}

describe("rollCrashPoint", () => {
  it("is always >= 1.00 and <= MAX_CRASH", () => {
    for (let i = 0; i < 5_000; i++) {
      const cp = rollCrashPoint();
      expect(cp).toBeGreaterThanOrEqual(1.0);
      expect(cp).toBeLessThanOrEqual(MAX_CRASH);
    }
  });

  it("hits 1.00 (instant bust) close to HOUSE_EDGE rate", () => {
    const N = 20_000;
    let busts = 0;
    for (let i = 0; i < N; i++) {
      if (rollCrashPoint() === 1.0) busts++;
    }
    const rate = busts / N;
    expect(rate).toBeGreaterThan(HOUSE_EDGE - 0.01);
    expect(rate).toBeLessThan(HOUSE_EDGE + 0.01);
  });

  it("is floored to 2 decimal places", () => {
    for (let i = 0; i < 200; i++) {
      const cp = rollCrashPoint();
      expect(Math.round(cp * 100) / 100).toBeCloseTo(cp, 10);
    }
  });
});

describe("multiplierAt", () => {
  it("equals 1.00 at startedAt", () => {
    const s = makeState();
    expect(multiplierAt(s, s.startedAt)).toBe(1.0);
  });

  it("matches exp(rate * t) before crash, floored to 2dp", () => {
    const s = makeState({ crashPoint: 10 });
    const t = 5; // 5 seconds in
    const expected = Math.floor(Math.exp(GROWTH_RATE * t) * 100) / 100;
    expect(multiplierAt(s, s.startedAt + t * 1000)).toBeCloseTo(expected, 10);
  });

  it("clamps to crashPoint past the crash time", () => {
    const s = makeState({ crashPoint: 2.0 });
    expect(multiplierAt(s, s.startedAt + 60 * 1000)).toBe(2.0);
  });

  it("never returns negative time before startedAt", () => {
    const s = makeState();
    expect(multiplierAt(s, s.startedAt - 5000)).toBe(1.0);
  });
});

describe("hasCrashed", () => {
  it("is false before the crash time", () => {
    const s = makeState({ crashPoint: 2.0 });
    const tCrash = Math.log(2.0) / GROWTH_RATE;
    expect(hasCrashed(s, s.startedAt + (tCrash - 0.5) * 1000)).toBe(false);
  });

  it("is true once elapsed >= ln(crashPoint)/rate", () => {
    const s = makeState({ crashPoint: 2.0 });
    const tCrash = Math.log(2.0) / GROWTH_RATE;
    expect(hasCrashed(s, s.startedAt + (tCrash + 0.5) * 1000)).toBe(true);
  });
});

describe("applyCashOut", () => {
  it("stamps cashOut and marks finished/cashed_out", () => {
    const s = makeState({ crashPoint: 10 });
    const next = applyCashOut(s, s.startedAt + 3000);
    expect(next.finished).toBe(true);
    expect(next.outcome).toBe("cashed_out");
    expect(next.cashOut?.multiplier).toBeGreaterThan(1);
    expect(next.cashOut?.at).toBe(s.startedAt + 3000);
  });

  it("rejects after crash", () => {
    const s = makeState({ crashPoint: 1.5 });
    const tCrash = Math.log(1.5) / GROWTH_RATE;
    expect(() => applyCashOut(s, s.startedAt + (tCrash + 0.5) * 1000)).toThrow(
      "already_crashed",
    );
  });

  it("rejects on a finished state", () => {
    const s = makeState({ finished: true, outcome: "busted" });
    expect(() => applyCashOut(s, s.startedAt + 1000)).toThrow("hand_finished");
  });
});

describe("payoutFor", () => {
  it("returns 0 on busted rounds", () => {
    const s = makeState({ finished: true, outcome: "busted" });
    expect(payoutFor(s)).toBe(0);
  });

  it("returns floor(bet * cashOutMultiplier) on cashouts", () => {
    const s = makeState({
      bet: 100,
      finished: true,
      outcome: "cashed_out",
      cashOut: { multiplier: 2.43, at: 1 },
    });
    expect(payoutFor(s)).toBe(243);
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
  it("rejects non-positive integer bets", () => {
    expect(() => startRound(0)).toThrow("invalid_bet");
    expect(() => startRound(-1)).toThrow("invalid_bet");
    expect(() => startRound(1.5)).toThrow("invalid_bet");
  });

  it("uses provided crashPoint when given (for tests)", () => {
    const s = startRound(50, 3.14);
    expect(s.crashPoint).toBe(3.14);
    expect(s.bet).toBe(50);
    expect(s.finished).toBe(false);
  });
});

describe("toClientView", () => {
  it("hides crashPoint while running", () => {
    const s = makeState({ crashPoint: 5.0 });
    const v = toClientView(s, s.startedAt + 1000);
    expect(v.crashPoint).toBeNull();
    expect(v.finished).toBe(false);
    expect(v.multiplier).toBeGreaterThan(1);
  });

  it("reveals crashPoint once finished", () => {
    const s = applyCrashTimeout(makeState({ crashPoint: 1.42 }));
    const v = toClientView(s, 1_005_000);
    expect(v.crashPoint).toBe(1.42);
    expect(v.finished).toBe(true);
    expect(v.outcome).toBe("busted");
  });

  it("includes serverNow for clock-skew correction", () => {
    const s = makeState();
    const v = toClientView(s, 1_234_567);
    expect(v.serverNow).toBe(1_234_567);
  });
});

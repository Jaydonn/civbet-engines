import { describe, expect, it } from "vitest";
import {
  scoreHand,
  startHand,
  hit,
  stand,
  double,
  payoutFor,
  toClientView,
} from "./blackjack";
import type { Card, Rank } from "./types";

const c = (r: Rank, s: "S" | "H" | "D" | "C" = "S"): Card => ({ r, s });

// Build a deck where draws come off the FRONT in the order specified.
// startHand draws: player[0], dealer[0], player[1], dealer[1], then players
// hit / dealer hits from the rest.
function rigDeck(...cards: Card[]): Card[] {
  return cards;
}

describe("scoreHand", () => {
  it("counts simple totals", () => {
    expect(scoreHand([c("5"), c("7")])).toMatchObject({ total: 12, soft: false, bust: false });
  });

  it("treats ace as 11 when it fits (soft)", () => {
    expect(scoreHand([c("A"), c("6")])).toMatchObject({ total: 17, soft: true });
  });

  it("downgrades ace to 1 to avoid bust", () => {
    expect(scoreHand([c("A"), c("6"), c("T")])).toMatchObject({
      total: 17,
      soft: false,
    });
  });

  it("handles multiple aces", () => {
    expect(scoreHand([c("A"), c("A"), c("9")])).toMatchObject({ total: 21, soft: true });
    expect(scoreHand([c("A"), c("A"), c("A"), c("9")])).toMatchObject({
      total: 12,
      soft: false,
    });
  });

  it("flags blackjack only on first two cards", () => {
    expect(scoreHand([c("A"), c("K")])).toMatchObject({ total: 21, blackjack: true });
    expect(scoreHand([c("7"), c("7"), c("7")])).toMatchObject({
      total: 21,
      blackjack: false,
    });
  });

  it("flags bust", () => {
    expect(scoreHand([c("T"), c("8"), c("5")])).toMatchObject({ total: 23, bust: true });
  });
});

describe("startHand", () => {
  it("deals two cards each, alternating player-dealer", () => {
    // Deck order: 5(P0), 6(D0), 7(P1), 8(D1)
    const deck = rigDeck(c("5"), c("6"), c("7"), c("8"));
    const s = startHand(10, deck);
    expect(s.player).toEqual([c("5"), c("7")]);
    expect(s.dealer).toEqual([c("6"), c("8")]);
    expect(s.finished).toBe(false);
  });

  it("rejects non-positive or non-integer bets", () => {
    expect(() => startHand(0)).toThrow();
    expect(() => startHand(-5)).toThrow();
    expect(() => startHand(1.5)).toThrow();
  });

  it("ends immediately on natural player blackjack (dealer non-BJ)", () => {
    const deck = rigDeck(c("A"), c("9"), c("K"), c("8")); // P:A+K=21, D:9+8=17
    const s = startHand(10, deck);
    expect(s.finished).toBe(true);
    expect(s.outcome).toBe("player_blackjack");
    expect(payoutFor(s)).toBe(25); // 10 stake + 15 win
  });

  it("ends in push on dealer + player both blackjack", () => {
    const deck = rigDeck(c("A"), c("A"), c("K"), c("J"));
    const s = startHand(10, deck);
    expect(s.outcome).toBe("push");
    expect(payoutFor(s)).toBe(10);
  });

  it("ends in lose if only dealer has blackjack", () => {
    const deck = rigDeck(c("5"), c("A"), c("6"), c("K")); // P:5+6=11, D:A+K=21
    const s = startHand(10, deck);
    expect(s.outcome).toBe("lose");
    expect(payoutFor(s)).toBe(0);
  });
});

describe("hit / stand", () => {
  it("bust on hit", () => {
    // P:T+8=18, then hits T → 28
    const deck = rigDeck(c("T"), c("4"), c("8"), c("9"), c("T"));
    let s = startHand(10, deck);
    s = hit(s);
    expect(s.outcome).toBe("bust");
    expect(payoutFor(s)).toBe(0);
  });

  it("stand triggers dealer play and resolves", () => {
    // P:T+8=18, D:4+9=13, dealer draws T → 23 (bust) → player wins
    const deck = rigDeck(c("T"), c("4"), c("8"), c("9"), c("T"));
    let s = startHand(10, deck);
    s = stand(s);
    expect(s.outcome).toBe("win");
    expect(payoutFor(s)).toBe(20);
  });

  it("dealer hits soft 17", () => {
    // P:T+8=18, D:A+6=soft17 → must hit. Then draws 5 → hard 12 → 17 (hits again).
    // Build: P0=T, D0=A, P1=8, D1=6, dealer next draws: 5(→hard 12), then 5 (→17 hard, stand)
    const deck = rigDeck(c("T"), c("A"), c("8"), c("6"), c("5"), c("5"));
    let s = startHand(10, deck);
    s = stand(s);
    expect(s.dealer.map((x) => x.r)).toEqual(["A", "6", "5", "5"]);
    // Player 18 vs dealer 17 → win
    expect(s.outcome).toBe("win");
  });

  it("push on equal totals", () => {
    // P:T+8=18, D:T+8=18 (dealer stands on hard 18)
    const deck = rigDeck(c("T"), c("T"), c("8"), c("8"));
    let s = startHand(10, deck);
    s = stand(s);
    expect(s.outcome).toBe("push");
    expect(payoutFor(s)).toBe(10);
  });
});

describe("double", () => {
  it("doubles bet, draws exactly one card, forces stand", () => {
    // P:5+6=11 → double → +T = 21. D:T+7=17 (stands). Player wins on 21 vs 17.
    const deck = rigDeck(c("5"), c("T"), c("6"), c("7"), c("T"));
    let s = startHand(10, deck);
    s = double(s);
    expect(s.doubled).toBe(true);
    expect(s.player.length).toBe(3);
    expect(s.outcome).toBe("win");
    // Stake = 20; win pays 2x stake.
    expect(payoutFor(s)).toBe(40);
  });

  it("rejects double after a hit", () => {
    const deck = rigDeck(c("5"), c("6"), c("3"), c("7"), c("2"));
    let s = startHand(10, deck);
    s = hit(s);
    expect(() => double(s)).toThrow("double_only_on_first_action");
  });

  it("rejects actions after finish", () => {
    const deck = rigDeck(c("A"), c("9"), c("K"), c("8"));
    const s = startHand(10, deck);
    expect(s.finished).toBe(true);
    expect(() => hit(s)).toThrow();
    expect(() => stand(s)).toThrow();
    expect(() => double(s)).toThrow();
  });

  it("3:2 floors odd-stake blackjack payouts in the house's favour", () => {
    // Bet = 7, blackjack → return = 7 + floor(7 * 3/2) = 7 + 10 = 17
    const deck = rigDeck(c("A"), c("9"), c("K"), c("8"));
    const s = startHand(7, deck);
    expect(s.outcome).toBe("player_blackjack");
    expect(payoutFor(s)).toBe(17);
  });
});

describe("toClientView", () => {
  it("hides dealer hole card while live", () => {
    const deck = rigDeck(c("5"), c("6"), c("7"), c("8"));
    const s = startHand(10, deck);
    const v = toClientView(s);
    expect(v.dealer.length).toBe(1);
    expect(v.dealer[0]).toEqual(c("6"));
    expect(v.dealerScore).toBeNull();
    expect(v.canHit).toBe(true);
    expect(v.canStand).toBe(true);
    expect(v.canDouble).toBe(true);
  });

  it("reveals full dealer hand when finished", () => {
    const deck = rigDeck(c("A"), c("9"), c("K"), c("8"));
    const s = startHand(10, deck);
    const v = toClientView(s);
    expect(v.dealer.length).toBe(2);
    expect(v.dealerScore?.total).toBe(17);
    expect(v.canHit).toBe(false);
    expect(v.canDouble).toBe(false);
  });
});

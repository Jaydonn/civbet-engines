import type { Card, Rank } from "./types";
import { RANKS, SUITS } from "./types";
import { shuffle } from "./rng";

// Outcomes from the player's perspective.
export type Outcome =
  | "player_blackjack" // natural 21 vs non-blackjack dealer (pays 3:2)
  | "win"              // player wins (pays 1:1)
  | "push"             // tie (bet returned)
  | "lose"             // dealer wins
  | "bust";            // player busted (dealer doesn't draw)

export type BlackjackState = {
  deck: Card[];      // remaining cards; top is index 0
  player: Card[];
  dealer: Card[];
  bet: number;       // original bet
  doubled: boolean;  // true once player has doubled down
  finished: boolean;
  outcome?: Outcome;
};

// House rules: dealer hits soft 17, blackjack pays 3:2, double on any two
// cards allowed (subject to balance), no surrender, no split, no insurance.
export const RULES = {
  dealerHitsSoft17: true,
  blackjackPays: { num: 3, den: 2 },
} as const;

// ---------------------------------------------------------------------
// Hand value
// ---------------------------------------------------------------------
const RANK_BASE_VALUE: Record<Rank, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 10,
  Q: 10,
  K: 10,
};

export type HandScore = {
  total: number;    // best non-busting total, or lowest busting total
  soft: boolean;    // true if an ace is currently counted as 11
  blackjack: boolean;
  bust: boolean;
};

export function scoreHand(hand: readonly Card[]): HandScore {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += RANK_BASE_VALUE[c.r];
    if (c.r === "A") aces++;
  }
  // Upgrade aces from 1→11 as long as it doesn't bust.
  let soft = false;
  while (aces > 0 && total + 10 <= 21) {
    total += 10;
    aces--;
    soft = true;
  }
  const blackjack = hand.length === 2 && total === 21;
  const bust = total > 21;
  return { total, soft, blackjack, bust };
}

// ---------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------
export function freshShuffledDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push({ s, r });
  return shuffle(cards);
}

function draw(deck: Card[]): Card {
  const c = deck.shift();
  if (!c) throw new Error("deck_exhausted");
  return c;
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------
export function startHand(bet: number, providedDeck?: Card[]): BlackjackState {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw new Error("invalid_bet");
  }
  const deck = providedDeck ? providedDeck.slice() : freshShuffledDeck();
  // Casino-standard alternating deal: player, dealer, player, dealer.
  const p0 = draw(deck);
  const d0 = draw(deck);
  const p1 = draw(deck);
  const d1 = draw(deck);
  const player = [p0, p1];
  const dealer = [d0, d1];

  const state: BlackjackState = {
    deck,
    player,
    dealer,
    bet,
    doubled: false,
    finished: false,
  };

  // Check for naturals immediately.
  const ps = scoreHand(player);
  const ds = scoreHand(dealer);
  if (ps.blackjack || ds.blackjack) {
    return resolve(state);
  }
  return state;
}

export function hit(state: BlackjackState): BlackjackState {
  if (state.finished) throw new Error("hand_finished");
  if (state.doubled) throw new Error("cannot_hit_after_double");
  const next: BlackjackState = {
    ...state,
    deck: state.deck.slice(),
    player: state.player.slice(),
    dealer: state.dealer.slice(),
  };
  next.player.push(draw(next.deck));
  const score = scoreHand(next.player);
  if (score.bust) {
    next.finished = true;
    next.outcome = "bust";
  }
  return next;
}

export function stand(state: BlackjackState): BlackjackState {
  if (state.finished) throw new Error("hand_finished");
  const next: BlackjackState = {
    ...state,
    deck: state.deck.slice(),
    player: state.player.slice(),
    dealer: state.dealer.slice(),
  };
  return playDealerAndResolve(next);
}

export function double(state: BlackjackState): BlackjackState {
  if (state.finished) throw new Error("hand_finished");
  if (state.player.length !== 2) throw new Error("double_only_on_first_action");
  if (state.doubled) throw new Error("already_doubled");
  const next: BlackjackState = {
    ...state,
    deck: state.deck.slice(),
    player: state.player.slice(),
    dealer: state.dealer.slice(),
    doubled: true,
  };
  next.player.push(draw(next.deck));
  const ps = scoreHand(next.player);
  if (ps.bust) {
    next.finished = true;
    next.outcome = "bust";
    return next;
  }
  return playDealerAndResolve(next);
}

function playDealerAndResolve(state: BlackjackState): BlackjackState {
  while (true) {
    const ds = scoreHand(state.dealer);
    if (ds.total > 17) break;
    if (ds.total === 17 && !(RULES.dealerHitsSoft17 && ds.soft)) break;
    if (ds.total < 17 || (ds.total === 17 && ds.soft && RULES.dealerHitsSoft17)) {
      state.dealer.push(draw(state.deck));
      continue;
    }
    break;
  }
  return resolve(state);
}

function resolve(state: BlackjackState): BlackjackState {
  const ps = scoreHand(state.player);
  const ds = scoreHand(state.dealer);
  const next: BlackjackState = { ...state, finished: true };

  if (ps.blackjack && ds.blackjack) {
    next.outcome = "push";
  } else if (ps.blackjack) {
    next.outcome = "player_blackjack";
  } else if (ds.blackjack) {
    next.outcome = "lose";
  } else if (ps.bust) {
    next.outcome = "bust";
  } else if (ds.bust) {
    next.outcome = "win";
  } else if (ps.total > ds.total) {
    next.outcome = "win";
  } else if (ps.total < ds.total) {
    next.outcome = "lose";
  } else {
    next.outcome = "push";
  }
  return next;
}

// ---------------------------------------------------------------------
// Payout — total coins to credit back to the player at end of hand
// (the stake was already debited at start / double).
// ---------------------------------------------------------------------
export function payoutFor(state: BlackjackState): number {
  if (!state.finished || !state.outcome) return 0;
  const stake = state.bet * (state.doubled ? 2 : 1);
  switch (state.outcome) {
    case "player_blackjack":
      // 3:2 = stake + floor(stake * 3/2). For odd bets we floor in the
      // house's favour (standard).
      return stake + Math.floor((stake * RULES.blackjackPays.num) / RULES.blackjackPays.den);
    case "win":
      return stake * 2;
    case "push":
      return stake;
    case "lose":
    case "bust":
      return 0;
  }
}

// ---------------------------------------------------------------------
// Client-safe view (hides deck and dealer hole card while hand is live)
// ---------------------------------------------------------------------
export type ClientView = {
  player: Card[];
  playerScore: HandScore;
  dealer: Card[];        // length 1 (upcard) while live, full hand once finished
  dealerScore: HandScore | null; // null while live (hole card hidden)
  bet: number;
  doubled: boolean;
  finished: boolean;
  outcome: Outcome | null;
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
};

export function toClientView(state: BlackjackState): ClientView {
  const finished = state.finished;
  const dealerVisible = finished ? state.dealer : state.dealer.slice(0, 1);
  const dealerScore = finished ? scoreHand(state.dealer) : null;
  const playerScore = scoreHand(state.player);
  return {
    player: state.player,
    playerScore,
    dealer: dealerVisible,
    dealerScore,
    bet: state.bet,
    doubled: state.doubled,
    finished,
    outcome: state.outcome ?? null,
    canHit: !finished && !state.doubled,
    canStand: !finished,
    canDouble: !finished && state.player.length === 2 && !state.doubled,
  };
}

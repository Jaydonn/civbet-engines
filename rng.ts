import { randomInt } from "node:crypto";

// Math.random is banned in this directory. Always use these helpers,
// which delegate to crypto.randomInt (unbiased, cryptographically strong).
//
// SERVER-ONLY: do not import this (directly or transitively via
// blackjack.ts / slots.ts) from a client component. node:crypto isn't
// available in the browser bundle; the bundler resolves it to a stub
// and randomInt becomes undefined at runtime. Client-safe constants
// and pure logic live in lib/games/slots-data.ts and lib/games/types.ts.

export function rollInt(minInclusive: number, maxExclusive: number): number {
  return randomInt(minInclusive, maxExclusive);
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

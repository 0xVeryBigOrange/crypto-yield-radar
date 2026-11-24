import { parseDecimal } from "./money.js";

export const PRODUCT = {
  name: "橙签",
  nameEn: "OrangeOmens",
  ownerName: "大橙子",
  ownerHandle: "@0xVeryBigOrange",
  ownerUrl: "https://x.com/0xVeryBigOrange",
} as const;

/**
 * Deep readings only. 1 USDT = 100 橙币.
 * Most deep reads are 0.20; the Celtic cross is 0.50; light daily extras are 0.10;
 * the I Ching (two hexagrams) is 0.30. The month pass is unlimited deep reads.
 */
export const PRICE_USD = {
  omenDeep: "0.2",
  walletDeep: "0.2",
  tarotDeep: "0.2",
  tarotCeltic: "0.5",
  tickerDeep: "0.2",
  compatDeep: "0.2",
  stickDeep: "0.2",
  ichingDeep: "0.3",
  astroDeep: "0.1",
  matchDeep: "0.2",
  zodiacDeep: "0.1",
  almanacDeep: "0.1",
  numberDeep: "0.2",
  dreamDeep: "0.2",
  runeDeep: "0.2",
  lenormandDeep: "0.2",
  monthPass: "2.99",
} as const;

export const COINS_PER_USD = 100;
export const WELCOME_DEEP_CREDITS = 3;
export const INVITE_BONUS_USD = "0.3";
export const INVITEE_BONUS_USD = "0.1";
export const SHARE_BONUS_USD = "0.05";
export const INVITE_CAP = 50;

/** Check-in pays 2 橙币, plus 1 per streak day after the first, capped at 9. */
export function checkinBonusUsd(streak: number): string {
  const extra = Math.min(Math.max(streak, 1) - 1, 7);
  const coins = 2 + extra;
  return (coins / 100).toFixed(2);
}

export type PriceKey = keyof typeof PRICE_USD;

export function priceAmount(key: PriceKey): bigint {
  return parseDecimal(PRICE_USD[key]);
}

export const PASS_DAYS = 30;

export const MOODS = ["观望", "防守", "进取"] as const;
export type Mood = (typeof MOODS)[number];

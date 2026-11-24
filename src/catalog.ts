import { parseDecimal } from "./money.js";

export const PRODUCT = {
  name: "橙签",
  nameEn: "OrangeOmens",
  ownerName: "大橙子",
  ownerHandle: "@0xVeryBigOrange",
  ownerUrl: "https://x.com/0xVeryBigOrange",
} as const;

export const PRICE_USD = {
  omenFull: "1",
  walletFull: "2",
  tarotFull: "1",
  tickerFull: "1",
  compatFull: "1",
  monthPass: "9.9",
} as const;

export type PriceKey = keyof typeof PRICE_USD;

export function priceAmount(key: PriceKey): bigint {
  return parseDecimal(PRICE_USD[key]);
}

export const PASS_DAYS = 30;

export const MOODS = ["观望", "防守", "进取"] as const;
export type Mood = (typeof MOODS)[number];

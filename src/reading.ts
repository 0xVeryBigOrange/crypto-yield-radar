import { createHash, randomBytes } from "node:crypto";
import type { Mood } from "./catalog.js";
import { MOODS } from "./catalog.js";
import {
  BIRTHDAY_LINES,
  CARDS,
  CHASE_BANDS,
  COMPAT_BITS,
  COMPAT_FREE,
  LINES,
  MOOD_BLURBS,
  NO_BIRTHDAY,
  OWNER_BITS,
  PAST,
  PRESENT,
  QUOTES,
  REFUSALS,
  RHYTHM,
  TAROT_BITS,
  TAROT_SHORT,
  TEMPERAMENTS,
  TICKER_BITS,
  TICKER_FREE,
  WALLET_FREE,
  WALLET_SECTIONS,
  type CardFace,
} from "./copy.js";
import { pick, rngFrom, take, type Rng } from "./rng.js";
import { sgDay, usSessionDate, weekStart, zhDate } from "./time.js";
import {
  DISCLAIMER,
  MOOD_NOTE,
  clamp,
  fill,
  maskAddress,
  soulNumber,
} from "./text.js";

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Section {
  heading: string;
  text: string;
}

export type ReadingKind =
  | "omen"
  | "wallet"
  | "tarot"
  | "ticker"
  | "compat"
  | "stick"
  | "iching"
  | "astro"
  | "zodiac"
  | "almanac"
  | "number"
  | "dream"
  | "rune"
  | "lenormand";

export interface Reading {
  kind: ReadingKind;
  edition: string | null;
  day: string;
  title: string;
  summary: string;
  mood: Mood;
  moodNote: string;
  cards: CardFace[];
  basics?: Section[];
  sections: Section[];
  quote: string;
  candles: Candle[];
  weekCandles: Candle[];
  score: number | null;
  scoreLabel: string | null;
  tags: string[];
  subject: string | null;
  extras: Record<string, string | number | null>;
  disclaimer: string;
}

export function makeCandles(seed: string, count: number): Candle[] {
  const rng = rngFrom(`candles|${seed}`);
  let cursor = 35 + rng() * 30;
  const candles: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const open = cursor;
    const close = clamp(open + (rng() - 0.48) * 22, 8, 92);
    const high = clamp(Math.max(open, close) + rng() * 10, 0, 100);
    const low = clamp(Math.min(open, close) - rng() * 10, 0, 100);
    candles.push({
      o: round(open),
      h: round(high),
      l: round(low),
      c: round(close),
    });
    cursor = close;
  }
  return candles;
}

export function buildOmen(edition: "sg" | "us", day = edition === "sg" ? sgDay() : usSessionDate()): Reading {
  const rng = rngFrom(`omen|${edition}|${day}`);
  const mood = pick(rng, MOODS);
  const card = pick(rng, CARDS);
  const vars = { card: card.name, mood };
  const summary = fill(pick(rng, LINES[mood]), vars);
  const basics: Section[] = [
    { heading: "牌面", text: `${card.name}。${card.epithet}。${summary}` },
    { heading: "今天够用", text: `${MOOD_BLURBS[mood]}${fill(pick(rng, PRESENT[mood]), vars)}` },
  ];
  const sections: Section[] = [
    { heading: "盘前的影子", text: paragraph(rng, PAST[mood], vars) },
    { heading: "此刻的呼吸", text: paragraph(rng, PRESENT[mood], vars) },
    { heading: "后面的节奏", text: paragraph(rng, RHYTHM[mood], vars) },
  ];
  const title = edition === "sg" ? `今日橙签 · ${zhDate(day)}` : `美股开盘前 · ${zhDate(day)}`;
  return finish({
    kind: "omen",
    edition,
    day,
    title,
    summary,
    mood,
    cards: [card],
    basics,
    sections,
    quote: pick(rng, QUOTES),
    candleSeed: `omen|${edition}|${day}`,
    weekSeed: `omen|${edition}|${weekStart(day)}`,
    score: null,
    scoreLabel: null,
    tags: ["今日", mood],
    subject: null,
    extras: { blurbs: MOOD_BLURBS[mood] },
  });
}

export function buildWallet(address: string, day: string, birthday: string | null, chain: string | null): Reading {
  const masked = maskAddress(address);
  const soul = soulNumber(address);
  const rng = rngFrom(`wallet|${address}|${day}|${birthday ?? "none"}`);
  const mood = moodFromScore(soul * 7 + Math.floor(rng() * 20));
  const temper = TEMPERAMENTS[soul % TEMPERAMENTS.length] ?? TEMPERAMENTS[0]!;
  const chase = Math.floor(rng() * 101);
  const chaseLine = CHASE_BANDS.find((band) => chase <= band.max)?.text ?? CHASE_BANDS[4]!.text;
  const birthdayLine = birthday
    ? fill(pick(rng, BIRTHDAY_LINES), { birthday: zhDate(birthday) })
    : pick(rng, NO_BIRTHDAY);
  const vars = { mask: masked, soul: String(soul), temper, card: "命盘" };
  const summary = `${fill(pick(rng, WALLET_FREE), vars)}${birthdayLine}${chaseLine}`;
  const sections: Section[] = [
    { heading: "脾气小传", text: `${temper}。${paragraph(rng, WALLET_SECTIONS, vars)}` },
    { heading: "链上生日", text: birthdayLine },
    { heading: "心情天气", text: `${MOOD_BLURBS[mood]}${paragraph(rng, PRESENT[mood], vars)}` },
  ];
  return finish({
    kind: "wallet",
    edition: null,
    day,
    title: `钱包命盘 · ${masked}`,
    summary,
    mood,
    cards: [pick(rng, CARDS)],
    sections,
    quote: pick(rng, QUOTES),
    candleSeed: `wallet|${address}|${day}`,
    weekSeed: `wallet|${address}|${weekStart(day)}`,
    score: chase,
    scoreLabel: "追涨杀跌玩笑指数",
    tags: ["命盘", temper.split("：")[0] ?? "脾气"],
    subject: masked,
    extras: {
      soul,
      birthday: birthday ? zhDate(birthday) : null,
      chain,
      temper,
      chaseNote: "这个指数只是在开玩笑，不衡量收益，也不预测下一根K线。",
    },
  });
}

export function buildTarot(userId: string, day: string, question: string, tradeAsk: boolean): Reading {
  const rng = rngFrom(`tarot|${userId}|${day}|${question}`);
  const cards = take(rng, CARDS, 3);
  const mood = pick(rng, MOODS);
  const questionShort = question.length > 42 ? `${question.slice(0, 41)}…` : question;
  const refusal = tradeAsk ? pick(rng, REFUSALS) : "";
  const line = fill(pick(rng, LINES[mood]), { card: cards[0]!.name, mood });
  const summary = `${refusal}${fill(pick(rng, TAROT_SHORT), { question: questionShort, card: cards[0]!.name, line })}`;
  const positions = ["心里那根线", "手上的节奏", "今晚的天气"];
  const sections = cards.map((card, index) => ({
    heading: positions[index] ?? "牌面",
    text: `${card.name}：${card.epithet}。${paragraph(rng, TAROT_BITS, { card: card.name, question: questionShort })}`,
  }));
  return finish({
    kind: "tarot",
    edition: null,
    day,
    title: "塔罗一问",
    summary,
    mood,
    cards,
    sections,
    quote: pick(rng, QUOTES),
    candleSeed: `tarot|${userId}|${day}|${question}`,
    weekSeed: `tarot|${userId}|${weekStart(day)}`,
    score: null,
    scoreLabel: null,
    tags: ["提问", mood],
    subject: null,
    extras: { question: questionShort, tradeAsk: tradeAsk ? "yes" : "no" },
  });
}

export function buildTicker(seedId: string, day: string, masked: string): Reading {
  const rng = rngFrom(`ticker|${seedId}|${day}|${masked}`);
  const score = scoreFrom(rng);
  const mood = moodFromScore(score);
  const vars = { symbol: masked, score: String(score), card: "币缘" };
  const summary = fill(pick(rng, TICKER_FREE), vars);
  const sections: Section[] = [
    { heading: "缘分表面", text: paragraph(rng, TICKER_BITS, vars) },
    { heading: "相处节奏", text: paragraph(rng, RHYTHM[mood], { ...vars, card: pick(rng, CARDS).name }) },
    { heading: "今天不聊价格", text: "分数只描述想不想多看两眼。它不描述涨跌，也不写成交通指示。" },
  ];
  return finish({
    kind: "ticker",
    edition: null,
    day,
    title: `币缘 · ${masked}`,
    summary,
    mood,
    cards: [pick(rng, CARDS)],
    sections,
    quote: pick(rng, QUOTES),
    candleSeed: `ticker|${seedId}|${day}|${masked}`,
    weekSeed: `ticker|${masked}|${weekStart(day)}`,
    score,
    scoreLabel: "玩笑缘分",
    tags: ["币缘", masked],
    subject: masked,
    extras: {},
  });
}

export function buildCompat(seedId: string, day: string, left: string, right: string, withOwner: boolean): Reading {
  const rng = rngFrom(`compat|${seedId}|${day}|${left}|${right}`);
  const score = scoreFrom(rng);
  const mood = moodFromScore(score);
  const vars = { left, right, score: String(score), card: "合盘" };
  const summary = `${fill(pick(rng, COMPAT_FREE), vars)}${withOwner ? pick(rng, OWNER_BITS) : ""}`;
  const sections: Section[] = [
    { heading: "同屏", text: paragraph(rng, COMPAT_BITS, vars) },
    { heading: "互相", text: paragraph(rng, PRESENT[mood], vars) },
    { heading: "散场", text: paragraph(rng, RHYTHM[mood], vars) },
  ];
  return finish({
    kind: "compat",
    edition: withOwner ? "owner" : "pair",
    day,
    title: `合盘 · ${left} × ${right}`,
    summary,
    mood,
    cards: take(rng, CARDS, 2),
    sections,
    quote: pick(rng, QUOTES),
    candleSeed: `compat|${seedId}|${day}`,
    weekSeed: `compat|${seedId}|${weekStart(day)}`,
    score,
    scoreLabel: "合盘玩笑分",
    tags: ["合盘", mood],
    subject: `${left} × ${right}`,
    extras: { left, right, withOwner: withOwner ? "yes" : "no" },
  });
}

export function readingText(reading: Reading): string {
  return [
    reading.title,
    reading.summary,
    reading.quote,
    reading.moodNote,
    ...reading.cards.flatMap((card) => [card.name, card.epithet]),
    ...(reading.basics ?? []).flatMap((section) => [section.heading, section.text]),
    ...reading.sections.flatMap((section) => [section.heading, section.text]),
    ...Object.values(reading.extras).map((value) => (value == null ? "" : String(value))),
  ].join("\n");
}

export function randomSlug(prefix: "s" | "f"): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function questionKey(question: string): string {
  return createHash("sha256").update(question).digest("hex").slice(0, 16);
}

function finish(input: {
  kind: Reading["kind"];
  edition: string | null;
  day: string;
  title: string;
  summary: string;
  mood: Mood;
  cards: CardFace[];
  basics?: Section[];
  sections: Section[];
  quote: string;
  candleSeed: string;
  weekSeed: string;
  score: number | null;
  scoreLabel: string | null;
  tags: string[];
  subject: string | null;
  extras: Record<string, string | number | null>;
}): Reading {
  return {
    kind: input.kind,
    edition: input.edition,
    day: input.day,
    title: input.title,
    summary: input.summary,
    mood: input.mood,
    moodNote: MOOD_NOTE,
    cards: input.cards,
    basics: input.basics,
    sections: input.sections,
    quote: input.quote,
    candles: makeCandles(input.candleSeed, 1),
    weekCandles: makeCandles(input.weekSeed, 7),
    score: input.score,
    scoreLabel: input.scoreLabel,
    tags: input.tags,
    subject: input.subject,
    extras: input.extras,
    disclaimer: DISCLAIMER,
  };
}

function paragraph(rng: Rng, lines: readonly string[], vars: Record<string, string>): string {
  return take(rng, lines, 2)
    .map((line) => fill(line, vars))
    .join("");
}

function scoreFrom(rng: Rng): number {
  return 18 + Math.floor(rng() * 79);
}

function moodFromScore(score: number): Mood {
  if (score < 40) return "防守";
  if (score < 70) return "观望";
  return "进取";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

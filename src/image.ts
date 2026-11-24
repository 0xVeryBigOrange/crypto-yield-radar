import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { Candle } from "./reading.js";
import { DISCLAIMER, escapeHtml } from "./text.js";

const FONT = "Smiley Sans Oblique";

export interface Poster {
  title: string;
  summary: string;
  mood: string;
  moodNote: string;
  cards: Array<{ name: string; epithet: string }>;
  sections: Array<{ heading: string; text: string }>;
  quote: string;
  candles: Candle[];
  weekCandles: Candle[];
  score: number | null;
  scoreLabel: string | null;
  subject: string | null;
  disclaimer: string;
}

export type PosterLayout = "card" | "story";

export function fontFile(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/fonts/SmileySans-Oblique.otf");
}

export function renderSvg(poster: Poster, layout: PosterLayout, url: string): string {
  return layout === "story" ? storySvg(poster, url) : cardSvg(poster, url);
}

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontFiles: [fontFile()],
      loadSystemFonts: false,
      defaultFontFamily: FONT,
      sansSerifFamily: FONT,
    },
    languages: ["zh"],
  });
  return Buffer.from(resvg.render().asPng());
}

const pngCache = new Map<string, Buffer>();

export function renderPngCached(key: string, svg: string): Buffer {
  const hit = pngCache.get(key);
  if (hit) return hit;
  const png = renderPng(svg);
  pngCache.set(key, png);
  if (pngCache.size > 40) {
    const oldest = pngCache.keys().next().value;
    if (oldest) pngCache.delete(oldest);
  }
  return png;
}

export function candlesSvg(candles: Candle[], x: number, y: number, width: number, height: number): string {
  if (candles.length === 0) return "";
  const slot = width / candles.length;
  const body = Math.min(36, slot * 0.46);
  const lows = candles.map((candle) => Math.min(candle.l, candle.o, candle.c));
  const highs = candles.map((candle) => Math.max(candle.h, candle.o, candle.c));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(12, max - min);
  const yOf = (value: number) => y + height - ((value - min) / span) * (height - 4) - 2;
  let bodySvg = "";
  candles.forEach((candle, index) => {
    const cx = x + slot * index + slot / 2;
    const up = candle.c >= candle.o;
    const color = up ? "#1f9d62" : "#d4534c";
    const bodyY = yOf(Math.max(candle.o, candle.c));
    const bodyH = Math.max(8, Math.abs(yOf(candle.o) - yOf(candle.c)));
    const top = Math.min(yOf(candle.h), bodyY - 4);
    const bottom = Math.max(yOf(candle.l), bodyY + bodyH + 4);
    bodySvg += `<line x1="${cx.toFixed(1)}" y1="${top.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${bottom.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
    bodySvg += `<rect x="${(cx - body / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${body.toFixed(1)}" height="${bodyH.toFixed(1)}" rx="3" fill="${color}"/>`;
  });
  return bodySvg;
}

function cardSvg(poster: Poster, url: string): string {
  const card = poster.cards[0];
  const candles = poster.weekCandles.length > 1 ? poster.weekCandles : poster.candles;
  const score =
    poster.score != null && poster.scoreLabel
      ? text(poster.scoreLabel, 490, 248, 18, "#8c7564") + text(String(poster.score), 490, 300, 42, "#ff7a1a", "700")
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#140e0b"/>
  <circle cx="980" cy="40" r="180" fill="#ff7a1a" opacity="0.18"/>
  <rect x="36" y="36" width="1128" height="558" rx="28" fill="none" stroke="#e4c27a" stroke-opacity="0.45"/>
  <rect x="64" y="64" width="390" height="470" rx="22" fill="#f6efe2" stroke="#e4c27a" stroke-width="3"/>
  <rect x="80" y="80" width="358" height="438" rx="16" fill="none" stroke="#ff7a1a" stroke-opacity="0.35"/>
  ${text("橙签", 96, 130, 28, "#c4512f", "700")}
  ${text(card?.name ?? "橙签", 96, 220, 48, "#24150f", "700")}
  ${wrap(card?.epithet ?? "", 96, 270, 22, 32, 310, 3, "#5c4638")}
  <rect x="96" y="430" width="120" height="42" rx="21" fill="${moodColor(poster.mood)}"/>
  ${text(poster.mood, 118, 458, 22, "#fff8ee", "700")}
  ${text("ORANGEOMENS", 490, 108, 18, "#e4c27a", "700")}
  ${wrap(poster.title, 490, 158, 32, 42, 660, 2, "#f6efe2", "700")}
  ${score}
  ${wrap(poster.summary, 490, poster.score != null ? 330 : 250, 24, 34, 660, poster.score != null ? 2 : 4, "#f6efe2")}
  ${text("心情刻度，不是价格", 490, 430, 16, "#8c7564")}
  ${candlesSvg(candles, 490, 448, 640, 100)}
  ${text(DISCLAIMER, 64, 590, 16, "#e4c27a")}
  ${text(url, 700, 590, 14, "#8c7564")}
</svg>`;
}

function storySvg(poster: Poster, url: string): string {
  const card = poster.cards[0];
  const candles = poster.weekCandles.length > 0 ? poster.weekCandles : poster.candles;
  const sections = poster.sections
    .slice(0, 3)
    .map((section, index) => {
      const y = 800 + index * 180;
      return `<rect x="80" y="${y}" width="920" height="168" rx="18" fill="#24150f" stroke="#e4c27a" stroke-opacity="0.35"/>
        ${text(section.heading, 110, y + 36, 24, "#ffb15a", "700")}
        ${wrap(section.text, 110, y + 74, 24, 32, 850, 3, "#f6efe2")}`;
    })
    .join("");
  const score =
    poster.score != null
      ? text(`${poster.scoreLabel ?? "分数"}  ${poster.score}`, 560, 500, 26, "#c4512f", "700")
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#140e0b"/>
  <circle cx="900" cy="120" r="220" fill="#ff7a1a" opacity="0.16"/>
  <rect x="48" y="48" width="984" height="1824" rx="36" fill="none" stroke="#e4c27a" stroke-opacity="0.4"/>
  ${text("橙签  ·  ORANGEOMENS", 80, 120, 26, "#e4c27a", "700")}
  ${wrap(poster.title, 80, 190, 40, 52, 900, 2, "#f6efe2", "700")}
  <rect x="80" y="300" width="920" height="230" rx="24" fill="#f6efe2"/>
  ${text(card?.name ?? "", 110, 370, 42, "#24150f", "700")}
  ${wrap(card?.epithet ?? "", 110, 420, 24, 32, 520, 2, "#5c4638")}
  <rect x="110" y="470" width="140" height="40" rx="20" fill="${moodColor(poster.mood)}"/>
  ${text(poster.mood, 134, 498, 22, "#fff8ee", "700")}
  ${score}
  ${wrap(poster.summary, 80, 580, 26, 36, 900, 4, "#f6efe2")}
  ${text(poster.moodNote, 80, 750, 20, "#e4c27a")}
  ${sections}
  ${text("本周心情K线 · 心情刻度，不是价格", 80, 1370, 22, "#e4c27a")}
  ${candlesSvg(candles, 80, 1395, 920, 160)}
  ${wrap(`「${poster.quote}」`, 80, 1610, 24, 34, 900, 2, "#f6efe2")}
  ${text(poster.disclaimer || DISCLAIMER, 80, 1720, 20, "#e4c27a")}
  ${text(url, 80, 1770, 18, "#8c7564")}
</svg>`;
}

function moodColor(mood: string): string {
  if (mood === "防守") return "#3d6f8c";
  if (mood === "进取") return "#c4512f";
  return "#c9842a";
}

function text(value: string, x: number, y: number, size: number, fill: string, weight = "400"): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}">${escapeHtml(value)}</text>`;
}

function wrap(
  value: string,
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  maxChars: number,
  maxLines: number,
  fill: string,
  weight = "400",
): string {
  const lines = wrapLines(value, maxChars, size, maxLines);
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}">${escapeHtml(line)}</text>`,
    )
    .join("");
}

function wrapLines(value: string, maxWidth: number, size: number, maxLines: number): string[] {
  const chars = Array.from(value);
  const lines: string[] = [];
  let line: string[] = [];
  let width = 0;
  let index = 0;
  while (index < chars.length && lines.length < maxLines) {
    const ch = chars[index] ?? "";
    const next = glyphWidth(ch, size);
    if (line.length > 0 && width + next > maxWidth) {
      lines.push(line.join(""));
      line = [];
      width = 0;
      continue;
    }
    line.push(ch);
    width += next;
    index += 1;
  }
  if (line.length > 0 && lines.length < maxLines) lines.push(line.join(""));
  if (index < chars.length && lines.length > 0) {
    const last = Array.from(lines[lines.length - 1] ?? "");
    let trimmed = last;
    while (trimmed.length > 1 && measure(trimmed, size) > maxWidth - glyphWidth("…", size)) trimmed = trimmed.slice(0, -1);
    lines[lines.length - 1] = `${trimmed.join("")}…`;
  }
  return lines;
}

function measure(chars: string[], size: number): number {
  return chars.reduce((sum, ch) => sum + glyphWidth(ch, size), 0);
}

function glyphWidth(ch: string, size: number): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === " " || ch === "·") return size * 0.35;
  if (code <= 0xff) return size * 0.56;
  return size;
}

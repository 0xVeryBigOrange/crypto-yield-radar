import { PRICE_USD, PRODUCT } from "./catalog.js";
import { candlesSvg } from "./image.js";
import type { ReadingView } from "./product.js";
import { DISCLAIMER, NON_REFUNDABLE, escapeHtml } from "./text.js";

export function shareHtml(view: ReadingView, pageUrl: string, imageUrl: string): string {
  const card = view.cards[0];
  const title = splitTitle(view.title);
  const candles = view.weekCandles.length > 0 ? view.weekCandles : view.candles;
  const sections = view.sections
    .map(
      (section) =>
        `<section class="block"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.text)}</p></section>`,
    )
    .join("");
  const score =
    view.score != null
      ? `<p class="score"><span>${escapeHtml(view.scoreLabel ?? "分数")}</span><strong>${view.score}</strong></p>`
      : "";
  const description = `${view.summary} ${DISCLAIMER}`.slice(0, 180);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(view.title)} — ${PRODUCT.name}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(view.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(view.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><span class="seal" aria-hidden="true"></span><span>橙签</span></a>
    <a class="text-link" href="/">回牌桌</a>
  </header>
  <main class="wrap">
    <article class="sheet">
      <p class="stamp">仅供娱乐</p>
      <p class="eyebrow">${escapeHtml(PRODUCT.nameEn)} · ${escapeHtml(PRODUCT.ownerName)}</p>
      <h1>${escapeHtml(title.headline)}</h1>
      ${title.sub ? `<p class="fine">${escapeHtml(title.sub)}</p>` : ""}
      <p class="card-name">${escapeHtml(card?.name ?? "")}</p>
      <p class="epithet">${escapeHtml(card?.epithet ?? "")}</p>
      <p class="mood mood-${moodClass(view.mood)}">${escapeHtml(view.mood)}</p>
      <p class="fine">${escapeHtml(view.moodNote)}</p>
      <p class="summary">${escapeHtml(view.summary)}</p>
      ${extraLines(view)}
      ${score}
      ${sections}
      ${
        view.locked
          ? `<p class="fine">完整牌面 ${escapeHtml(view.priceUsd ?? "")} USDT。${escapeHtml(NON_REFUNDABLE)}。</p>`
          : `<p class="quote">「${escapeHtml(view.quote)}」</p>`
      }
      <div class="candle-box" aria-hidden="true">
        <svg viewBox="0 0 640 140" role="img">${candlesSvg(candles, 8, 8, 620, 120)}</svg>
        <p class="fine">心情刻度，不是价格。</p>
      </div>
      <p class="disclaimer">${escapeHtml(view.disclaimer || DISCLAIMER)}</p>
      <p class="fine">${escapeHtml(pageUrl)}</p>
    </article>
    <p class="fine center">完整三张、命盘和合盘在牌桌上。月卡 ${PRICE_USD.monthPass} USDT。</p>
  </main>
</body>
</html>`;
}

function splitTitle(title: string): { headline: string; sub: string } {
  const parts = title.split(" · ");
  return { headline: parts[0] ?? "", sub: parts.slice(1).join(" · ") };
}

function zhDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function extraLines(view: ReadingView): string {
  const bits: string[] = [];
  if (view.extras.soul != null) bits.push(`灵魂数字 ${view.extras.soul}`);
  if (view.extras.birthday) bits.push(`链上生日 ${zhDay(String(view.extras.birthday))}`);
  if (view.extras.chaseNote) bits.push(String(view.extras.chaseNote));
  if (view.extras.question) bits.push(`问题：${view.extras.question}`);
  return bits.map((line) => `<p class="fine">${escapeHtml(line)}</p>`).join("");
}

function moodClass(mood: string): string {
  if (mood === "防守") return "guard";
  if (mood === "进取") return "push";
  return "watch";
}

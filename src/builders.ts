import { PRICE_USD, type PriceKey } from "./catalog.js";
import {
  ANIMALS,
  almanacPicks,
  animalLine,
  animalOf,
  archetype,
  dailyScores,
  elementScore,
  lifePath,
  personalYear,
  SIGNS,
  signByName,
  yearAnimal,
  type Animal,
  type Sign,
} from "./content/astro.js";
import { hexFromLines, lineNote, parseLines, type CastLine } from "./content/iching.js";
import { LENORMAND, RUNES, matchDreams } from "./content/lexicon.js";
import { stickByNumber } from "./content/sticks.js";
import { SPREADS, TAROT_DECK, type SpreadId, type TarotCard } from "./content/tarotDeck.js";
import type { CardFace } from "./copy.js";
import { makeCandles, type Reading, type Section } from "./reading.js";
import { rngFrom, shuffle } from "./rng.js";
import { DISCLAIMER, MOOD_NOTE } from "./text.js";
import type { Mood } from "./catalog.js";

function moodOf(score: number): Mood {
  if (score < 45) return "防守";
  if (score < 72) return "观望";
  return "进取";
}

function pack(input: {
  kind: Reading["kind"];
  day: string;
  title: string;
  summary: string;
  mood: Mood;
  cards: CardFace[];
  basics: Section[];
  sections: Section[];
  quote: string;
  seed: string;
  score?: number | null;
  scoreLabel?: string | null;
  tags: string[];
  subject?: string | null;
  edition?: string | null;
  extras: Record<string, string | number | null>;
}): Reading {
  return {
    kind: input.kind,
    edition: input.edition ?? null,
    day: input.day,
    title: input.title,
    summary: input.summary,
    mood: input.mood,
    moodNote: MOOD_NOTE,
    cards: input.cards,
    basics: input.basics,
    sections: input.sections,
    quote: input.quote,
    candles: makeCandles(input.seed, 1),
    weekCandles: makeCandles(`${input.seed}|week`, 7),
    score: input.score ?? null,
    scoreLabel: input.scoreLabel ?? null,
    tags: input.tags,
    subject: input.subject ?? null,
    extras: input.extras,
    disclaimer: DISCLAIMER,
  };
}

function face(card: TarotCard, reversed: boolean): CardFace {
  return {
    name: reversed ? `${card.name} · 逆位` : `${card.name} · 正位`,
    epithet: reversed ? card.reversed : card.upright,
  };
}

export function shuffledDeck(seed: string): TarotCard[] {
  return shuffle(rngFrom(`deck|${seed}`), TAROT_DECK);
}

export function cutDeck(cards: readonly TarotCard[], cut: number): TarotCard[] {
  const index = ((cut % cards.length) + cards.length) % cards.length;
  return [...cards.slice(index), ...cards.slice(0, index)];
}

export function buildTarotDraw(input: {
  day: string;
  spread: SpreadId;
  question: string;
  nonce: string;
  cut: number;
  picks: number[] | null;
}): Reading {
  const spread = SPREADS[input.spread];
  const deck = cutDeck(shuffledDeck(`${input.day}|${input.nonce}|${input.spread}|${input.question}`), input.cut);
  const indexes = input.picks ?? Array.from({ length: spread.count }, (_item, index) => index);
  const rng = rngFrom(`flip|${input.day}|${input.nonce}|${indexes.join(",")}`);
  const drawn = indexes.map((index, position) => {
    const card = deck[index] ?? TAROT_DECK[0]!;
    const reversed = rng() > 0.62;
    return { card, reversed, position: spread.positions[position] ?? "牌" };
  });
  const score = 40 + Math.floor(rng() * 50);
  const mood = moodOf(score);
  const lead = drawn[0]!;
  const yesno =
    input.spread === "yesno"
      ? lead.reversed
        ? "语气先摇头：先别答应，也先别拒绝死。"
        : "语气先点头：可以小步试试，不必一次承诺到底。"
      : "";
  const summary = `${yesno}${spread.name}。${lead.position}是${lead.card.name}${lead.reversed ? "逆位" : "正位"}：${lead.reversed ? lead.card.reversed : lead.card.upright}`.slice(0, 280);
  const basics = drawn.map((item) => ({
    heading: item.position,
    text: `${item.card.name}${item.reversed ? "逆位" : "正位"}。${item.reversed ? item.card.reversed : item.card.upright}`,
  }));
  const sections = [
    {
      heading: "连起来看",
      text: drawn
        .map((item) => `${item.position}的${item.card.name}把话题放在${item.reversed ? "收回来" : "放出去"}的那一侧。`)
        .join(""),
    },
    {
      heading: "今晚可以做的",
      text: input.spread === "choice"
        ? "甲和乙都不是命运。看哪一边的天气让你肩膀松，就先在那一边待一个短时间，并留好回头的门。"
        : "免费的牌面已经把每张牌说完了。深度这一层只是把它们放在同一张桌上：少做不可逆的决定，多做一件能让身体放松的小事。",
    },
    ...drawn.slice(0, 4).map((item) => ({
      heading: `${item.position}再看一眼`,
      text: item.reversed
        ? `${item.card.name}逆着的时候，你可能在用劲的方向反了。把这一步缩小，小到明天还能修改。`
        : `${item.card.name}顺着的时候，也只是顺。顺不用加速，加速会把好语气变成催促。`,
    })),
  ];
  const question = input.question ? (input.question.length > 42 ? `${input.question.slice(0, 41)}…` : input.question) : "";
  return pack({
    kind: "tarot",
    day: input.day,
    title: `塔罗 · ${spread.name}`,
    summary,
    mood,
    cards: drawn.map((item) => face(item.card, item.reversed)),
    basics,
    sections,
    quote: "牌是语气，不是指令。",
    seed: `tarot|${input.day}|${input.nonce}|${input.spread}|${indexes.join(".")}`,
    score,
    scoreLabel: "牌面语气",
    tags: ["塔罗", spread.name, mood],
    extras: {
      spread: input.spread,
      question: question || null,
      priceUsd: PRICE_USD[spread.price],
      collect: drawn
        .map((item) => (item.card.arcana === "major" ? `major:${item.card.id}|tarot:${item.card.id}` : `tarot:${item.card.id}`))
        .join("|"),
    },
  });
}

export function buildStickDraw(day: string, nonce: string): Reading {
  const rng = rngFrom(`stick|${day}|${nonce}`);
  const stick = stickByNumber(1 + Math.floor(rng() * 100));
  const mood = stick.grade === "下下" || stick.grade === "中下" ? "防守" : stick.grade === "中平" ? "观望" : "进取";
  return pack({
    kind: "stick",
    day,
    title: `${stick.title} · ${stick.grade}`,
    summary: `${stick.poem.join("\n")}\n${stick.general}`,
    mood,
    cards: [{ name: `${stick.title} ${stick.grade}`, epithet: stick.poem[0] }],
    basics: [
      { heading: "签诗", text: stick.poem.join("\n") },
      { heading: "解签", text: stick.general },
    ],
    sections: [
      { heading: "事业", text: stick.career },
      { heading: "财运", text: stick.wealth },
      { heading: "感情", text: stick.love },
      { heading: "健康", text: stick.health },
    ],
    quote: stick.poem[3],
    seed: `stick|${day}|${nonce}`,
    score: stick.n,
    scoreLabel: "签号",
    tags: ["求签", stick.grade],
    subject: stick.title,
    extras: {
      grade: stick.grade,
      poem: stick.poem.join(" / "),
      priceUsd: PRICE_USD.stickDeep,
      collect: `stick:${stick.n}`,
    },
  });
}

export function buildIchingDraw(day: string, nonce: string, lines: CastLine[]): Reading {
  const cast = hexFromLines(lines);
  const changedName = cast.changed ? `${cast.changed.name}卦` : "没有变卦";
  const summary = `${cast.primary.vernacular}${cast.changed ? `动爻在第${cast.moving.join("、")}爻，变出${changedName}。` : "六爻安静，就停在本卦。"}`;
  const basics: Section[] = [
    { heading: "本卦", text: `${cast.primary.name}。${cast.primary.judge} ${cast.primary.vernacular}` },
  ];
  if (cast.changed) basics.push({ heading: "变卦", text: `${cast.changed.name}。${cast.changed.judge}变卦是语气转了一个弯，不是第二个人生命令。` });
  const sections: Section[] = [
    {
      heading: "白话",
      text: `上${cast.primary.upper}下${cast.primary.lower}。${cast.primary.name}今晚的用法很窄：看你是该停、该说，还是该把一件事做小。古辞留作典故，不留作日程。`,
    },
    ...cast.moving.map((position) => ({
      heading: `第${position}爻`,
      text: lineNote(position, lines[position - 1]?.value === 9),
    })),
    {
      heading: "如果没有动爻",
      text: cast.moving.length === 0 ? "安静本身就是回答：维持，观察，别为了让卦热闹而找事。" : "动的地方已经点名。其余的爻今天不必一起出场。",
    },
  ];
  return pack({
    kind: "iching",
    day,
    title: cast.changed ? `${cast.primary.name}之${cast.changed.name}` : `${cast.primary.name}卦`,
    summary,
    mood: cast.moving.length > 3 ? "观望" : cast.moving.length === 0 ? "防守" : "进取",
    cards: [
      { name: cast.primary.name, epithet: "本卦" },
      ...(cast.changed ? [{ name: cast.changed.name, epithet: "变卦" }] : []),
    ],
    basics,
    sections,
    quote: "卦辞是古话，心情是你的。",
    seed: `iching|${day}|${nonce}|${lines.map((line) => line.value).join("")}`,
    score: cast.primary.n,
    scoreLabel: "卦序",
    tags: ["易经", cast.primary.name],
    subject: cast.primary.name,
    extras: {
      lines: lines.map((line) => line.value).join(""),
      moving: cast.moving.join(",") || null,
      priceUsd: PRICE_USD.ichingDeep,
      collect: `hex:${cast.primary.n}${cast.changed ? `|hex:${cast.changed.n}` : ""}`,
    },
  });
}

export function rollLines(seed: string): CastLine[] {
  const rng = rngFrom(`coins|${seed}`);
  const values = Array.from({ length: 6 }, () => {
    const sum = [0, 1, 2].reduce((total) => total + (rng() < 0.5 ? 3 : 2), 0);
    return sum;
  });
  return parseLines(values) ?? parseLines([7, 8, 7, 8, 7, 8])!;
}

function scoreReading(input: {
  kind: Reading["kind"];
  day: string;
  title: string;
  seed: string;
  summary: string;
  basics: Section[];
  sections: Section[];
  tags: string[];
  price: PriceKey;
  subject?: string;
  collect?: string;
  extra?: Record<string, string | number | null>;
}): Reading {
  const scores = dailyScores(input.seed);
  const mood = moodOf(scores.mood);
  return pack({
    kind: input.kind,
    day: input.day,
    title: input.title,
    summary: input.summary,
    mood,
    cards: [{ name: input.subject ?? input.title, epithet: mood }],
    basics: input.basics,
    sections: input.sections,
    quote: "分数是心情刻度，不是行情。",
    seed: input.seed,
    score: scores.mood,
    scoreLabel: "今日心情",
    tags: input.tags,
    subject: input.subject ?? null,
    extras: {
      bond: scores.bond,
      work: scores.work,
      priceUsd: PRICE_USD[input.price],
      collect: input.collect ?? null,
      ...input.extra,
    },
  });
}

export function buildAstro(signName: string, day: string): Reading | null {
  const sign = signByName(signName);
  if (!sign) return null;
  const scores = dailyScores(`astro|${sign.name}|${day}`);
  const summary = `${sign.name}座今天的语气：${sign.phrase}。心情 ${scores.mood}，相处 ${scores.bond}，做事 ${scores.work}。这三格都是心情刻度，用来安排节奏，不用来预测涨跌。`;
  return scoreReading({
    kind: "astro",
    day,
    title: `${sign.name} · 今日`,
    seed: `astro|${sign.name}|${day}`,
    summary,
    basics: [
      { heading: "今日", text: summary },
      { heading: "元素", text: `${sign.name}属${sign.element}。${elementAdvice(sign)}` },
    ],
    sections: [
      { heading: "相处", text: `相处分 ${scores.bond}。分高就多听一句，分低就少解释。两种都不是谁对谁错。` },
      { heading: "做事", text: `做事分 ${scores.work}。把它理解成耐心，而不是产出。做完一件小的，就算对得起这个数字。` },
      { heading: "这周的天气", text: `${sign.phrase}。后几天如果还是同一星座，故事会换句子，性格不会换人。` },
    ],
    tags: ["星座", sign.name],
    price: "astroDeep",
    subject: sign.name,
    extra: { sign: sign.name, element: sign.element },
  });
}

function elementAdvice(sign: Sign): string {
  if (sign.element === "火") return "火想行动。行动缩成二十分钟，就不会烧到别人。";
  if (sign.element === "土") return "土想落实。落实一件看得见的，比列十件计划更像你。";
  if (sign.element === "风") return "风想说话。说完就停，留白给对方。";
  return "水想感受。感受之后吃点东西，感受会回到身体里。";
}

export function astroTeasers(day: string): Array<{ sign: string; line: string; score: number }> {
  return SIGNS.map((sign) => {
    const scores = dailyScores(`astro|${sign.name}|${day}`);
    return { sign: sign.name, line: sign.phrase, score: scores.mood };
  });
}

export function buildMatch(leftName: string, rightName: string, day: string): Reading | null {
  const left = signByName(leftName);
  const right = signByName(rightName);
  if (!left || !right) return null;
  const base = elementScore(left, right);
  const wobble = dailyScores(`match|${left.name}|${right.name}|${day}`).mood % 7;
  const score = Math.max(45, Math.min(96, base + wobble - 3));
  const summary = `${left.name}与${right.name}的玩笑合盘是 ${score}。${left.element}遇${right.element}，${score >= 75 ? "容易聊到一起，也容易一起吵得热闹。" : "需要翻译。翻译的意思是少用自己的速度要求对方。"}`;
  return pack({
    kind: "astro",
    edition: "match",
    day,
    title: `星座配对 · ${left.name} × ${right.name}`,
    summary,
    mood: moodOf(score),
    cards: [
      { name: left.name, epithet: left.phrase },
      { name: right.name, epithet: right.phrase },
    ],
    basics: [
      { heading: "合盘", text: summary },
      { heading: "怎么处", text: "分数高不代表省心，分数低不代表散场。它只描述你们今晚要不要把话说慢。" },
    ],
    sections: [
      { heading: left.name, text: `${left.phrase}。跟${right.name}在一起时，先说需求，再说评价。` },
      { heading: right.name, text: `${right.phrase}。跟${left.name}在一起时，先确认听到了，再补充自己的版本。` },
      { heading: "今日附加", text: "配对是娱乐模型。真正的相处看你们能不能一起吃饭而不比赛。" },
    ],
    quote: "合得来是练习，不是奖状。",
    seed: `match|${left.name}|${right.name}|${day}`,
    score,
    scoreLabel: "玩笑合盘",
    tags: ["配对", left.name, right.name],
    subject: `${left.name} × ${right.name}`,
    extras: { left: left.name, right: right.name, priceUsd: PRICE_USD.matchDeep, collect: null },
  });
}

export function buildZodiac(name: string, day: string): Reading | null {
  const animal = animalOf(name);
  if (!animal) return null;
  const year = yearAnimal(day);
  const line = animalLine(animal);
  const spoken = /[。！？]$/.test(line) ? line : `${line}。`;
  const summary = `属${animal}。${spoken}今年的值年是${year}，只用来调语气，不用来吓自己。`;
  return scoreReading({
    kind: "zodiac",
    day,
    title: `生肖 · ${animal}`,
    seed: `zodiac|${animal}|${day}`,
    summary,
    basics: [
      { heading: "今日", text: summary },
      { heading: "跟值年", text: animal === year ? "值年在自己身上，别人的话会变响。响的时候少答应。" : `${animal}遇到${year}年，保持自己的步速就好。` },
    ],
    sections: [
      { heading: "做事", text: `${spoken}工作上的用法是缩小范围，不是更换人格。` },
      { heading: "相处", text: "生肖不是兼容性考试。跟谁都合得来或合不来，都比十二个动物更具体。" },
      { heading: "照顾", text: "属相不负责你的睡眠。睡眠负责你明天还想不想看这支签。" },
    ],
    tags: ["生肖", animal],
    price: "zodiacDeep",
    subject: animal,
    extra: { animal, year },
  });
}

export function zodiacTeasers(_day: string): Array<{ animal: Animal; line: string }> {
  return ANIMALS.map((animal) => ({ animal, line: animalLine(animal) }));
}

export function buildAlmanac(day: string): Reading {
  const picks = almanacPicks(day);
  const animal = yearAnimal(day);
  const summary = `${day} 娱乐黄历。干支${picks.pillar}（公历推算，供玩）。值年${animal}。宜 ${picks.yi.join("、")}。忌 ${picks.ji.join("、")}。`;
  return pack({
    kind: "almanac",
    day,
    title: `黄历 · ${day}`,
    summary,
    mood: "观望",
    cards: [{ name: picks.pillar, epithet: `宜${picks.yi[0] ?? "休息"}` }],
    basics: [
      { heading: "宜", text: picks.yi.join("、") },
      { heading: "忌", text: picks.ji.join("、") },
      { heading: "点缀", text: `吉色是玩笑里的${picks.color}，吉数 ${picks.lucky}。都是气氛，不是开运配方。` },
    ],
    sections: [
      { heading: "为什么是这些", text: "宜忌从一篮日常小事里按日期抽出，让今天有个可执行的小仪式。它不连接农业历的正式宜忌，也不指导买卖。" },
      { heading: "值年", text: `${animal}年的说法只到立春前后的近似。真要过传统节日，请查正式农历。这里只借生肖说话。` },
      { heading: "怎么用", text: `如果只做一个，就做「${picks.yi[0] ?? "喝水"}」。如果只停一个，就停「${picks.ji[0] ?? "熬夜"}」。` },
    ],
    quote: "黄历是日程的语气，不是法令。",
    seed: `almanac|${day}`,
    score: picks.lucky,
    scoreLabel: "玩笑吉数",
    tags: ["黄历", animal],
    subject: picks.pillar,
    extras: {
      yi: picks.yi.join("、"),
      ji: picks.ji.join("、"),
      color: picks.color,
      pillar: picks.pillar,
      animal,
      priceUsd: PRICE_USD.almanacDeep,
      collect: null,
    },
  });
}

export function buildNumber(birthday: string, day: string): Reading | null {
  const path = lifePath(birthday);
  if (!path) return null;
  const year = personalYear(birthday, day);
  const face = archetype(path);
  const yearFace = year ? archetype(year) : null;
  const summary = `${birthday} 的生命灵数是 ${path}，叫「${face.name}」。${face.text}`;
  return pack({
    kind: "number",
    day,
    title: `生命灵数 · ${path}`,
    summary,
    mood: moodOf(40 + path * 4),
    cards: [{ name: String(path), epithet: face.name }],
    basics: [
      { heading: "灵数", text: face.text },
      { heading: "不是标签", text: "数字把生日收成一个余数，方便讲故事。故事讲完，人还是原来的人。" },
    ],
    sections: [
      { heading: "个人年", text: year && yearFace ? `今年走到 ${year}（${yearFace.name}）。${yearFace.deep}` : "个人年没有算出来。" },
      { heading: "再用深一点", text: face.deep },
      { heading: "边界", text: "灵数不诊断性格障碍，也不规划财务。它只提供一个今晚能用的比喻。" },
    ],
    quote: "生日很具体，命运不是。",
    seed: `number|${birthday}|${day.slice(0, 4)}`,
    score: path,
    scoreLabel: "灵数",
    tags: ["灵数", face.name],
    subject: birthday,
    extras: { path, personalYear: year, priceUsd: PRICE_USD.numberDeep, collect: null },
  });
}

export function buildDream(text: string, day: string, nonce: string): Reading {
  const hits = matchDreams(text);
  const clipped = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  const summary = hits.length
    ? `梦里看见${hits.map((hit) => hit.title).join("、")}。${hits.map((hit) => hit.text).join("")}`
    : `你写下「${clipped}」。词库没有逐字对上，就按语气来读：这是一段想被理解的画面，不是要兑现的预报。`;
  const basics = hits.length
    ? hits.map((hit) => ({ heading: hit.title, text: hit.text }))
    : [{ heading: "泛读", text: "把梦当成白天没说完的话。它夸张、它跳跃，它不负责明天的新闻。" }];
  const sections = hits.length
    ? [
        ...hits.map((hit) => ({ heading: `${hit.title}再看`, text: hit.deep })),
        { heading: "合在一起", text: "几个意象如果互相打架，就以身体的感受为准：紧就休息，松就去做事。不要投票选出一个标准答案。" },
      ]
    : [
        { heading: "可以补的词", text: "如果还想对上词库，试着加上景物：水、门、路、人、动物。没有也对，泛读已经完整。" },
        { heading: "深度也是闲聊", text: "没有关键词时，深度解读只是把你的句子慢读一遍：谁在场，你怕什么，醒来第一件能做的小事是什么。" },
      ];
  return pack({
    kind: "dream",
    day,
    title: hits.length ? `解梦 · ${hits[0]!.title}` : "解梦 · 泛读",
    summary: summary.slice(0, 320),
    mood: "观望",
    cards: [{ name: hits[0]?.title ?? "梦", epithet: clipped }],
    basics,
    sections,
    quote: "梦是夜班的心情，不是白班的命令。",
    seed: `dream|${day}|${nonce}|${text}`,
    tags: ["解梦", hits[0]?.title ?? "泛读"],
    subject: clipped,
    extras: { hits: hits.map((hit) => hit.title).join("、") || null, priceUsd: PRICE_USD.dreamDeep, collect: null },
  });
}

function drawFrom<T>(seed: string, deck: readonly T[], count: number): T[] {
  return shuffle(rngFrom(seed), deck).slice(0, count);
}

export function buildRuneDraw(day: string, nonce: string, count: 1 | 3): Reading {
  const drawn = drawFrom(`rune|${day}|${nonce}`, RUNES, count);
  const positions = count === 1 ? ["今日"] : ["情境", "阻碍", "可做的"];
  const summary = drawn.map((rune, index) => `${positions[index] ?? "符文"}${rune.name}：${rune.text}`).join("");
  return pack({
    kind: "rune",
    day,
    title: count === 1 ? `符文 · ${drawn[0]!.name}` : "符文三石",
    summary: summary.slice(0, 320),
    mood: "观望",
    cards: drawn.map((rune) => ({ name: rune.name, epithet: rune.aka })),
    basics: drawn.map((rune, index) => ({ heading: positions[index] ?? rune.name, text: `${rune.name}（${rune.aka}）。${rune.text}` })),
    sections: drawn.map((rune, index) => ({
      heading: `${positions[index] ?? "符文"}的阴影`,
      text: `${rune.name}：${rune.shadow}北欧符文在这里只当象征，不当法术。`,
    })),
    quote: "石头是凉的，建议是轻的。",
    seed: `rune|${day}|${nonce}|${count}`,
    tags: ["符文", ...drawn.map((rune) => rune.name)],
    extras: {
      count,
      priceUsd: PRICE_USD.runeDeep,
      collect: drawn.map((rune) => `rune:${rune.id}`).join("|"),
    },
  });
}

export function buildLenormandDraw(day: string, nonce: string, count: 3 | 5): Reading {
  const drawn = drawFrom(`lenormand|${day}|${nonce}`, LENORMAND, count);
  const positions = ["起点", "中间", "旁边", "压力", "落点"];
  const summary = `雷诺曼${count}张：${drawn.map((card) => card.name).join("、")}。${drawn[0]?.text ?? ""}`;
  return pack({
    kind: "lenormand",
    day,
    title: `雷诺曼 · ${drawn.map((card) => card.name).join("")}`,
    summary: summary.slice(0, 320),
    mood: "观望",
    cards: drawn.map((card) => ({ name: card.name, epithet: card.text })),
    basics: drawn.map((card, index) => ({ heading: positions[index] ?? card.name, text: `${card.name}。${card.text}` })),
    sections: [
      {
        heading: "连读",
        text: drawn.map((card, index) => `${positions[index] ?? "此处"}看到${card.name}，就把话题收成一句具体的话。`).join(""),
      },
      { heading: "用法", text: "雷诺曼喜欢名词。名词落在生活里：谁、哪件事、哪一种重复。不要把它读成财富预言。" },
    ],
    quote: "牌小，句子也小。",
    seed: `lenormand|${day}|${nonce}|${count}`,
    tags: ["雷诺曼", ...drawn.map((card) => card.name).slice(0, 3)],
    extras: { count, priceUsd: PRICE_USD.lenormandDeep, collect: drawn.map((card) => `lenormand:${card.id}`).join("|") },
  });
}

export function priceKeyForSpread(spread: SpreadId): PriceKey {
  return SPREADS[spread].price;
}

export function publicStick(day: string): Reading {
  return buildStickDraw(day, "public");
}

export function publicTarot(day: string): Reading {
  return buildTarotDraw({ day, spread: "daily", question: "", nonce: "public", cut: 0, picks: null });
}

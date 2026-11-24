import { rngFrom } from "../rng.js";

export interface Sign {
  name: string;
  element: "火" | "土" | "风" | "水";
  phrase: string;
}

export const SIGNS: readonly Sign[] = [
  { name: "白羊", element: "火", phrase: "想先动起来，动之前喝口水" },
  { name: "金牛", element: "土", phrase: "喜欢摸得着的进度" },
  { name: "双子", element: "风", phrase: "一脑子两句话，挑一句说完" },
  { name: "巨蟹", element: "水", phrase: "先把窝安顿好，心情才出门" },
  { name: "狮子", element: "火", phrase: "想被看见，也想被轻轻放下" },
  { name: "处女", element: "土", phrase: "细节是你的语言，别用它责骂自己" },
  { name: "天秤", element: "风", phrase: "两边都好看，选能睡觉的那边" },
  { name: "天蝎", element: "水", phrase: "感受很深，不用说给所有人" },
  { name: "射手", element: "火", phrase: "远方在招手，鞋子先穿对" },
  { name: "摩羯", element: "土", phrase: "台阶要一级级走，今天走一级" },
  { name: "水瓶", element: "风", phrase: "古怪的想法可以留，不必立刻招募信徒" },
  { name: "双鱼", element: "水", phrase: "边界软的时候，先找一件具体的事" },
];

const RANGES: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ["白羊", 3, 21, 4, 19],
  ["金牛", 4, 20, 5, 20],
  ["双子", 5, 21, 6, 21],
  ["巨蟹", 6, 22, 7, 22],
  ["狮子", 7, 23, 8, 22],
  ["处女", 8, 23, 9, 22],
  ["天秤", 9, 23, 10, 23],
  ["天蝎", 10, 24, 11, 22],
  ["射手", 11, 23, 12, 21],
  ["摩羯", 12, 22, 1, 19],
  ["水瓶", 1, 20, 2, 18],
  ["双鱼", 2, 19, 3, 20],
];

export const ANIMALS = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"] as const;
export type Animal = (typeof ANIMALS)[number];

const ANIMAL_LINE: Record<Animal, string> = {
  鼠: "眼尖，今天少打探，多收成一件小事",
  牛: "稳。稳不是慢吞吞给别人看，是自己不慌",
  虎: "有冲劲。冲之前看一眼旁边的人还在不在",
  兔: "敏感是雷达，不是判决。雷达响了就离吵一点",
  龙: "想把场面做大。今天做小的那一版，更耐看",
  蛇: "想得深。深的话留三成给自己，说出去七成就够",
  马: "腿想走。走可以，别把赶路当成逃避谈话",
  羊: "想被温柔对待，就先温柔地拒绝一件消耗",
  猴: "点子多。点子先写下来，再决定哪一个值得动手",
  鸡: "在意秩序。秩序服务休息，不是服务挑剔",
  狗: "忠诚很重。重的部分今天可以放下一个",
  猪: "会享受是本事。享受一件具体的，不要同时内疚",
};

const YI = [
  "早睡",
  "把桌面清空",
  "走路十五分钟",
  "给朋友发一句不谈行情的话",
  "喝够水",
  "写三行日记",
  "关掉通知一小会儿",
  "晒一会儿太阳",
  "整理相册里十张",
  "听完一首歌再打开屏幕",
  "把明天的一件事写短",
  "自己做饭里最简单的那道",
  "伸懒腰",
  "把欠的一句谢谢说掉",
  "看窗外两分钟",
  "把口袋里的收据丢掉",
];

const JI = [
  "熬夜盯屏幕",
  "把心情写成价格",
  "空腹做决定",
  "连续刷新",
  "跟陌生人争对错",
  "把玩笑当真",
  "一次承诺三件事",
  "用别人的进度骂自己",
  "在疲劳时谈分手或合作",
  "收集更多未读",
  "把身体的不舒服拖成英雄主义",
  "深夜下单来缓解无聊",
];

const COLORS = ["暖橙", "雾蓝", "米白", "松绿", "夜金", "豆沙"];
const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

export function signByName(name: string): Sign | null {
  return SIGNS.find((sign) => sign.name === name.trim()) ?? null;
}

export function signByMonthDay(month: number, day: number): Sign | null {
  for (const [name, sm, sd, em, ed] of RANGES) {
    const start = sm * 100 + sd;
    const end = em * 100 + ed;
    const cursor = month * 100 + day;
    const hit = start <= end ? cursor >= start && cursor <= end : cursor >= start || cursor <= end;
    if (hit) return signByName(name) ?? null;
  }
  return null;
}

export function animalOf(name: string): Animal | null {
  return (ANIMALS as readonly string[]).includes(name) ? (name as Animal) : null;
}

/** Approximate lunar year: before Feb 4 still belongs to the previous animal. 2020 is 鼠. */
export function yearAnimal(day: string): Animal {
  const [yearText, monthText, dayText] = day.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const date = Number(dayText);
  const lunarYear = month < 2 || (month === 2 && date < 4) ? year - 1 : year;
  const index = ((lunarYear - 2020) % 12 + 12) % 12;
  return ANIMALS[index] ?? "鼠";
}

/** Entertainment sexagenary day. Anchor: 2000-01-01 is treated as 戊午 for a stable cycle. */
export function ganzhiDay(day: string): string {
  const cursor = Date.parse(`${day}T00:00:00Z`);
  const anchor = Date.parse("2000-01-01T00:00:00Z");
  const diff = Math.round((cursor - anchor) / 86_400_000);
  const ganIndex = (4 + diff) % 10;
  const zhiIndex = (6 + diff) % 12;
  const gan = GAN[((ganIndex % 10) + 10) % 10] ?? "甲";
  const zhi = ZHI[((zhiIndex % 12) + 12) % 12] ?? "子";
  return `${gan}${zhi}`;
}

export function dailyScores(seed: string): { mood: number; bond: number; work: number } {
  const rng = rngFrom(seed);
  const band = () => 35 + Math.floor(rng() * 56);
  return { mood: band(), bond: band(), work: band() };
}

export function animalLine(animal: Animal): string {
  return ANIMAL_LINE[animal];
}

export function almanacPicks(day: string): { yi: string[]; ji: string[]; color: string; lucky: number; pillar: string } {
  const rng = rngFrom(`almanac|${day}`);
  const take = (bank: readonly string[], count: number) => {
    const pool = [...bank];
    const out: string[] = [];
    while (out.length < count && pool.length > 0) {
      const index = Math.floor(rng() * pool.length);
      const [item] = pool.splice(index, 1);
      if (item) out.push(item);
    }
    return out;
  };
  return {
    yi: take(YI, 4),
    ji: take(JI, 4),
    color: COLORS[Math.floor(rng() * COLORS.length)] ?? "暖橙",
    lucky: 1 + Math.floor(rng() * 9),
    pillar: ganzhiDay(day),
  };
}

const ARCHETYPE: Record<number, { name: string; text: string; deep: string }> = {
  1: {
    name: "开创",
    text: "生命灵数 1。你习惯自己点灯。灯点着之后，记得也给旁边的人留一点光，而不是只照自己的路线图。",
    deep: "个人年如果也偏 1，今年的题目是开始，不是证明。开始可以很小：一个习惯，一段谈话，一次不再道歉的拒绝。",
  },
  2: {
    name: "配合",
    text: "生命灵数 2。你听得见缝隙里的情绪。配合不是消失。今天的练习是：在答应之前停半拍。",
    deep: "关系是你的课堂，不是你的岗位。个人年偏 2 的时候，少当和事佬，多说一句你自己的偏好。",
  },
  3: {
    name: "表达",
    text: "生命灵数 3。话、笑话、颜色都是你的工具。工具用来连接，不用来填满所有沉默。",
    deep: "表达欲上来时，先写给自己三行。个人年偏 3，适合把搁置的兴趣拿出来玩，不急着变现成身份。",
  },
  4: {
    name: "搭建",
    text: "生命灵数 4。你信任看得见的结构。结构是帮忙的脚手架，不是惩罚自己的笼子。",
    deep: "个人年偏 4，适合修缮：作息、抽屉、一个拖着的承诺。修一处就够写进今年。",
  },
  5: {
    name: "变化",
    text: "生命灵数 5。新鲜感是燃料，也是漏风口。变化之前留一个不变的锚，比如晚饭或睡觉。",
    deep: "个人年偏 5，路会分叉。分叉不是失败，是你终于可以不走那条只因为熟悉的路。",
  },
  6: {
    name: "照料",
    text: "生命灵数 6。你容易把屋子和人一起揽过来。照料包含你自己的那一副碗筷。",
    deep: "个人年偏 6，家里和责任会变响。响的时候列出哪些是你的，哪些是你顺手捡的。",
  },
  7: {
    name: "内观",
    text: "生命灵数 7。你需要不被打扰的时间，像别人需要饭。内观不是疏远，是充电。",
    deep: "个人年偏 7，适合读、走、发呆。结论可以晚到。晚到的结论通常比较不像口号。",
  },
  8: {
    name: "分量",
    text: "生命灵数 8。你对资源和边界敏感。分量感用在把生活配平，不用在把自己称成机器。",
    deep: "个人年偏 8，议题是交换：时间、钱、注意力怎么流动。流动要留出口，不能只进不出。",
  },
  9: {
    name: "收束",
    text: "生命灵数 9。你看得见表象后面的人情。收束一段旧故事，是为了手能空出来。",
    deep: "个人年偏 9，适合告别和总结。总结写短。短的告别比较干净。",
  },
  11: {
    name: "感应",
    text: "生命灵数 11。感觉来得又快又亮。亮的时候接地：吃饭、走路、跟一个具体的人说话。",
    deep: "11 不比 2 更高贵，只是更响。个人年如果撞上主数，把灵感落成一件做完的小事，才算接住。",
  },
  22: {
    name: "大搭建",
    text: "生命灵数 22。你能想象很大的桌子，也得从一颗螺丝开始。大不是今天的义务。",
    deep: "22 的压力常常来自自己。个人年里选一个看得见结尾的工程，比同时铺三条梦更仁慈。",
  },
  33: {
    name: "照拂",
    text: "生命灵数 33。你想让很多人好过一点。照拂的配额里，你的名字排在第一行。",
    deep: "33 很容易透支善意。个人年的功课是拒绝得温柔而清楚，这样剩下的好才是真的。",
  },
};

export function reduceNumber(value: number, masters = true): number {
  let current = value;
  while (current > 9 && !(masters && (current === 11 || current === 22 || current === 33))) {
    current = String(current)
      .split("")
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
  return current;
}

export function lifePath(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const sum = iso.replaceAll("-", "").split("").reduce((total, digit) => total + Number(digit), 0);
  return reduceNumber(sum);
}

export function personalYear(iso: string, day: string): number | null {
  if (!lifePath(iso)) return null;
  const month = Number(iso.slice(5, 7));
  const date = Number(iso.slice(8, 10));
  const year = Number(day.slice(0, 4));
  const sum = String(month + date + year)
    .split("")
    .reduce((total, digit) => total + Number(digit), 0);
  return reduceNumber(sum, false);
}

export function archetype(n: number): { name: string; text: string; deep: string } {
  return ARCHETYPE[n] ?? ARCHETYPE[reduceNumber(n, false)] ?? ARCHETYPE[9]!;
}

export function elementScore(a: Sign, b: Sign): number {
  if (a.name === b.name) return 86;
  const pair = `${a.element}${b.element}`;
  const warm = pair === "火火" || pair === "风风" || pair === "火风" || pair === "风火" || pair === "土土" || pair === "水水" || pair === "土水" || pair === "水土";
  const tense = pair === "火水" || pair === "水火" || pair === "风土" || pair === "土风";
  if (warm) return 78;
  if (tense) return 62;
  return 70;
}

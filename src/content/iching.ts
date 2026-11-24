const TRI_BITS = {
  乾: "111",
  兑: "110",
  离: "101",
  震: "100",
  巽: "011",
  坎: "010",
  艮: "001",
  坤: "000",
} as const;

type Tri = keyof typeof TRI_BITS;

const TRI_VOICE: Record<Tri, string> = {
  乾: "硬朗，也容易顶着不放",
  坤: "能接住，适合慢慢铺开",
  震: "突然一响，心会先跳一下",
  巽: "风从缝里进来，适合商量",
  坎: "反复，像同一首歌又播了一遍",
  离: "亮，也容易把自己看热",
  艮: "停在这里并不丢人",
  兑: "想说的话可以轻一点",
};

/** King Wen order: name, lower trigram, upper trigram, public-domain judgment. */
const ORDER: ReadonlyArray<readonly [string, Tri, Tri, string]> = [
  ["乾", "乾", "乾", "元亨利贞。"],
  ["坤", "坤", "坤", "元亨，利牝马之贞。"],
  ["屯", "震", "坎", "元亨利贞。勿用有攸往，利建侯。"],
  ["蒙", "坎", "艮", "亨。匪我求童蒙，童蒙求我。"],
  ["需", "乾", "坎", "有孚，光亨，贞吉。利涉大川。"],
  ["讼", "坎", "乾", "有孚窒惕，中吉，终凶。"],
  ["师", "坎", "坤", "贞，丈人吉，无咎。"],
  ["比", "坤", "坎", "吉。原筮，元永贞，无咎。"],
  ["小畜", "乾", "巽", "亨。密云不雨，自我西郊。"],
  ["履", "兑", "乾", "履虎尾，不咥人，亨。"],
  ["泰", "乾", "坤", "小往大来，吉亨。"],
  ["否", "坤", "乾", "否之匪人。不利君子贞。大往小来。"],
  ["同人", "离", "乾", "同人于野，亨。"],
  ["大有", "乾", "离", "元亨。"],
  ["谦", "艮", "坤", "亨，君子有终。"],
  ["豫", "坤", "震", "利建侯行师。"],
  ["随", "震", "兑", "元亨利贞，无咎。"],
  ["蛊", "巽", "艮", "元亨，利涉大川。"],
  ["临", "兑", "坤", "元亨利贞。至于八月有凶。"],
  ["观", "坤", "巽", "盥而不荐，有孚颙若。"],
  ["噬嗑", "震", "离", "亨。利用狱。"],
  ["贲", "离", "艮", "亨。小利有攸往。"],
  ["剥", "坤", "艮", "不利有攸往。"],
  ["复", "震", "坤", "亨。出入无疾，朋来无咎。"],
  ["无妄", "震", "乾", "元亨利贞。其匪正有眚。"],
  ["大畜", "乾", "艮", "利贞。不家食吉。利涉大川。"],
  ["颐", "震", "艮", "贞吉。观颐，自求口实。"],
  ["大过", "巽", "兑", "栋桡。利有攸往，亨。"],
  ["坎", "坎", "坎", "习坎，有孚，维心亨，行有尚。"],
  ["离", "离", "离", "利贞，亨。畜牝牛，吉。"],
  ["咸", "艮", "兑", "亨，利贞。取女吉。"],
  ["恒", "巽", "震", "亨，无咎，利贞。利有攸往。"],
  ["遁", "艮", "乾", "亨，小利贞。"],
  ["大壮", "乾", "震", "利贞。"],
  ["晋", "坤", "离", "康侯用锡马蕃庶，昼日三接。"],
  ["明夷", "离", "坤", "利艰贞。"],
  ["家人", "离", "巽", "利女贞。"],
  ["睽", "兑", "离", "小事吉。"],
  ["蹇", "艮", "坎", "利西南，不利东北。"],
  ["解", "坎", "震", "利西南。"],
  ["损", "兑", "艮", "有孚，元吉，无咎，可贞。"],
  ["益", "震", "巽", "利有攸往，利涉大川。"],
  ["夬", "乾", "兑", "扬于王庭。"],
  ["姤", "巽", "乾", "女壮，勿用取女。"],
  ["萃", "坤", "兑", "亨。王假有庙。利见大人，亨，利贞。"],
  ["升", "巽", "坤", "元亨。用见大人，勿恤。南征吉。"],
  ["困", "坎", "兑", "亨，贞，大人吉，无咎。"],
  ["井", "巽", "坎", "改邑不改井。"],
  ["革", "离", "兑", "己日乃孚。元亨利贞。"],
  ["鼎", "巽", "离", "元吉，亨。"],
  ["震", "震", "震", "亨。震来虩虩，笑言哑哑。"],
  ["艮", "艮", "艮", "艮其背，不获其身。行其庭，不见其人。"],
  ["渐", "艮", "巽", "女归吉，利贞。"],
  ["归妹", "兑", "震", "征凶，无攸利。"],
  ["丰", "离", "震", "亨。王假之，勿忧，宜日中。"],
  ["旅", "艮", "离", "小亨，旅贞吉。"],
  ["巽", "巽", "巽", "小亨。利有攸往，利见大人。"],
  ["兑", "兑", "兑", "亨，利贞。"],
  ["涣", "坎", "巽", "亨。王假有庙。利涉大川。"],
  ["节", "兑", "坎", "亨。苦节不可贞。"],
  ["中孚", "兑", "巽", "豚鱼吉。利涉大川，利贞。"],
  ["小过", "艮", "震", "亨，利贞。可小事，不可大事。"],
  ["既济", "离", "坎", "亨，小利贞。初吉终乱。"],
  ["未济", "坎", "离", "亨。小狐汔济，濡其尾。"],
];

export interface Hexagram {
  n: number;
  name: string;
  lower: Tri;
  upper: Tri;
  bits: string;
  judge: string;
  vernacular: string;
}

export const HEXAGRAMS: readonly Hexagram[] = ORDER.map(([name, lower, upper, judge], index) => {
  const bits = `${TRI_BITS[lower]}${TRI_BITS[upper]}`;
  const vernacular = `${name}卦。下卦${lower}，${TRI_VOICE[lower]}；上卦${upper}，${TRI_VOICE[upper]}。古辞作典故：「${judge}」今晚用得上的只有这一句：先安顿心情，再看事情要不要动。卦不派任务。`;
  return { n: index + 1, name, lower, upper, bits, judge, vernacular };
});

const BY_BITS = new Map(HEXAGRAMS.map((hex) => [hex.bits, hex]));

export interface CastLine {
  value: 6 | 7 | 8 | 9;
  yang: boolean;
  changing: boolean;
}

export function parseLines(values: readonly number[]): CastLine[] | null {
  if (values.length !== 6) return null;
  const lines: CastLine[] = [];
  for (const value of values) {
    if (value !== 6 && value !== 7 && value !== 8 && value !== 9) return null;
    lines.push({ value, yang: value === 7 || value === 9, changing: value === 6 || value === 9 });
  }
  return lines;
}

export function hexFromLines(lines: readonly CastLine[]): { primary: Hexagram; changed: Hexagram | null; moving: number[] } {
  const primaryBits = lines.map((line) => (line.yang ? "1" : "0")).join("");
  const changedBits = lines.map((line) => (line.changing ? (line.yang ? "0" : "1") : line.yang ? "1" : "0")).join("");
  const primary = BY_BITS.get(primaryBits) ?? HEXAGRAMS[0]!;
  const moving = lines.map((line, index) => (line.changing ? index + 1 : 0)).filter((n) => n > 0);
  const changed = moving.length > 0 ? (BY_BITS.get(changedBits) ?? null) : null;
  return { primary, changed, moving };
}

export function lineNote(position: number, changingToYin: boolean): string {
  const place = ["最初那一下", "靠近地面的第二下", "中间偏下", "中间偏上", "快到顶", "最外面的一声"][position - 1] ?? "这一下";
  return changingToYin
    ? `${place}在松。松不是垮，是你不必再硬撑这一个点。`
    : `${place}在动。动得很轻就好，不必六爻一起吵。`;
}

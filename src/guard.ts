const BANNED: Array<[RegExp, string]> = [
  [/建议\s*(买入|卖出|做多|做空|加仓|减仓|清仓|梭哈|开多|开空)/, "instruction"],
  [/目标价|入场点|止损位|止盈位/, "target"],
  [/胜率/, "winrate"],
  [/必涨|必跌|稳赚|包赚|包赢/, "promise"],
  [/保证\s*(盈利|赚钱|上涨|下跌)/, "guarantee"],
  [/改运|转运|开光/, "luck"],
  [/\$\s*\d/, "price"],
];

/** Returns a reason code when copy gives an instruction, a target, a win rate, or a luck claim. */
export function violation(text: string): string | null {
  for (const [pattern, reason] of BANNED) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

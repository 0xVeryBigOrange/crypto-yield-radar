import type { Config } from "./config.js";
import { violation } from "./guard.js";
import { log } from "./log.js";
import type { Reading } from "./reading.js";

export interface Llm {
  polish(reading: Reading): Promise<Reading | null>;
}

const SYSTEM = [
  "你是「橙签」的中文文案，给加密货币和美股、期权交易员写娱乐向塔罗。",
  "语气刻薄、好笑，像交易员互损，但要好懂。",
  "只写心情和节奏。",
  "禁止价格、点位、涨跌预测、买卖指令、仓位、胜率、杠杆、以及任何改运、转运、开光的说法。",
  "如果原问题在打听买卖或价格，就嘲讽这个问题，然后把话扭回心情。",
  "保持原有的标题结构、心情标签和分数，不要发明数字。",
  "只输出 JSON，不要 markdown。字段：summary, quote, sections。sections 是字符串数组，条数与输入相同。",
].join("");

export function createLlm(config: Config): Llm {
  const key = config.upstreamApiKey;
  if (!key) throw new Error("UPSTREAM_API_KEY is not set");
  return {
    async polish(reading) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      };
      if (config.upstreamProvider === "openrouter") {
        headers["HTTP-Referer"] = config.appPublicUrl;
        headers["X-Title"] = config.appName;
      }
      const response = await fetch(`${config.upstreamBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.llmModel,
          temperature: 0.7,
          max_tokens: 700,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(skeleton(reading)) },
          ],
        }),
        signal: AbortSignal.timeout(config.llmTimeoutMs),
      });
      if (!response.ok) {
        log("warn", "llm polish failed", { status: response.status });
        return null;
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") return null;
      return applyPolish(reading, content);
    },
  };
}

export function applyPolish(base: Reading, content: string): Reading | null {
  const parsed = extractJson(content);
  if (!parsed) return null;
  const summary = cleanText(parsed.summary, 320);
  const quote = cleanText(parsed.quote, 90);
  if (!summary || !quote) return null;
  const incoming = Array.isArray(parsed.sections) ? parsed.sections : [];
  const sections = base.sections.map((section, index) => {
    const raw = incoming[index];
    const text =
      cleanText(raw, 360) ??
      cleanText(raw && typeof raw === "object" ? (raw as { text?: unknown }).text : null, 360);
    return { heading: section.heading, text: text ?? section.text };
  });
  const blob = [summary, quote, ...sections.map((section) => section.text)].join("\n");
  if (violation(blob)) return null;
  if (/0x[a-fA-F0-9]{40}/.test(blob)) return null;
  return { ...base, summary, quote, sections };
}

function skeleton(reading: Reading): unknown {
  return {
    title: reading.title,
    mood: reading.mood,
    summary: reading.summary,
    quote: reading.quote,
    sections: reading.sections.map((section) => section.text),
  };
}

function extractJson(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? content;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > max) return null;
  return text;
}

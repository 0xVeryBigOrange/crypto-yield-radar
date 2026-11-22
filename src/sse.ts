export interface RawUsage {
  promptTokens: number;
  completionTokens: number;
  cost: string | null;
}

export interface SseEvent {
  data: string;
  raw: string;
}

export function consumeSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of parts) {
    if (!block.trim()) continue;
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    events.push({ data, raw: block });
  }
  return { events, rest };
}

export function rewriteChatChunk(
  data: string,
  keepUsage: boolean,
): { forward: string | null; usage: RawUsage | null } {
  if (data.trim() === "[DONE]") return { forward: "[DONE]", usage: null };
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return { forward: data, usage: null };
  }
  if (!json || typeof json !== "object") return { forward: data, usage: null };
  const record = json as Record<string, unknown>;
  const usage = extractUsage(record);
  if (record.usage && typeof record.usage === "object") {
    const usageRecord = record.usage as Record<string, unknown>;
    delete usageRecord.cost;
    delete usageRecord.cost_details;
    delete usageRecord.is_byok;
  }
  if (!keepUsage) {
    if (usage && isUsageOnly(record)) return { forward: null, usage };
    if ("usage" in record) delete record.usage;
  }
  return { forward: JSON.stringify(record), usage };
}

export function extractUsage(json: Record<string, unknown>): RawUsage | null {
  const usage = json.usage;
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const prompt = asCount(record.prompt_tokens);
  const completion = asCount(record.completion_tokens);
  const cost = record.cost == null || record.cost === "" ? null : String(record.cost);
  if (prompt == null && completion == null && cost == null) return null;
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    cost,
  };
}

function isUsageOnly(json: Record<string, unknown>): boolean {
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return true;
  return choices.every((choice) => !choiceHasPayload(choice));
}

function choiceHasPayload(choice: unknown): boolean {
  if (!choice || typeof choice !== "object") return false;
  const record = choice as Record<string, unknown>;
  if (record.finish_reason) return true;
  if (typeof record.text === "string" && record.text.length > 0) return true;
  const delta = record.delta;
  if (delta && typeof delta === "object" && Object.keys(delta as object).length > 0) return true;
  const message = record.message;
  if (message && typeof message === "object") {
    const body = message as Record<string, unknown>;
    if (body.content || body.tool_calls || body.role) return true;
  }
  return false;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

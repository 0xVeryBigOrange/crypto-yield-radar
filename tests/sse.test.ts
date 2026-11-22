import { describe, expect, test } from "vitest";
import { consumeSse, rewriteChatChunk } from "../src/sse.js";

describe("sse", () => {
  test("reassembles events split across packets", () => {
    const first = consumeSse('data: {"a":');
    expect(first.events).toEqual([]);
    const second = consumeSse(`${first.rest}1}\n\ndata: [DONE]\n\n`);
    expect(second.events.map((event) => event.data)).toEqual(['{"a":1}', "[DONE]"]);
    expect(second.rest).toBe("");
  });

  test("strips a usage-only tail unless the client asked for usage", () => {
    const usageOnly = '{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"cost":0.2}}';
    const hidden = rewriteChatChunk(usageOnly, false);
    expect(hidden.forward).toBeNull();
    expect(hidden.usage).toMatchObject({ promptTokens: 3, completionTokens: 4, cost: "0.2" });

    const kept = rewriteChatChunk(usageOnly, true);
    expect(kept.forward).toContain('"prompt_tokens":3');
    expect(kept.forward).not.toContain("cost");
    expect(kept.usage?.cost).toBe("0.2");
  });

  test("keeps content and finish_reason while removing wholesale cost", () => {
    const content = '{"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}],"usage":{"prompt_tokens":1,"completion_tokens":1,"cost":"0.01"}}';
    const rewritten = rewriteChatChunk(content, false);
    expect(rewritten.forward).toContain("hi");
    expect(rewritten.forward).not.toContain("usage");
    expect(rewritten.usage?.cost).toBe("0.01");

    const stop = rewriteChatChunk('{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}', false);
    expect(stop.forward).toContain("stop");
    expect(rewriteChatChunk("[DONE]", false).forward).toBe("[DONE]");
  });
});

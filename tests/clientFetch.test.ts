import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

function loadUi(fetchImpl: typeof fetch) {
  const store = new Map<string, string>();
  const context: Record<string, unknown> = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    fetch: fetchImpl,
    location: { search: "", origin: "http://127.0.0.1", href: "http://127.0.0.1/" },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
    document: {
      body: { dataset: {} },
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    navigator: {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../public/ui.js", import.meta.url), "utf8"), context, { filename: "ui.js" });
  return context as {
    friendlyError: (error: { message?: string; status?: number; name?: string }) => string;
    api: (path: string, body?: unknown, options?: { attempts?: number; timeoutMs?: number }) => Promise<unknown>;
  };
}

describe("homepage fetch errors", () => {
  test("turns a browser network failure into Chinese", () => {
    const ui = loadUi(async () => new Response(null, { status: 401 }));
    expect(ui.friendlyError(Object.assign(new TypeError("Failed to fetch"), {}))).toBe(
      "牌桌暂时没有接上。免费实例可能在醒，请再试一次。",
    );
    expect(ui.friendlyError({ name: "TimeoutError", message: "The operation was aborted due to timeout" })).toBe(
      "牌桌暂时没有接上。免费实例可能在醒，请再试一次。",
    );
    expect(ui.friendlyError({ status: 402, message: "余额不够。" })).toBe("余额不够。");
  });

  test("retries a cold-start reset and then returns the home payload", async () => {
    let calls = 0;
    const ui = loadUi(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ error: { message: "请先登录。" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      calls += 1;
      if (calls < 3) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ signs: [{ sign: "白羊", score: 70 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const home = (await ui.api("/api/home", undefined, { timeoutMs: 1000 })) as { signs: Array<{ sign: string }> };
    expect(calls).toBe(3);
    expect(home.signs[0]?.sign).toBe("白羊");
  });

  test("does not retry a paid POST that the server already answered", async () => {
    let calls = 0;
    const ui = loadUi(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ error: { message: "请先登录。" } }), { status: 401 });
      }
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "余额不够。" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(ui.api("/api/omen/unlock", { edition: "sg", tier: "full", ack: true })).rejects.toMatchObject({
      message: "余额不够。",
      status: 402,
    });
    expect(calls).toBe(1);
  });
});

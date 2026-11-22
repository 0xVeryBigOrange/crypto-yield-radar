/**
 * OpenAI-compatible upstreams. OpenRouter is the default.
 * Add another provider by branching in createProvider() and, if it speaks
 * the same chat/completions schema, reuse createOpenAICompatibleProvider().
 */

export interface CatalogModel {
  id: string;
  name: string;
  promptPerToken: string;
  completionPerToken: string;
  request: string;
  contextLength: number | null;
}

export interface UpstreamProvider {
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<CatalogModel[]>;
  chat(body: unknown, signal?: AbortSignal): Promise<Response>;
}

export function createProvider(opts: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  appPublicUrl: string;
  appName: string;
}): UpstreamProvider {
  if (opts.provider === "openrouter") {
    return createOpenAICompatibleProvider({
      id: "openrouter",
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      headers: {
        "HTTP-Referer": opts.appPublicUrl,
        "X-Title": opts.appName,
      },
    });
  }
  if (opts.provider === "openai-compatible") {
    return createOpenAICompatibleProvider({
      id: "openai-compatible",
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });
  }
  throw new Error(`Unknown upstream provider: ${opts.provider}`);
}

export function createOpenAICompatibleProvider(opts: {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
}): UpstreamProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${opts.apiKey}`,
    ...opts.headers,
  };
  return {
    id: opts.id,
    async listModels(signal) {
      const response = await fetch(`${base}/models`, { headers, signal });
      if (!response.ok) throw new Error(`models HTTP ${response.status}`);
      const json = (await response.json()) as { data?: unknown };
      const rows = Array.isArray(json.data) ? json.data : [];
      const models: CatalogModel[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : "";
        const pricing = record.pricing;
        if (!id || id.length > 200 || !pricing || typeof pricing !== "object") continue;
        const price = pricing as Record<string, unknown>;
        if (price.prompt == null || price.completion == null) continue;
        const context = record.context_length;
        models.push({
          id,
          name: typeof record.name === "string" ? record.name.slice(0, 200) : id,
          promptPerToken: String(price.prompt),
          completionPerToken: String(price.completion),
          request: price.request == null ? "0" : String(price.request),
          contextLength: typeof context === "number" && Number.isFinite(context) ? Math.floor(context) : null,
        });
      }
      return models;
    },
    chat(body, signal) {
      return fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    },
  };
}

import type { Express, Request, Response } from "express";
import { principalFromApiKey } from "../accounts.js";
import { completionCap, costFromTokens, estimatePromptTokens, quote, type TokenCounts } from "../billing.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { asyncRoute, sendOpenAIError } from "../http.js";
import { releaseReservation, reserveFunds, settleReservation, consumeRateLimit } from "../ledger.js";
import { log } from "../log.js";
import { formatFull, formatUsd, parseDecimal } from "../money.js";
import { getPricedModel, listPrices, refreshPricesIfStale, type PricedModel } from "../pricing.js";
import { consumeSse, extractUsage, rewriteChatChunk, type RawUsage } from "../sse.js";
import type { UpstreamProvider } from "../upstream.js";

export function registerV1Routes(
  app: Express,
  deps: { config: Config; pool: Db; provider: UpstreamProvider | null },
): void {
  app.get("/v1/models", asyncRoute(async (req, res) => {
    const principal = await requireKey(req, res, deps.pool);
    if (!principal) return;
    const models = await listPrices(deps.pool, deps.config.markup);
    res.json({
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: Date.parse(model.updatedAt) / 1000 || 0,
        owned_by: deps.provider?.id ?? "upstream",
        context_length: model.contextLength,
        pricing: {
          prompt_per_million_usd: model.promptPerMillion,
          completion_per_million_usd: model.completionPerMillion,
          currency: "USD",
          markup: formatFull(deps.config.markup),
        },
      })),
    });
  }));

  app.post("/v1/chat/completions", asyncRoute(async (req, res) => {
    const principal = await requireKey(req, res, deps.pool);
    if (!principal) return;
    const limit = await consumeRateLimit(deps.pool, principal.keyId, principal.rpm);
    res.setHeader("X-RateLimit-Limit", String(limit.limit));
    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    res.setHeader("X-RateLimit-Reset", String(limit.resetEpoch));
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, limit.resetEpoch - Math.floor(Date.now() / 1000))));
      sendOpenAIError(res, 429, "Rate limit exceeded for this API key.", "rate_limit_error", "rate_limit_exceeded");
      return;
    }
    if (!deps.provider) {
      sendOpenAIError(res, 503, "Upstream is not configured.", "server_error", "upstream_unconfigured");
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendOpenAIError(res, 400, "Request body must be a JSON object.", "invalid_request_error", "invalid_body");
      return;
    }
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record.messages) || record.messages.length === 0) {
      sendOpenAIError(res, 400, "messages is required.", "invalid_request_error", "invalid_body");
      return;
    }
    const modelId = typeof record.model === "string" ? record.model.trim() : "";
    if (!modelId || modelId.length > 200) {
      sendOpenAIError(res, 400, "model is required.", "invalid_request_error", "model_not_found");
      return;
    }
    let priced = await getPricedModel(deps.pool, modelId);
    if (!priced) {
      await refreshPricesIfStale(deps.pool, deps.provider, 10 * 60 * 1000);
      priced = await getPricedModel(deps.pool, modelId);
    }
    if (!priced) {
      sendOpenAIError(
        res,
        404,
        "That model is not in the price table. Choose an id from /v1/models.",
        "invalid_request_error",
        "model_not_found",
      );
      return;
    }

    const stream = record.stream === true;
    const estimate = quote({
      promptTokens: estimatePromptTokens(record.messages),
      completionTokens: completionCap(record, deps.config.defaultMaxCompletion),
      price: priced,
      markup: deps.config.markup,
      buffer: deps.config.reserveBuffer,
    });
    const reserved = await reserveFunds(deps.pool, principal.userId, principal.keyId, estimate.hold);
    if (!reserved.ok) {
      sendOpenAIError(
        res,
        402,
        `Insufficient balance. This request holds ${formatUsd(estimate.hold)} USD; available balance is ${reserved.available} USD.`,
        "insufficient_quota",
        "insufficient_balance",
      );
      return;
    }

    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deps.config.upstreamTimeoutMs);
    const onClose = () => {
      if (!res.writableEnded) ac.abort();
    };
    res.on("close", onClose);
    let reservationId: string | null = reserved.id;
    let forwarded = false;
    let usage: RawUsage | null = null;
    const keepUsage = isRecord(record.stream_options) && record.stream_options.include_usage === true;
    try {
      const outbound: Record<string, unknown> = { ...record, model: modelId };
      if (stream) {
        const previous = isRecord(record.stream_options) ? record.stream_options : {};
        outbound.stream_options = { ...previous, include_usage: true };
      }
      const upstream = await deps.provider.chat(outbound, ac.signal);
      if (!upstream.ok) {
        await releaseReservation(deps.pool, {
          reservationId,
          userId: principal.userId,
          apiKeyId: principal.keyId,
          model: modelId,
          markup: deps.config.markup,
        });
        reservationId = null;
        if (upstream.status === 401 || upstream.status === 403) {
          sendOpenAIError(res, 502, "Upstream authorization failed.", "server_error", "upstream_auth");
          return;
        }
        const text = await upstream.text();
        res.status(upstream.status).json(safeErrorBody(text));
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!stream || !contentType.includes("text/event-stream") || !upstream.body) {
        const text = await upstream.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        if (!json || typeof json !== "object") {
          await releaseReservation(deps.pool, {
            reservationId,
            userId: principal.userId,
            apiKeyId: principal.keyId,
            model: modelId,
            markup: deps.config.markup,
          });
          reservationId = null;
          sendOpenAIError(res, 502, "Upstream returned an unreadable response.", "server_error", "upstream_error");
          return;
        }
        usage = extractUsage(json as Record<string, unknown>);
        await finishSettlement(deps, {
          reservationId,
          principal,
          model: modelId,
          price: priced,
          usage,
          delivered: true,
        });
        reservationId = null;
        stripWholesale(json);
        res.status(200).json(json);
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      const emit = async (buffer: string, final: boolean) => {
        const parsed = consumeSse(final && buffer.trim() ? (buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`) : buffer);
        rest = final ? "" : parsed.rest;
        for (const event of parsed.events) {
          if (!event.data) {
            forwarded = true;
            await writeBlock(res, `${event.raw}\n\n`);
            continue;
          }
          const rewritten = rewriteChatChunk(event.data, keepUsage);
          if (rewritten.usage) usage = rewritten.usage;
          if (rewritten.forward != null) {
            forwarded = true;
            await writeBlock(res, `data: ${rewritten.forward}\n\n`);
          }
        }
      };
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        rest += decoder.decode(step.value, { stream: true });
        await emit(rest, false);
      }
      rest += decoder.decode();
      if (rest.trim()) await emit(rest, true);
      await finishSettlement(deps, {
        reservationId,
        principal,
        model: modelId,
        price: priced,
        usage,
        delivered: forwarded,
      });
      reservationId = null;
      if (!res.writableEnded) res.end();
      log("info", "chat completed", { model: modelId, ms: Date.now() - started, stream: true });
    } catch (err) {
      if (reservationId) {
        try {
          await finishSettlement(deps, {
            reservationId,
            principal,
            model: modelId,
            price: priced,
            usage,
            delivered: forwarded,
          });
        } catch (settleErr) {
          log("error", "settlement failed", { name: settleErr instanceof Error ? settleErr.name : "error" });
        }
        reservationId = null;
      }
      if (!res.headersSent) {
        const aborted = err instanceof Error && err.name === "AbortError";
        sendOpenAIError(
          res,
          aborted ? 504 : 502,
          aborted ? "Upstream request timed out." : "Upstream request failed.",
          "server_error",
          aborted ? "upstream_timeout" : "upstream_error",
        );
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      clearTimeout(timer);
      res.off("close", onClose);
    }
  }));
}

async function requireKey(req: Request, res: Response, pool: Db) {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) {
    sendOpenAIError(res, 401, "Missing API key.", "invalid_request_error", "invalid_api_key");
    return null;
  }
  const principal = await principalFromApiKey(pool, match[1]);
  if (!principal) {
    sendOpenAIError(res, 401, "Invalid API key.", "invalid_request_error", "invalid_api_key");
    return null;
  }
  return principal;
}

async function finishSettlement(
  deps: { config: Config; pool: Db },
  opts: {
    reservationId: string;
    principal: { userId: string; keyId: string };
    model: string;
    price: PricedModel;
    usage: RawUsage | null;
    delivered: boolean;
  },
): Promise<void> {
  const base = {
    reservationId: opts.reservationId,
    userId: opts.principal.userId,
    apiKeyId: opts.principal.keyId,
    model: opts.model,
    markup: deps.config.markup,
  };
  if (!opts.usage && !opts.delivered) {
    await releaseReservation(deps.pool, base);
    return;
  }
  const tokens: TokenCounts = {
    promptTokens: opts.usage?.promptTokens ?? 0,
    completionTokens: opts.usage?.completionTokens ?? 0,
  };
  let upstreamCost: bigint | null = null;
  if (opts.usage) {
    if (opts.usage.cost != null) {
      try {
        const parsed = parseDecimal(opts.usage.cost);
        upstreamCost = parsed < 0n ? 0n : parsed;
      } catch {
        upstreamCost = null;
      }
    }
    upstreamCost ??= costFromTokens(tokens, opts.price);
  }
  await settleReservation(deps.pool, {
    ...base,
    upstreamCost,
    tokens,
    settlement: opts.usage ? "usage" : "estimated",
  });
}

function stripWholesale(json: unknown): void {
  if (!json || typeof json !== "object") return;
  const usage = (json as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return;
  const record = usage as Record<string, unknown>;
  delete record.cost;
  delete record.cost_details;
  delete record.is_byok;
}

function safeErrorBody(text: string): unknown {
  try {
    const json = JSON.parse(text) as unknown;
    scrub(json);
    return json;
  } catch {
    return { error: { message: "Upstream request failed.", type: "upstream_error", code: "upstream_error" } };
  }
}

function scrub(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) scrub(item);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (/prompt|messages|input|authorization|api[-_]?key|secret/i.test(key)) delete record[key];
    else scrub(record[key]);
  }
}

async function writeBlock(res: Response, chunk: string): Promise<void> {
  if (res.writableEnded) return;
  if (!res.write(chunk)) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      res.once("drain", done);
      res.once("close", done);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

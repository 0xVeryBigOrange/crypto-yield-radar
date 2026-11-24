import type { Express } from "express";
import { safeEqual } from "../auth.js";
import type { AppDeps } from "../app.js";
import { runDailyJob } from "../dailyJob.js";
import { asyncRoute, sendApiError } from "../http.js";

/** Protected hook for the GitHub Actions schedule. A free Render instance wakes on this request. */
export function registerInternalRoutes(app: Express, deps: AppDeps): void {
  app.post(
    "/internal/daily",
    asyncRoute(async (req, res) => {
      const secret = deps.config.cronSecret;
      if (!secret) {
        sendApiError(res, 503, "cron_disabled", "Set CRON_SECRET to enable the daily endpoint.");
        return;
      }
      const provided = req.header("x-cron-secret") ?? "";
      if (!provided || !safeEqual(provided, secret)) {
        sendApiError(res, 401, "unauthorized", "Cron secret rejected.");
        return;
      }
      const result = await runDailyJob(deps.pool, deps.llm);
      res.json({ ok: true, ...result });
    }),
  );
}

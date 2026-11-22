import type { NextFunction, Request, Response } from "express";

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  const parts = [`km_session=${token}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  res.status(status).json({ error: { code, message, ...extra } });
}

export function sendOpenAIError(res: Response, status: number, message: string, type: string, code: string): void {
  res.status(status).json({ error: { message, type, code } });
}

const hits = new Map<string, { n: number; reset: number }>();

export function allowAttempt(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > 10_000) hits.clear();
  const row = hits.get(key);
  if (!row || row.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  row.n += 1;
  return row.n <= max;
}

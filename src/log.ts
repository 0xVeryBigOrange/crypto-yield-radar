const SENSITIVE = /authorization|password|secret|api[-_]?key|token|cookie|prompt|messages|body|upstream/i;

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.test(key)) continue;
    safe[key] = value;
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...safe });
  if (level === "error") console.error(line);
  else console.log(line);
}

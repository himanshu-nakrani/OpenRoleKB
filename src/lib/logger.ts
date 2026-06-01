type Level = "debug" | "info" | "warn" | "error";

type Fields = {
  evt: string;
  level?: Level;
  ownerKey?: string | null;
  route?: string;
  dur_ms?: number;
  [k: string]: unknown;
};

const PII_KEYS = new Set(["email", "rawQuery", "password", "authorization", "cookie"]);

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "<redacted>" : scrub(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, fields: Fields) {
  const scrubbed = scrub(fields) as Record<string, unknown>;
  const payload = {
    t: new Date().toISOString(),
    level,
    ...scrubbed,
  };
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (f: Fields) => emit("debug", f),
  info: (f: Fields) => emit("info", f),
  warn: (f: Fields) => emit("warn", f),
  error: (f: Fields) => emit("error", f),
};

export type { Fields, Level };

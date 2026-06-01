import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { ExaResult } from "@/types/job";

const SNAPSHOT_DIR = resolve(__dirname, "exa-snapshots");

function keyFor(query: string): string {
  return createHash("sha256").update(query.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function snapshotPath(query: string): string {
  return resolve(SNAPSHOT_DIR, `${keyFor(query)}.json`);
}

export function hasSnapshot(query: string): boolean {
  return existsSync(snapshotPath(query));
}

export function loadSnapshot(query: string): ExaResult[] {
  const path = snapshotPath(query);
  if (!existsSync(path)) {
    throw new Error(
      `No Exa snapshot for "${query}" at ${path}. Run: npm run eval:snapshot -- "${query}"`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeSnapshot(query: string, results: ExaResult[]): void {
  const path = snapshotPath(query);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(results, null, 2));
}

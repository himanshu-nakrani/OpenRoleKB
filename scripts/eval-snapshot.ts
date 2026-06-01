#!/usr/bin/env -S npx tsx
/**
 * Fetches a fresh Exa response for every golden query and writes it to
 * test/eval/exa-snapshots/. Run when:
 *   - You add a new golden case.
 *   - You intentionally want to refresh against the live ATS landscape.
 *   - You change Exa parameters in src/lib/exa.ts and need to re-baseline.
 *
 * Usage: npx tsx scripts/eval-snapshot.ts [--only <case>]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseQuery } from "@/lib/parse-query";
import { searchJobs } from "@/lib/exa";
import { writeSnapshot } from "../test/eval/snapshot-cache";
import type { GoldenCase } from "../test/eval/types";

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1] : undefined;

async function main() {
  const goldens: GoldenCase[] = JSON.parse(
    readFileSync(resolve(__dirname, "../test/eval/golden-queries.json"), "utf-8"),
  );
  const targets = only ? goldens.filter((g) => g.name === only) : goldens;
  console.error(`Refreshing ${targets.length} Exa snapshots...`);
  for (const c of targets) {
    process.stderr.write(`  ${c.name} ... `);
    const parsed = await parseQuery(c.query);
    const results = await searchJobs(c.query, parsed.filters);
    writeSnapshot(c.query, results);
    console.error(`${results.length} results`);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

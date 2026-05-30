import "dotenv/config";
import { searchJobs } from "../src/lib/exa.js";
import type { Filters } from "../src/types/job.js";

async function main() {
  const query = process.argv[2] || "senior react engineer remote";
  const filters: Filters = { role: query };

  console.log(`Searching Exa for: "${query}"\n`);
  const results = await searchJobs(query, filters);

  console.log(`Found ${results.length} results:\n`);
  for (const r of results.slice(0, 10)) {
    console.log(`${r.title}`);
    console.log(`  URL: ${r.url}`);
    console.log(`  Source: ${new URL(r.url).hostname}`);
    console.log(`  Text: ${r.text?.substring(0, 150)}...`);
    if (r.highlights?.length) {
      console.log(`  Highlights: ${r.highlights[0]}`);
    }
    console.log();
  }
}

main().catch(console.error);

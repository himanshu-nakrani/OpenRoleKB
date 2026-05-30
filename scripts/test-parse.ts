import "dotenv/config";
import { parseQuery } from "../src/lib/parse-query.js";

const queries = [
  "senior React role, remote-friendly, EU timezone, no crypto",
  "junior frontend role in Berlin, no agencies, posted this month",
  "staff python engineer with ML experience, San Francisco",
  "product manager remote SaaS B2B",
  "devops engineer AWS Kubernetes remote",
  "backend developer Go Rust fintech New York",
  "data scientist healthcare remote US $150k",
  "mobile developer React Native iOS Android remote",
  "QA engineer manual testing remote",
  "engineering manager team lead remote EU no gaming",
];

async function main() {
  console.log("Query".padEnd(70) + "Role".padEnd(25) + "Seniority".padEnd(12) + "Remote".padEnd(8) + "Location");
  console.log("=".repeat(140));

  for (const query of queries) {
    const { filters } = await parseQuery(query);
    const role = (filters.role || "").substring(0, 23);
    const seniority = (filters.seniority || "").substring(0, 10);
    const remote = filters.remote ? "yes" : "";
    const location = (filters.location || "").substring(0, 20);
    console.log(
      query.substring(0, 68).padEnd(70) +
        role.padEnd(25) +
        seniority.padEnd(12) +
        remote.padEnd(8) +
        location,
    );
  }
}

main().catch(console.error);

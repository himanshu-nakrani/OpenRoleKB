export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold text-ink mb-6">About OpenRoleKB</h1>
      <div className="prose prose-sm text-ink-soft">
        <p className="mb-4">
          OpenRoleKB is an open-source, natural-language job search engine. We believe that finding the right role shouldn&apos;t require deciphering keyword-stuffed job descriptions or wrestling with rigid filter dropdowns.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">How It Works</h2>
        <ul className="list-disc pl-5 mb-4 space-y-2">
          <li><strong>Neural Search:</strong> We use Exa to search across real ATS sources based on the semantic meaning of your query, not just keyword matching.</li>
          <li><strong>AI Reranking:</strong> Results are reranked by a lightweight LLM to score how well each role actually matches your specific ask (e.g., &quot;no crypto&quot;, &quot;EU timezone&quot;).</li>
          <li><strong>Privacy-First:</strong> We don&apos;t track you. Anonymous sessions are supported, and we never sell your data.</li>
        </ul>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">Why Open Source?</h2>
        <p className="mb-4">
          The job search market is opaque. By keeping our ranking logic and data sources transparent, we empower users to trust the results and developers to contribute to a better alternative.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">Get Involved</h2>
        <p>
          OpenRoleKB is built in the open. Check out our <a href="https://github.com/himanshu-nakrani/OpenRoleKB" className="text-accent hover:underline">GitHub repository</a> to report bugs, suggest features, or contribute code.
        </p>
      </div>
    </div>
  );
}

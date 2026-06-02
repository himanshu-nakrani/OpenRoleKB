export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold text-ink mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-ink-soft">
        <p className="mb-4">
          OpenRoleKB is built with privacy in mind. We do not track you, sell your data, or use non-essential cookies.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">What We Collect</h2>
        <ul className="list-disc pl-5 mb-4 space-y-2">
          <li><strong>Search Queries:</strong> We store your search queries only if you explicitly choose to &quot;Save this search&quot;.</li>
          <li><strong>Anonymous Identifiers:</strong> If you are not signed in, we generate a random anonymous ID stored in your browser&apos;s localStorage to associate your saved searches with your session.</li>
          <li><strong>Telemetry:</strong> We collect anonymized performance metrics (e.g., search latency, cache hit rates) to improve the service. This data is not linked to your identity.</li>
        </ul>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">What We Do NOT Collect</h2>
        <ul className="list-disc pl-5 mb-4 space-y-2">
          <li>No personal identifiable information (PII) unless you create an account.</li>
          <li>No tracking cookies or third-party analytics that profile your browsing behavior.</li>
          <li>No resume parsing or storage of your employment history.</li>
        </ul>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">Data Retention</h2>
        <p className="mb-4">
          Saved searches are retained until you explicitly delete them. Anonymous session data is periodically purged after 90 days of inactivity.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">Contact</h2>
        <p>
          For any privacy-related questions, please contact us at <a href="mailto:privacy@openrolekb.example.com" className="text-accent hover:underline">privacy@openrolekb.example.com</a>.
        </p>
      </div>
    </div>
  );
}

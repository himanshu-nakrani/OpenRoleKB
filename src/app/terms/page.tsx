export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold text-ink mb-6">Terms of Service</h1>
      <div className="prose prose-sm text-ink-soft">
        <p className="mb-4">
          By using OpenRoleKB, you agree to these terms. If you do not agree, please do not use the service.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">1. Acceptable Use</h2>
        <p className="mb-4">
          You agree to use OpenRoleKB for lawful purposes only. You may not use automated scripts, bots, or scrapers to query the API or extract data at scale without explicit permission.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">2. Service Availability</h2>
        <p className="mb-4">
          We strive to keep the service available 24/7, but we do not guarantee uninterrupted access. We reserve the right to modify or discontinue features at any time.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">3. Limitation of Liability</h2>
        <p className="mb-4">
          OpenRoleKB provides job search results as a convenience. We do not guarantee the accuracy, completeness, or availability of any job posting. We are not liable for any decisions made based on the information provided.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">4. Changes to Terms</h2>
        <p className="mb-4">
          We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the new terms.
        </p>
        <h2 className="text-xl font-semibold text-ink mt-6 mb-3">Contact</h2>
        <p>
          For questions about these terms, contact us at <a href="mailto:legal@openrolekb.example.com" className="text-accent hover:underline">legal@openrolekb.example.com</a>.
        </p>
      </div>
    </div>
  );
}

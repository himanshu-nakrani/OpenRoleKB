import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { FreshnessPill } from "@/components/FreshnessPill";
import { StillListedBadge } from "@/components/StillListedBadge";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: { id },
  });

  if (!job) notFound();

  const domain = (() => {
    try {
      return new URL(job.url).hostname.replace("www.", "");
    } catch {
      return null;
    }
  })();

  const salary = job.salaryMinUsd || job.salaryMaxUsd
    ? `${job.salaryMinUsd ? `$${Math.round(job.salaryMinUsd / 1000)}k` : ""}${
        job.salaryMinUsd && job.salaryMaxUsd ? "–" : ""
      }${job.salaryMaxUsd ? `$${Math.round(job.salaryMaxUsd / 1000)}k` : ""}`
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-small text-ink-soft hover:text-ink transition-colors duration-120"
        >
          <ChevronLeft size={14} strokeWidth={2} aria-hidden /> Back to search
        </Link>
        <h1 className="text-h1 font-medium mt-2 font-display-opsz-h1">{job.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-small text-muted mt-2">
          {job.company && <span>{job.company}</span>}
          {job.location && <span>{job.location}</span>}
          {job.publishedAt && <FreshnessPill publishedDate={job.publishedAt.toISOString()} />}
          {job.lastSeenAt && <StillListedBadge lastSeenAt={job.lastSeenAt.toISOString()} publishedDate={job.publishedAt?.toISOString()} />}
          {salary && <span className="text-accent">{salary}</span>}
        </div>
      </div>

      <div className="mb-6">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-dark text-accent-text text-small font-medium hover:brightness-110 active:brightness-90 active:scale-[0.98] transition-all duration-120"
        >
          Apply on {domain || "site"} <ExternalLink size={14} strokeWidth={2} aria-hidden />
        </a>
      </div>

      {job.description && (
        <div className="prose prose-sm max-w-none text-ink">
          <h3 className="text-h2 font-medium mt-0">Description</h3>
          <div className="whitespace-pre-wrap text-small leading-relaxed">{job.description}</div>
        </div>
      )}

      <div className="mt-8 text-micro text-muted">
        First seen {job.firstSeenAt.toLocaleDateString()} · Source: {job.source}
      </div>
    </div>
  );
}

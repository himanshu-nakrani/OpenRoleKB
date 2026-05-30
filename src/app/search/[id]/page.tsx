import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ScoreChip } from "@/components/ScoreChip";

export default async function SearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cached = await prisma.searchCache.findUnique({
    where: { id },
  });

  if (!cached) notFound();

  const jobs = await prisma.job.findMany({
    where: { id: { in: cached.resultJobIds } },
  });

  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const scores = cached.rerankScores as Record<string, { score: number; fit: string }>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1 text-small text-ink-soft hover:text-ink transition-colors">
          <ChevronLeft size={14} strokeWidth={2} aria-hidden /> Back to search
        </Link>
        <h2
          className="text-h2 font-medium mt-2"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {cached.rawQuery}
        </h2>
        <p className="text-small text-ink-soft mt-0.5">
          {jobs.length} results · {new Date(cached.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="space-y-3">
        {cached.resultJobIds
          .filter((jobId) => {
            const s = scores[jobId];
            return !s || s.score >= 0.4;
          })
          .map((jobId) => {
            const job = jobMap.get(jobId);
            if (!job) return null;
            const score = scores[jobId];

            return (
              <a
                key={job.id}
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-5 rounded-lg border border-border bg-surface hover:bg-surface-2/60 transition-colors duration-180"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-ink truncate">{job.title}</h3>
                    {job.company && (
                      <p className="text-small text-ink-soft mt-0.5">{job.company}</p>
                    )}
                  </div>
                  {score && <ScoreChip score={score.score} />}
                </div>
                {score?.fit && (
                  <p className="text-small italic text-success mt-1.5">{score.fit}</p>
                )}
                {job.description && (
                  <p className="text-small text-ink-soft mt-2 line-clamp-3 leading-relaxed">
                    {job.description.substring(0, 300)}
                  </p>
                )}
              </a>
            );
          })}
      </div>
    </div>
  );
}

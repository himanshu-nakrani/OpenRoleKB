"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface SavedJob {
  id: string;
  jobId: string;
  kind: string;
  createdAt: string;
  job?: {
    title: string;
    url: string;
    company?: string;
  };
}

export default function SavedJobsPage() {
  const { data: session } = useSession();
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const res = await fetch("/api/me/saved-jobs", { credentials: "include" });
      if (res.ok) {
        setJobs(await res.json());
      }
      setLoading(false);
    })();
  }, [session]);

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <p>Sign in to see your saved jobs.</p>
        <Link href="/" className="text-accent">Go back</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-h1 font-medium mb-6">Saved jobs</h1>
      {loading ? (
        <p>Loading...</p>
      ) : jobs.length === 0 ? (
        <p className="text-ink-soft">No saved jobs yet. Use the save action on results.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <a
              key={j.id}
              href={j.job?.url || "#"}
              target="_blank"
              className="block p-4 border border-border rounded-lg hover:bg-surface-2"
            >
              <div className="font-medium">{j.job?.title || "Job"}</div>
              <div className="text-small text-muted">{j.job?.company}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

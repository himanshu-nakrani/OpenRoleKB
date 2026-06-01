import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

function FeedbackTable({ events }: { events: Array<{
  id: string;
  kind: string;
  jobId: string;
  rawQuery: string;
  rerankScore: number | null;
  fit: string | null;
  comment: string | null;
  createdAt: Date;
}> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-border text-left text-ink-soft">
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">Kind</th>
            <th className="py-2 pr-4 font-medium">Query</th>
            <th className="py-2 pr-4 font-medium">Score</th>
            <th className="py-2 pr-4 font-medium">Fit</th>
            <th className="py-2 font-medium">Comment</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border/50">
              <td className="py-2 pr-4 text-ink-soft whitespace-nowrap">
                {e.createdAt.toLocaleDateString()}
              </td>
              <td className="py-2 pr-4">{e.kind}</td>
              <td className="py-2 pr-4 max-w-[200px] truncate">{e.rawQuery}</td>
              <td className="py-2 pr-4">{e.rerankScore?.toFixed(2) ?? "—"}</td>
              <td className="py-2 pr-4 max-w-[150px] truncate">{e.fit ?? "—"}</td>
              <td className="py-2 max-w-[200px] truncate">{e.comment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminFeedback() {
  const session = await auth();
  const allowed = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!session?.user?.email || session.user.email.toLowerCase() !== allowed) {
    redirect("/");
  }

  const events = await prisma.feedbackEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-h1 font-display mb-6">Feedback</h1>
      {events.length === 0 ? (
        <p className="text-ink-soft">No feedback events yet.</p>
      ) : (
        <FeedbackTable events={events} />
      )}
    </main>
  );
}

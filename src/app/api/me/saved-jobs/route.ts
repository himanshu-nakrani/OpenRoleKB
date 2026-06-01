import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerKey } from "@/lib/owner";

export async function GET(req: NextRequest) {
  const ownerKey = await getOwnerKey(req);
  if (!ownerKey) return Response.json([]);

  const interactions = await prisma.jobInteraction.findMany({
    where: { ownerKey, kind: "saved" },
    include: { job: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Intentional: saved jobs are NOT filtered by HiddenCompany. User explicitly
  // saved this; their later hide of the company should not retroactively erase it.
  return Response.json(interactions);
}

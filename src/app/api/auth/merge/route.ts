import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 });
  }
  const { anonId } = await req.json();
  if (typeof anonId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(anonId)) {
    return new Response("invalid anonId", { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: session.user.id }, data: { anonId } }),
    prisma.savedSearch.updateMany({ where: { anonId }, data: { userId: session.user.id, anonId: null } }),
    prisma.jobInteraction.updateMany({ where: { ownerKey: anonId }, data: { ownerKey: session.user.id } }),
    prisma.hiddenCompany.updateMany({ where: { ownerKey: anonId }, data: { ownerKey: session.user.id } }),
  ]);
  return Response.json({ ok: true });
}

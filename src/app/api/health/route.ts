import { prisma } from "@/lib/prisma";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    // DB down
  }

  const redis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

  return Response.json({ status: "ok", db, redis });
}

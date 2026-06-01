import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = {
  savedSearch: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/owner", () => ({
  getOwnerIdentity: vi.fn().mockImplementation(async (req: Request) => {
    const anonId = req.headers.get("x-anon-id");
    if (anonId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(anonId)) {
      return { kind: "anon", key: anonId };
    }
    return null;
  }),
  getOwnerKey: vi.fn().mockImplementation(async (req: Request) => {
    const anonId = req.headers.get("x-anon-id");
    if (anonId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(anonId)) return anonId;
    return null;
  }),
  normalizeOwnerKey: vi.fn().mockImplementation((raw: string) => raw.trim().toLowerCase()),
}));

const { GET, POST, DELETE } = await import("@/app/api/saved/route");

describe("GET /api/saved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when x-anon-id header is missing", async () => {
    const req = new NextRequest("http://localhost/api/saved");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns saved searches for valid anonId", async () => {
    const searches = [
      { id: "s1", anonId: "550e8400-e29b-41d4-a716-446655440000", rawQuery: "react remote", filters: { role: "react" }, createdAt: new Date() },
    ];
    mockPrisma.savedSearch.findMany.mockResolvedValue(searches);

    const req = new NextRequest("http://localhost/api/saved", {
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].rawQuery).toBe("react remote");
  });

  it("returns empty array when no saved searches exist", async () => {
    mockPrisma.savedSearch.findMany.mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/saved", {
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("POST /api/saved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when x-anon-id header is missing", async () => {
    const req = new NextRequest("http://localhost/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawQuery: "react remote", filters: { role: "react" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when rawQuery is missing", async () => {
    const req = new NextRequest("http://localhost/api/saved", {
      method: "POST",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000", "Content-Type": "application/json" },
      body: JSON.stringify({ filters: { role: "react" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a saved search and returns 200", async () => {
    const createdAt = new Date();
    const saved = {
      id: "new-id",
      anonId: "550e8400-e29b-41d4-a716-446655440000",
      rawQuery: "react remote",
      filters: { role: "react" },
      createdAt,
    };
    mockPrisma.savedSearch.upsert.mockResolvedValue(saved);

    const req = new NextRequest("http://localhost/api/saved", {
      method: "POST",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000", "Content-Type": "application/json" },
      body: JSON.stringify({ rawQuery: "react remote", filters: { role: "react" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-id");
    expect(body.rawQuery).toBe("react remote");
    expect(body.filters).toEqual({ role: "react" });
    // createdAt is serialized as ISO string in JSON
    expect(new Date(body.createdAt).toISOString()).toBe(createdAt.toISOString());
  });
});

describe("DELETE /api/saved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when x-anon-id header is missing", async () => {
    const req = new NextRequest("http://localhost/api/saved?id=some-id", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when id param is missing", async () => {
    const req = new NextRequest("http://localhost/api/saved", {
      method: "DELETE",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when saved search does not exist", async () => {
    mockPrisma.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
    const req = new NextRequest("http://localhost/api/saved?id=nonexistent", {
      method: "DELETE",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 when saved search belongs to different user", async () => {
    mockPrisma.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
    const req = new NextRequest("http://localhost/api/saved?id=s1", {
      method: "DELETE",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it("deletes saved search and returns 200", async () => {
    mockPrisma.savedSearch.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest("http://localhost/api/saved?id=s1", {
      method: "DELETE",
      headers: { "x-anon-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });
});

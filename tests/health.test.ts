import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock the pool so these tests run with no database. CI should be able to
// run the unit suite without docker; the migration test (week 2) is the
// one that will need a real Postgres.
vi.mock("../src/db/pool.ts", () => ({
  pool: { query: vi.fn(), on: vi.fn(), connect: vi.fn(), end: vi.fn() },
  dbHealthy: vi.fn(async () => true),
  closePool: vi.fn(async () => {}),
}));

const { createApp } = await import("../src/app.ts");
const { dbHealthy } = await import("../src/db/pool.ts");

describe("health endpoints", () => {
  it("GET /healthz reports ok without touching the database", async () => {
    const res = await request(createApp()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(dbHealthy).not.toHaveBeenCalled();
  });

  it("GET /readyz reports ready when the database answers", async () => {
    vi.mocked(dbHealthy).mockResolvedValueOnce(true);
    const res = await request(createApp()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", db: true });
  });

  it("GET /readyz returns 503 when the database is unreachable", async () => {
    vi.mocked(dbHealthy).mockResolvedValueOnce(false);
    const res = await request(createApp()).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(false);
  });

  it("unknown routes return a json 404", async () => {
    const res = await request(createApp()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });
});

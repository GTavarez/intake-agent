import express, { type Express, type Request, type Response } from "express";
import { dbHealthy } from "./db/pool.ts";

/**
 * The Express app is built here and started in index.ts.
 *
 * Keeping them separate is what lets tests import the app and make real
 * HTTP requests against it without binding a port or starting a server
 * they then have to remember to close.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.disable("x-powered-by");

  /**
   * Liveness: is the process up? Deliberately does not touch the
   * database, so a sick database never causes an orchestrator to kill
   * an otherwise healthy container.
   */
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  /**
   * Readiness: can this instance actually serve traffic? This one does
   * check the database, and returns 503 when it cannot reach it.
   */
  app.get("/readyz", async (_req: Request, res: Response) => {
    const db = await dbHealthy();
    res.status(db ? 200 : 503).json({ status: db ? "ready" : "degraded", db });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { closePool } from "./db/pool.ts";

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`[http] listening on :${config.PORT} (${config.NODE_ENV})`);
});

/**
 * Graceful shutdown.
 *
 * Without this, a deploy kills the process mid-request and the client
 * sees a connection reset. ECS, Kubernetes and Docker all send SIGTERM
 * first and wait — use the wait.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`[http] ${signal} received, draining`);
  server.close(async () => {
    await closePool();
    console.log("[http] closed cleanly");
    process.exit(0);
  });

  // If connections refuse to drain, stop waiting after 10s.
  setTimeout(() => {
    console.error("[http] drain timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

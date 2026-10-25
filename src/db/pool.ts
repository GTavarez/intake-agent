import pg from "pg";
import { config } from "../config.ts";

/**
 * One connection pool for the whole process.
 *
 * `pg` opens a real TCP connection per client, and opening one per
 * request is how a service falls over under load. The pool keeps a
 * small set alive and hands them out.
 */
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // An idle client erroring is not fatal to the process, but it should
  // never pass silently — a stream of these means the database is sick.
  console.error("[db] idle client error", err);
});

/** Returns true when the database answers, false otherwise. Never throws. */
export async function dbHealthy(): Promise<boolean> {
  try {
    const result = await pool.query<{ ok: number }>("select 1 as ok");
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

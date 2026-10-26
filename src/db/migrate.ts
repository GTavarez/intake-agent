import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool, closePool } from "./pool.ts";

/**
 * A deliberately small migration runner.
 *
 * You could reach for a library. Writing ~60 lines instead means you can
 * explain in an interview exactly how your migrations apply, which is a
 * question people actually ask. Rules it enforces:
 *   - each file runs at most once, recorded in schema_migrations
 *   - files run in filename order, so name them 001_, 002_, ...
 *   - each file runs inside a transaction: it applies fully or not at all
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedFilenames(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    "select filename from schema_migrations",
  );
  return new Set(rows.map((r) => r.filename));
}

export async function migrate(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = await appliedFilenames();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename) values ($1)",
        [file],
      );
      await client.query("commit");
      ran.push(file);
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`[migrate] FAILED ${file} — rolled back`);
      throw err;
    } finally {
      client.release();
    }
  }

  if (ran.length === 0) console.log("[migrate] nothing to do");
  return ran;
}

// Only run when invoked directly (`npm run db:migrate`), not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  migrate()
    .then(closePool)
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}

import "dotenv/config";
import { z } from "zod";

/**
 * Environment is parsed once, at startup, through a schema.
 *
 * Why bother: the alternative is `process.env.DATABASE_URL!` scattered
 * through the codebase, which types as `string` but is `undefined` at
 * 2am in a container that was deployed without the variable set. Here
 * the process refuses to start and tells you exactly which key is
 * missing — a failure you can read, instead of one you have to debug.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://intake:intake@localhost:5433/intake"),
  /** Optional until Phase 2 (week 3), when the LLM client arrives. */
  LLM_API_KEY: z.string().min(1).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment:\n${issues}`);
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
export type Config = typeof config;

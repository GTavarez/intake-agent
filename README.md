# intake-agent

A bilingual (English/Spanish) patient intake agent. A person describes
their problem in their own words, in either language, and the system
turns that into a validated structured intake, decides what should happen
next, and replies in the language they wrote in.

Built by someone who has taken intakes in person, in both languages,
under time pressure.

## Why this exists

Patient-facing conversational systems are mostly built by engineers who
have never taken a history, and mostly evaluated in English only. Both
show. This project is an attempt to do it the other way around: start
from what an intake actually has to capture, and treat Spanish as a
first-class case with its own measured accuracy rather than an
afterthought that nobody scores.

## Status

Week 1 of 16. The skeleton runs, CI is green, and the domain model
lands next.

- [x] TypeScript service, strict mode, graceful shutdown
- [x] Postgres via Docker, hand-rolled transactional migration runner
- [x] Vitest suite, CI on every push (format, typecheck, test)
- [ ] Domain model and a bilingual seed set
- [ ] LLM client, structured extraction with schema validation
- [ ] Evals: a labeled bilingual set, rubric scoring, regression gates in CI
- [ ] Four-phase agent loop: analysis, decisioning, composition, execution
- [ ] Redis + BullMQ background workers
- [ ] Deployed on AWS with Terraform

## Running it

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres on host port 5433
npm run db:migrate
npm run dev          # http://localhost:3000
```

Check it:

```bash
curl localhost:3000/healthz   # liveness  — never touches the database
curl localhost:3000/readyz    # readiness — 503 if Postgres is unreachable
```

| Command                     | What it does             |
| --------------------------- | ------------------------ |
| `npm run dev`               | Watch-mode server        |
| `npm test`                  | Vitest once              |
| `npm run test:watch`        | Vitest in watch mode     |
| `npm run typecheck`         | `tsc --noEmit`           |
| `npm run format`            | Prettier write           |
| `npm run db:up` / `db:down` | Start / stop Postgres    |
| `npm run db:migrate`        | Apply pending migrations |

## Design notes

**`app.ts` is separate from `index.ts`** so tests can make real HTTP
requests against the app without binding a port.

**Liveness and readiness are different endpoints.** `/healthz` answers
"is this process alive" and deliberately does not touch the database, so
a sick database can't cause an orchestrator to kill a healthy container.
`/readyz` answers "can this instance serve traffic" and returns 503 when
Postgres is unreachable.

**Environment is parsed once through a Zod schema** in `src/config.ts`.
A missing variable stops the process at startup with the key name,
instead of surfacing as `undefined` somewhere downstream.

**Migrations are hand-rolled, about 60 lines.** Each file runs once,
in filename order, inside a transaction. A library would do this too —
writing it means being able to explain exactly how migrations apply,
which comes up in interviews.

**Port 5433, not 5432**, so this never collides with a Postgres already
running on the machine.

## Licence

MIT.

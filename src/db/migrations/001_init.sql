-- 001_init.sql
--
-- Week 1 ships one table so that the migration runner itself is proven.
-- The real domain model (Conversation, Message, Patient, ExtractedIntake,
-- Action) is week 2's work, and it is deliberately yours to design --
-- you know what an intake actually has to capture.

create table if not exists conversation (
  id            uuid primary key default gen_random_uuid(),
  -- BCP-47 tag: 'en-US', 'es-US', 'es-DO'. Stored, not guessed, because
  -- which Spanish someone speaks changes the register you answer in.
  language      text        not null default 'en-US',
  status        text        not null default 'open'
                            check (status in ('open', 'escalated', 'closed')),
  started_at    timestamptz not null default now(),
  closed_at     timestamptz
);

create index if not exists conversation_status_idx
  on conversation (status, started_at desc);

-- 002_domain.sql
--
-- The intake domain.
--
-- Central design decision: a clinical field is never just a value. It
-- carries a STATUS saying how we came to know it, because "patient
-- denies allergies" and "nobody has asked yet" are different facts and
-- collapsing them into a null is how a record becomes untrustworthy.
--
-- The status also drives behaviour. 'not_asked' is not a gap in the
-- data, it is a job for the agent: the next question comes from a query
-- over these rows, not from a prompt improvising.

-- ---------------------------------------------------------------- --
-- Patient
-- ---------------------------------------------------------------- --

create table if not exists patient (
  id            uuid primary key default gen_random_uuid(),
  -- Deliberately thin. Every column here is PHI, so the rule for this
  -- table is: add a column only when a feature needs it, never "while
  -- we're here". Week 15 audits this table first.
  display_name  text,
  birth_date    date,
  preferred_language text not null default 'en-US',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- --
-- Conversation and messages
-- ---------------------------------------------------------------- --

-- 001 created `conversation` with language/status/timestamps.
-- Extend it rather than recreate: patients arrive before they are known,
-- so patient_id is nullable and gets filled in once identity is settled.
alter table conversation
  add column if not exists patient_id uuid references patient (id),
  add column if not exists channel text not null default 'sms'
    check (channel in ('sms', 'voice', 'web'));

comment on column conversation.language is
  'Default/working language for the conversation (BCP-47). Per-message '
  'detection lives on message.language_detected: people code-switch '
  'mid-sentence and the reply should follow them, not a column set at turn one.';

create table if not exists message (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversation (id) on delete cascade,
  role              text not null check (role in ('patient', 'agent', 'staff')),
  body              text not null,
  -- Nullable on purpose: detection can fail or be skipped, and a wrong
  -- guess is worse than an honest unknown.
  language_detected text,
  created_at        timestamptz not null default now()
);

create index if not exists message_conversation_idx
  on message (conversation_id, created_at);

-- ---------------------------------------------------------------- --
-- What an intake is made of
-- ---------------------------------------------------------------- --

-- A catalog rather than hard-coded columns. Three payoffs:
--   1. "what should I ask next" is `where status = 'not_asked'
--      order by priority` -- a query, not a prompt.
--   2. Adding a field is a row, not a migration plus a prompt rewrite.
--   3. Week 7 scores accuracy per field by joining on this key.
create table if not exists intake_field_def (
  key          text primary key,
  label_en     text not null,
  label_es     text not null,
  -- 'text' | 'enum' | 'number' | 'boolean' | 'datetime'
  kind         text not null default 'text',
  required     boolean not null default false,
  -- Lower is asked sooner. Chief complaint before insurance, always.
  priority     integer not null default 100,
  -- True where a missing answer is a safety problem, not an
  -- inconvenience. Drives escalation, not just question order.
  safety_critical boolean not null default false
);

-- ---------------------------------------------------------------- --
-- Versioned extraction
-- ---------------------------------------------------------------- --

-- One snapshot per patient turn. Lets week 7 replay exactly what the
-- model knew at turn two and score it, which is most of what an eval
-- harness does. Updating one row in place would destroy that.
create table if not exists intake_snapshot (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation (id) on delete cascade,
  -- The message that triggered this extraction.
  message_id      uuid references message (id) on delete set null,
  version         integer not null,
  -- Which prompt produced it. Week 5 versions prompts; without this you
  -- cannot attribute an accuracy change to a prompt change.
  prompt_version  text,
  created_at      timestamptz not null default now(),
  unique (conversation_id, version)
);

create table if not exists intake_field (
  snapshot_id  uuid not null references intake_snapshot (id) on delete cascade,
  field_key    text not null references intake_field_def (key),

  -- The heart of the model.
  --   not_asked   -- no one has raised it. A job, not a gap.
  --   answered    -- the patient gave a value. It is in `value`.
  --   denied      -- asked, and the patient said no. A finding. value is null.
  --   unknown     -- asked, and the patient genuinely does not know.
  --   refused     -- asked, and the patient declined to say.
  status       text not null default 'not_asked'
               check (status in
                 ('not_asked', 'answered', 'denied', 'unknown', 'refused')),

  value        text,
  -- Model confidence 0..1 where the extractor reports one. Null for
  -- anything a human entered -- humans do not come with a confidence score.
  confidence   numeric(4, 3) check (confidence between 0 and 1),
  -- Which message this came from, so a reviewer can see the sentence.
  source_message_id uuid references message (id) on delete set null,

  primary key (snapshot_id, field_key),

  -- A value without an answer, or an answer without a value, is a bug.
  -- Let the database say so rather than discovering it in a report.
  constraint value_matches_status check (
    (status = 'answered' and value is not null)
    or (status <> 'answered' and value is null)
  )
);

create index if not exists intake_field_status_idx
  on intake_field (snapshot_id, status);

-- ---------------------------------------------------------------- --
-- Actions
-- ---------------------------------------------------------------- --

-- What the agent DID, not what it said. Week 10 makes these idempotent;
-- the key is here from the start so retries never double-book.
create table if not exists action (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation (id) on delete cascade,
  snapshot_id     uuid references intake_snapshot (id) on delete set null,
  kind            text not null
                  check (kind in ('ask_followup', 'flag_for_nurse',
                                  'record_intake', 'schedule_followup', 'close')),
  status          text not null default 'pending'
                  check (status in ('pending', 'succeeded', 'failed', 'skipped')),
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists action_conversation_idx
  on action (conversation_id, created_at desc);

-- ---------------------------------------------------------------- --
-- Seed the catalog
-- ---------------------------------------------------------------- --
-- Ordered the way a history is actually taken: what is wrong, how long,
-- how bad, then the things that change what you do about it.

insert into intake_field_def
  (key, label_en, label_es, kind, required, priority, safety_critical)
values
  ('chief_complaint', 'What is bothering you?',
   '¿Qué le molesta?', 'text', true, 10, false),
  ('onset', 'When did it start?',
   '¿Cuándo empezó?', 'text', true, 20, false),
  ('severity', 'How bad is it, 1 to 10?',
   '¿Qué tan fuerte es, del 1 al 10?', 'number', true, 30, false),
  ('red_flags', 'Chest pain, trouble breathing, weakness on one side, or worst headache of your life?',
   '¿Dolor de pecho, dificultad para respirar, debilidad en un lado, o el peor dolor de cabeza de su vida?',
   'text', true, 35, true),
  ('allergies', 'Any allergies to medicines?',
   '¿Es alérgico a algún medicamento?', 'text', true, 40, true),
  ('medications', 'What medicines do you take?',
   '¿Qué medicamentos toma?', 'text', true, 50, true),
  ('conditions', 'Any ongoing medical conditions?',
   '¿Tiene alguna condición médica?', 'text', false, 60, false),
  ('pregnancy', 'Any chance you are pregnant?',
   '¿Hay alguna posibilidad de que esté embarazada?', 'text', false, 70, true),
  ('preferred_callback', 'Best number and time to reach you?',
   '¿Cuál es el mejor número y hora para llamarle?', 'text', false, 90, false)
on conflict (key) do nothing;

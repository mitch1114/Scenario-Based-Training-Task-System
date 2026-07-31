-- ============================================================
-- Scenario-Based Training Task System — shared backend schema
--
-- One-time setup:
--   1. Create a free project at https://supabase.com
--   2. Open the project's SQL Editor, paste this whole file, Run
--   3. In the app: Settings → Shared Backend → paste your
--      Project URL and anon (public) key → Connect
--      (Both are under Project Settings → API in Supabase.)
--
-- Security note: these policies let anyone holding the anon key
-- read and write training data. Treat the URL + anon key like a
-- shared department password — only give them to trainers.
-- ============================================================

create table if not exists sbt_days (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sbt_votes (
  day_id text not null,
  line_id text not null,
  trainer text not null,
  vote text,                        -- 'pass' | 'fail' | null (withdrawn)
  ts timestamptz not null default now(),
  primary key (day_id, line_id, trainer)
);

create table if not exists sbt_officers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sbt_scenarios (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row level security: shared-key access for the trainer group.
alter table sbt_days enable row level security;
alter table sbt_votes enable row level security;
alter table sbt_officers enable row level security;
alter table sbt_scenarios enable row level security;

drop policy if exists sbt_days_all on sbt_days;
create policy sbt_days_all on sbt_days
  for all using (true) with check (true);

drop policy if exists sbt_votes_all on sbt_votes;
create policy sbt_votes_all on sbt_votes
  for all using (true) with check (true);

drop policy if exists sbt_officers_all on sbt_officers;
create policy sbt_officers_all on sbt_officers
  for all using (true) with check (true);

drop policy if exists sbt_scenarios_all on sbt_scenarios;
create policy sbt_scenarios_all on sbt_scenarios
  for all using (true) with check (true);

-- Realtime: lets every trainer's phone see votes the moment
-- they're cast, and day edits as they happen.
alter publication supabase_realtime add table sbt_days;
alter publication supabase_realtime add table sbt_votes;
alter publication supabase_realtime add table sbt_officers;
alter publication supabase_realtime add table sbt_scenarios;

-- Realtime DELETE events need full row data:
alter table sbt_days replica identity full;
alter table sbt_votes replica identity full;
alter table sbt_officers replica identity full;
alter table sbt_scenarios replica identity full;

-- NicheSpark cloud sync schema (Neon Postgres, queried through the Neon Data API).
-- Applied to Neon project "nichespark" (rapid-rice-51072222), branch main, database neondb.
--
-- Each table stores the extension's local records as JSON (`data`), keyed by the
-- signed-in user and the record's local id. Row-level security limits every
-- request to the caller's own rows (auth.user_id() comes from the Neon Auth JWT).
-- `deleted` rows are tombstones so other devices learn about deletions.
-- `updated_at` is set by the server and drives incremental pulls.

create table if not exists public.projects (
  user_id    text        not null default auth.user_id(),
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.queries (
  user_id    text        not null default auth.user_id(),
  id         text        not null,
  project_id text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.keywords (
  user_id    text        not null default auth.user_id(),
  id         text        not null,
  project_id text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists projects_pull on public.projects (user_id, updated_at, id);
create index if not exists queries_pull  on public.queries  (user_id, updated_at, id);
create index if not exists keywords_pull on public.keywords (user_id, updated_at, id);
create index if not exists queries_project  on public.queries  (user_id, project_id);
create index if not exists keywords_project on public.keywords (user_id, project_id);

-- Server-side timestamp on every write, so clients cannot move the pull cursor.
create or replace function public.ns_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists projects_touch on public.projects;
drop trigger if exists queries_touch on public.queries;
drop trigger if exists keywords_touch on public.keywords;
create trigger projects_touch before insert or update on public.projects for each row execute function public.ns_touch();
create trigger queries_touch  before insert or update on public.queries  for each row execute function public.ns_touch();
create trigger keywords_touch before insert or update on public.keywords for each row execute function public.ns_touch();

-- Deleting a project (tombstone) removes its queries and keywords on the server.
-- Other devices delete them locally when they pull the project tombstone.
create or replace function public.ns_project_deleted() returns trigger
language plpgsql as $$
begin
  if new.deleted then
    delete from public.queries  where user_id = new.user_id and project_id = new.id;
    delete from public.keywords where user_id = new.user_id and project_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists projects_cascade on public.projects;
create trigger projects_cascade after insert or update of deleted on public.projects
  for each row when (new.deleted) execute function public.ns_project_deleted();

alter table public.projects enable row level security;
alter table public.queries  enable row level security;
alter table public.keywords enable row level security;

drop policy if exists own_rows on public.projects;
drop policy if exists own_rows on public.queries;
drop policy if exists own_rows on public.keywords;
create policy own_rows on public.projects for all to authenticated
  using (user_id = auth.user_id()) with check (user_id = auth.user_id());
create policy own_rows on public.queries for all to authenticated
  using (user_id = auth.user_id()) with check (user_id = auth.user_id());
create policy own_rows on public.keywords for all to authenticated
  using (user_id = auth.user_id()) with check (user_id = auth.user_id());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects, public.queries, public.keywords to authenticated;
revoke all on public.projects, public.queries, public.keywords from anonymous;

-- NicheSpark admin panel: activity tracking and admin-only functions.
-- Applied after db/schema.sql. Admins are Neon Auth users with role = 'admin'
-- (set by SQL: update neon_auth."user" set role = 'admin' where email = '...').
-- Every admin_* function checks ns_is_admin() itself and runs as its owner
-- (security definer), so it can read all users' rows despite row-level security.

-- Last activity per account, written by the auth bridge when a session is refreshed.
create table if not exists public.user_activity (
  user_id      text        primary key default auth.user_id(),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  last_country text,
  last_city    text,
  last_client  text
);
alter table public.user_activity enable row level security;
revoke all on public.user_activity from anonymous, authenticated;

create or replace function public.ns_record_activity(p_country text, p_city text, p_client text)
returns void language sql security definer set search_path = public as $$
  insert into public.user_activity (user_id, last_country, last_city, last_client)
  values (auth.user_id(), left(p_country, 80), left(p_city, 120), left(p_client, 40))
  on conflict (user_id) do update
    set last_seen = now(), last_country = excluded.last_country,
        last_city = excluded.last_city, last_client = excluded.last_client
  where auth.user_id() is not null;
$$;

create or replace function public.ns_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from neon_auth."user" u
    where u.id::text = auth.user_id() and u.role = 'admin' and not coalesce(u.banned, false)
  );
$$;

create or replace function public.ns_require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ns_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  return (
    select json_build_object(
      'users', (select count(*) from neon_auth."user"),
      'verified', (select count(*) from neon_auth."user" where "emailVerified"),
      'new_7d', (select count(*) from neon_auth."user" where "createdAt" > now() - interval '7 days'),
      'new_30d', (select count(*) from neon_auth."user" where "createdAt" > now() - interval '30 days'),
      'active_7d', (select count(*) from public.user_activity where last_seen > now() - interval '7 days'),
      'google_users', (select count(distinct "userId") from neon_auth.account where "providerId" = 'google'),
      'email_users', (select count(distinct "userId") from neon_auth.account where "providerId" = 'credential'),
      'projects', (select count(*) from public.projects where not deleted),
      'queries', (select count(*) from public.queries where not deleted),
      'keywords', (select count(*) from public.keywords where not deleted),
      'countries', (
        select coalesce(json_agg(c order by c.users desc), '[]'::json)
        from (select coalesce(last_country, 'Unknown') as country, count(*) as users
              from public.user_activity group by 1) c
      ),
      'signups_by_day', (
        select coalesce(json_agg(d order by d.day), '[]'::json)
        from (select to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as day, count(*) as users
              from neon_auth."user" where "createdAt" > now() - interval '30 days' group by 1) d
      )
    )
  );
end $$;

create or replace function public.admin_users()
returns table (
  id text, email text, name text, role text, banned boolean, email_verified boolean,
  created_at timestamptz, methods text, last_seen timestamptz, last_country text,
  last_city text, projects bigint, queries bigint, keywords bigint, last_sync timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  return query
    select u.id::text, u.email, u.name, u.role, coalesce(u.banned, false), u."emailVerified",
           u."createdAt",
           (select string_agg(distinct case a."providerId" when 'credential' then 'email' else a."providerId" end, ', ')
              from neon_auth.account a where a."userId" = u.id),
           act.last_seen, act.last_country, act.last_city,
           (select count(*) from public.projects p where p.user_id = u.id::text and not p.deleted),
           (select count(*) from public.queries q where q.user_id = u.id::text and not q.deleted),
           (select count(*) from public.keywords k where k.user_id = u.id::text and not k.deleted),
           (select max(x.updated_at) from (
              select max(updated_at) as updated_at from public.projects where user_id = u.id::text
              union all select max(updated_at) from public.keywords where user_id = u.id::text
            ) x)
    from neon_auth."user" u
    left join public.user_activity act on act.user_id = u.id::text
    order by u."createdAt" desc;
end $$;

create or replace function public.admin_user_projects(p_user text)
returns table (
  id text, name text, seed text, google_domain text, updated_at timestamptz,
  queries bigint, keywords bigint, methods json
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  return query
    select p.id, p.data->>'name', p.data->>'seed', p.data->>'googleDomain', p.updated_at,
           (select count(*) from public.queries q where q.user_id = p_user and q.project_id = p.id and not q.deleted),
           (select count(*) from public.keywords k where k.user_id = p_user and k.project_id = p.id and not k.deleted),
           (select coalesce(json_object_agg(m.method, m.n), '{}'::json) from (
              select q.data->>'method' as method, count(*) as n from public.queries q
              where q.user_id = p_user and q.project_id = p.id and not q.deleted group by 1) m)
    from public.projects p
    where p.user_id = p_user and not p.deleted
    order by p.updated_at desc;
end $$;

drop function if exists public.admin_project_keywords(text, text, int);
create or replace function public.admin_project_keywords(p_user text, p_project text, p_limit int default 500)
returns table (text text, methods jsonb, source_queries jsonb, collection_count int, last_collected bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  return query
    select k.data->>'text', k.data->'methods', k.data->'sourceQueries',
           coalesce((k.data->>'collectionCount')::int, 0), (k.data->>'lastCollectedAt')::bigint
    from public.keywords k
    where k.user_id = p_user and k.project_id = p_project and not k.deleted
    order by k.data->>'text'
    limit least(greatest(p_limit, 1), 5000);
end $$;

-- Deletes one project. The tombstone makes the user's own browsers delete it too.
create or replace function public.admin_delete_project(p_user text, p_project text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  update public.projects set data = null, deleted = true where user_id = p_user and id = p_project;
end $$;

-- Deletes an account and all of its data. Its sessions end, so the extension signs it out.
create or replace function public.admin_delete_user(p_user text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ns_require_admin();
  if p_user = auth.user_id() then
    raise exception 'You cannot delete your own admin account here' using errcode = '22023';
  end if;
  delete from public.keywords where user_id = p_user;
  delete from public.queries where user_id = p_user;
  delete from public.projects where user_id = p_user;
  delete from public.user_activity where user_id = p_user;
  delete from neon_auth."user" where id::text = p_user;
end $$;

revoke all on function public.ns_record_activity(text, text, text), public.ns_is_admin(), public.ns_require_admin(),
  public.admin_overview(), public.admin_users(), public.admin_user_projects(text),
  public.admin_project_keywords(text, text, int), public.admin_delete_project(text, text),
  public.admin_delete_user(text) from public, anonymous;
grant execute on function public.ns_record_activity(text, text, text), public.ns_is_admin(),
  public.admin_overview(), public.admin_users(), public.admin_user_projects(text),
  public.admin_project_keywords(text, text, int), public.admin_delete_project(text, text),
  public.admin_delete_user(text) to authenticated;

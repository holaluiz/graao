-- graao 0001: the player (profile, appearance, settings) and match history.
-- Supabase remembers the player; Colyseus runs the match. Clients only read/write their own profile; match results
-- are written by the match server through record_match (server secret), never by clients.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 20),
  appearance jsonb check (appearance is null or (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) <= 4096)),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per graao player (auth user): display name, character appearance ids, settings.';

alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: insert own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();

-- ------------------------------------------------------------------------------------------------ matches
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null check (char_length(room_code) <= 16),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  -- Player index of the winner; -1 for a draw.
  winner_index smallint not null,
  player_count smallint not null check (player_count between 1 and 64),
  protocol smallint not null,
  server_version text not null check (char_length(server_version) <= 32),
  created_at timestamptz not null default now()
);
comment on table public.matches is 'One finished graao match (written by the match server at RESULTS).';

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_index smallint not null,
  -- The authenticated player (validated by the server from the join token); null for a guest.
  profile_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) <= 20),
  placement smallint not null check (placement >= 1),
  won boolean not null,
  kills smallint not null default 0,
  deaths smallint not null default 0,
  damage_dealt integer not null default 0,
  damage_taken integer not null default 0,
  shots integer not null default 0,
  hits integer not null default 0,
  abilities_cast smallint not null default 0,
  loadout text[] not null default '{}',
  appearance jsonb,
  primary key (match_id, player_index)
);
create index match_players_profile_idx on public.match_players (profile_id, match_id) where profile_id is not null;
comment on table public.match_players is 'Per-player summary of a finished match.';

alter table public.matches enable row level security;
alter table public.match_players enable row level security;

-- Participation check outside RLS (a policy on match_players reading match_players would recurse).
create function private.played_in(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.profile_id = (select auth.uid()));
$$;
revoke all on function private.played_in(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.played_in(uuid) to authenticated;

create policy "matches: read played" on public.matches for select to authenticated using (private.played_in(id));
create policy "match_players: read played" on public.match_players for select to authenticated using (private.played_in(match_id));
-- No insert/update/delete policies: only record_match (security definer, server secret) writes results.

-- ------------------------------------------------------------------------------------------------ server writes
create table private.server_keys (
  id text primary key,
  secret_sha256 bytea not null,
  created_at timestamptz not null default now()
);

/**
 * record_match: the match server's only write. p_secret must hash to a row in private.server_keys.
 * p_match: { room_code, started_at, ended_at, duration_ms, winner_index, protocol, server_version,
 *            players: [{ player_index, profile_id, display_name, placement, won, kills, deaths, damage_dealt,
 *                        damage_taken, shots, hits, abilities_cast, loadout, appearance }] }
 */
create function public.record_match(p_secret text, p_match jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_players jsonb := p_match -> 'players';
begin
  if p_secret is null or not exists (
    select 1 from private.server_keys k where k.secret_sha256 = extensions.digest(p_secret, 'sha256')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(v_players) <> 'array' or jsonb_array_length(v_players) < 1 or jsonb_array_length(v_players) > 64 then
    raise exception 'bad players' using errcode = '22023';
  end if;

  insert into public.matches (room_code, started_at, ended_at, duration_ms, winner_index, player_count, protocol, server_version)
  values (
    p_match ->> 'room_code',
    (p_match ->> 'started_at')::timestamptz,
    (p_match ->> 'ended_at')::timestamptz,
    (p_match ->> 'duration_ms')::integer,
    (p_match ->> 'winner_index')::smallint,
    jsonb_array_length(v_players),
    (p_match ->> 'protocol')::smallint,
    p_match ->> 'server_version'
  )
  returning id into v_id;

  insert into public.match_players (
    match_id, player_index, profile_id, display_name, placement, won, kills, deaths, damage_dealt, damage_taken,
    shots, hits, abilities_cast, loadout, appearance
  )
  select
    v_id,
    (p ->> 'player_index')::smallint,
    -- Ignore ids that are not real users (deleted meanwhile, or malformed).
    (select u.id from auth.users u where u.id::text = p ->> 'profile_id'),
    left(coalesce(p ->> 'display_name', ''), 20),
    (p ->> 'placement')::smallint,
    (p ->> 'won')::boolean,
    coalesce((p ->> 'kills')::smallint, 0),
    coalesce((p ->> 'deaths')::smallint, 0),
    coalesce((p ->> 'damage_dealt')::integer, 0),
    coalesce((p ->> 'damage_taken')::integer, 0),
    coalesce((p ->> 'shots')::integer, 0),
    coalesce((p ->> 'hits')::integer, 0),
    coalesce((p ->> 'abilities_cast')::smallint, 0),
    coalesce(array(select jsonb_array_elements_text(p -> 'loadout')), '{}'),
    case when jsonb_typeof(p -> 'appearance') = 'object' then p -> 'appearance' end
  from jsonb_array_elements(v_players) as p;

  return v_id;
end $$;
revoke all on function public.record_match(text, jsonb) from public;
grant execute on function public.record_match(text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------------------------------------------ history
/** The caller's latest matches, newest first, with every participant's line (for the menu's history). */
create function public.my_matches(p_limit integer default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.ended_at desc), '[]'::jsonb)
  from (
    select m.id, m.room_code, m.ended_at, m.duration_ms, m.winner_index,
      me.player_index as my_index,
      (select jsonb_agg(jsonb_build_object(
          'player_index', mp.player_index, 'display_name', mp.display_name, 'placement', mp.placement, 'won', mp.won,
          'kills', mp.kills, 'deaths', mp.deaths, 'damage_dealt', mp.damage_dealt, 'damage_taken', mp.damage_taken,
          'shots', mp.shots, 'hits', mp.hits, 'abilities_cast', mp.abilities_cast, 'loadout', mp.loadout
        ) order by mp.placement)
        from public.match_players mp where mp.match_id = m.id) as players
    from public.match_players me
    join public.matches m on m.id = me.match_id
    where me.profile_id = (select auth.uid())
    order by m.ended_at desc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) x;
$$;
revoke all on function public.my_matches(integer) from public;
grant execute on function public.my_matches(integer) to authenticated;

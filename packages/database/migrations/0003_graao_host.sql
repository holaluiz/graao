-- graao 0003: Graao Host — community hosting from a player's own PC.
--
-- The central service only authorizes, lists and resolves. It never runs, relays or scores a match: the room runs in
-- the host's Graao Host app (Colyseus), players connect to the host's public endpoint (tunnel).
--
-- Who calls what (all through SECURITY DEFINER functions; the tables have RLS on and no policies, so no direct access):
--   site (signed-in or anonymous player, `authenticated`): host_ticket_create, host_my_installations, host_revoke
--   site, anyone with the ticket secret: host_ticket_status, host_ticket_cancel
--   Graao Host app (publishable key only, `anon`): host_ticket_peek, host_ticket_claim, then with its session token:
--     host_room_publish, host_heartbeat, host_room_close, host_session_end, host_ticket_fail
--   everyone: host_config, host_public_rooms, host_room_endpoint
--   Edge Function graao-host-tunnel (service role): host_session_validate, host_tunnel_upsert
--
-- Secrets are stored only as SHA-256 hex: ticket secrets (site → app, single use, 5 minutes), installation secrets
-- (kept by the app, encrypted with the OS user's key), session tokens (returned once, 12 h sliding expiry).
-- Errors are raised as 'graao_host:<code>' (the clients map the code). Everything is Postgres ≥ 13 built-ins
-- (sha256, gen_random_uuid): no extension needed.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ config
create table private.host_config (
  key text primary key,
  value jsonb not null
);
insert into private.host_config (key, value) values
  -- 'managed' once the graao-host-tunnel Edge Function has its Cloudflare secrets; until then test tunnels only.
  ('tunnel_mode', '"quick-test"'),
  ('latest_app_version', '"0.1.0"'),
  ('min_app_version', '"0.1.0"'),
  ('download_url', '"https://graao.vercel.app/graao-host"'),
  -- Development central only: accept ws://127.0.0.1 endpoints. Never true in production.
  ('allow_loopback_endpoints', 'false');

create function private.host_cfg(p_key text) returns jsonb
language sql stable set search_path = '' as $$
  select value from private.host_config where key = p_key
$$;

-- ------------------------------------------------------------------------------------------------ tables
create table public.host_installations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  app_version text not null default '' check (char_length(app_version) <= 32),
  protocol smallint not null default 0,
  status text not null default 'OFFLINE' check (status in ('OFFLINE', 'STARTING', 'ONLINE', 'HOSTING', 'STOPPING', 'ERROR')),
  active_room_id uuid,
  last_heartbeat_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index host_installations_owner on public.host_installations (owner_id);
comment on table public.host_installations is 'Graao Host installations authorized to host for an account (no paths, IPs or machine ids).';

create table public.host_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  room_name text not null check (char_length(room_name) between 1 and 56),
  visibility text not null check (visibility in ('PUBLIC', 'PRIVATE')),
  desired_bots smallint not null check (desired_bots between 0 and 9),
  host_display_name text not null default '' check (char_length(host_display_name) <= 20),
  protocol smallint not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'CLAIMED', 'READY', 'FAILED', 'EXPIRED', 'CANCELLED')),
  host_id uuid references public.host_installations (id) on delete set null,
  room_code text check (room_code ~ '^GR-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  room_id uuid,
  error text check (char_length(error) <= 200),
  expires_at timestamptz not null default now() + interval '5 minutes',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  ready_at timestamptz
);
create index host_tickets_owner_created on public.host_tickets (owner_id, created_at desc);
comment on table public.host_tickets is 'One-time hosting requests created by the site and claimed by the Graao Host app.';

create table private.host_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  host_id uuid not null references public.host_installations (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index host_sessions_host on private.host_sessions (host_id);

create table public.host_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null check (room_code ~ '^GR-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  host_id uuid not null references public.host_installations (id) on delete cascade,
  ticket_id uuid references public.host_tickets (id) on delete set null,
  name text not null check (char_length(name) between 1 and 56),
  host_display_name text not null default '' check (char_length(host_display_name) <= 20),
  max_participants smallint not null default 10 check (max_participants = 10),
  human_count smallint not null default 0 check (human_count between 0 and 10),
  desired_bot_count smallint not null default 0 check (desired_bot_count between 0 and 9),
  effective_bot_count smallint not null default 0 check (effective_bot_count between 0 and 9),
  visibility text not null check (visibility in ('PUBLIC', 'PRIVATE')),
  status text not null default 'LOBBY' check (status in ('LOBBY', 'DRAFT', 'DEPLOYMENT', 'MATCH', 'RESULTS', 'CLOSED')),
  available boolean not null default false,
  endpoint_id text not null check (char_length(endpoint_id) between 1 and 80),
  endpoint_url text not null check (char_length(endpoint_url) <= 200),
  protocol smallint not null,
  created_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (char_length(close_reason) <= 120),
  check (human_count + effective_bot_count <= max_participants)
);
-- One live room per code and per installation.
create unique index host_rooms_live_code on public.host_rooms (room_code) where closed_at is null;
create unique index host_rooms_live_host on public.host_rooms (host_id) where closed_at is null;
comment on table public.host_rooms is 'Rooms running on Graao Host installations (counts come only from the host''s heartbeat).';

-- Managed tunnels (Cloudflare): one per installation, stable hostname. Written by the Edge Function only.
create table private.host_tunnels (
  host_id uuid primary key references public.host_installations (id) on delete cascade,
  tunnel_id text not null,
  hostname text not null,
  dns_record_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

alter table public.host_installations enable row level security;
alter table public.host_tickets enable row level security;
alter table public.host_rooms enable row level security;
alter table private.host_sessions enable row level security;
alter table private.host_tunnels enable row level security;
alter table private.host_config enable row level security;

-- ------------------------------------------------------------------------------------------------ helpers
create function private.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

-- 244 random bits (two v4 UUIDs, from the server's strong random source) as 64 hex characters.
create function private.random_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create function private.host_fail(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'graao_host:%', p_code using errcode = 'P0001';
end $$;

-- Closes rooms whose host went quiet for two minutes (the list already hides them after 30 s) and forgets old tickets.
create function private.host_sweep() returns void
language sql set search_path = '' as $$
  update public.host_rooms set closed_at = now(), status = 'CLOSED', close_reason = 'heartbeat_timeout'
    where closed_at is null and last_heartbeat_at < now() - interval '2 minutes';
  update public.host_tickets set status = 'EXPIRED' where status = 'PENDING' and expires_at < now();
  delete from public.host_tickets where created_at < now() - interval '1 day';
  delete from private.host_sessions where expires_at < now();
$$;

-- The installation behind a session token (raises session_invalid / installation_revoked). Extends the session.
create function private.host_session_host(p_session text) returns public.host_installations
language plpgsql set search_path = '' as $$
declare
  v_host public.host_installations;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then perform private.host_fail('session_invalid'); end if;
  select i.* into v_host
    from private.host_sessions s join public.host_installations i on i.id = s.host_id
    where s.token_hash = private.sha256_hex(p_session) and s.expires_at > now();
  if not found then perform private.host_fail('session_invalid'); end if;
  if v_host.revoked_at is not null then perform private.host_fail('installation_revoked'); end if;
  update private.host_sessions set expires_at = now() + interval '12 hours' where token_hash = private.sha256_hex(p_session);
  return v_host;
end $$;

-- A room code free among live rooms and pending/claimed tickets.
create function private.host_new_room_code() returns text
language plpgsql set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_bytes bytea;
begin
  for attempt in 1..200 loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := 'GR-';
    for i in 0..3 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1);
    end loop;
    if not exists (select 1 from public.host_rooms where room_code = v_code and closed_at is null)
       and not exists (select 1 from public.host_tickets where room_code = v_code and status in ('CLAIMED', 'READY')) then
      return v_code;
    end if;
  end loop;
  perform private.host_fail('unavailable');
end $$;

-- Counts reported by a host, validated (a host is the authority over its room, not over the rules).
create function private.host_room_counts(p_room jsonb, out o_status text, out o_humans smallint, out o_desired smallint, out o_effective smallint, out o_available boolean)
language plpgsql immutable set search_path = '' as $$
begin
  if p_room is null or jsonb_typeof(p_room) <> 'object' then perform private.host_fail('invalid'); end if;
  o_status := p_room ->> 'status';
  if o_status is null or o_status not in ('LOBBY', 'DRAFT', 'DEPLOYMENT', 'MATCH', 'RESULTS') then perform private.host_fail('invalid'); end if;
  begin
    o_humans := (p_room ->> 'human_count')::smallint;
    o_desired := (p_room ->> 'desired_bot_count')::smallint;
    o_effective := (p_room ->> 'effective_bot_count')::smallint;
  exception when others then
    perform private.host_fail('invalid');
  end;
  if o_humans is null or o_desired is null or o_effective is null
     or o_humans not between 0 and 10 or o_desired not between 0 and 9 or o_effective not between 0 and 9
     or o_humans + o_effective > 10 then
    perform private.host_fail('invalid');
  end if;
  o_available := coalesce((p_room ->> 'available')::boolean, false) and o_status = 'LOBBY' and o_humans < 10;
end $$;

-- ------------------------------------------------------------------------------------------------ public config
create function public.host_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'api_version', 1,
    'tunnel_mode', private.host_cfg('tunnel_mode') #>> '{}',
    'latest_app_version', private.host_cfg('latest_app_version') #>> '{}',
    'min_app_version', private.host_cfg('min_app_version') #>> '{}',
    'download_url', private.host_cfg('download_url') #>> '{}'
  )
$$;

-- ------------------------------------------------------------------------------------------------ site: tickets
create function public.host_ticket_create(p_secret_hash text, p_room_name text, p_visibility text, p_bots integer, p_protocol integer, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := left(regexp_replace(btrim(coalesce(p_room_name, '')), '[[:cntrl:]]', '', 'g'), 56);
  v_display text := left(regexp_replace(btrim(coalesce(p_display_name, '')), '[[:cntrl:]]', '', 'g'), 20);
  v_ticket public.host_tickets;
begin
  if v_uid is null then perform private.host_fail('unauthenticated'); end if;
  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' or p_visibility not in ('PUBLIC', 'PRIVATE')
     or p_bots is null or p_bots not between 0 and 9 or p_protocol is null or p_protocol not between 1 and 32767 then
    perform private.host_fail('invalid');
  end if;
  if v_name = '' then v_name := 'Sala de ' || coalesce(nullif(v_display, ''), 'graao'); end if;
  if (select count(*) from public.host_tickets where owner_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then
    perform private.host_fail('rate_limited');
  end if;
  perform private.host_sweep();
  insert into public.host_tickets (owner_id, secret_hash, room_name, visibility, desired_bots, host_display_name, protocol)
    values (v_uid, p_secret_hash, v_name, p_visibility, p_bots, v_display, p_protocol)
    returning * into v_ticket;
  return jsonb_build_object('ticket_id', v_ticket.id, 'expires_at', v_ticket.expires_at);
end $$;

create function public.host_ticket_status(p_ticket uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.host_tickets;
  v_url text;
begin
  select * into v_t from public.host_tickets where id = p_ticket and secret_hash = private.sha256_hex(p_secret);
  if not found then perform private.host_fail('ticket_not_found'); end if;
  if v_t.status = 'PENDING' and v_t.expires_at < now() then
    update public.host_tickets set status = 'EXPIRED' where id = v_t.id;
    v_t.status := 'EXPIRED';
  end if;
  if v_t.status = 'READY' then
    select endpoint_url into v_url from public.host_rooms
      where id = v_t.room_id and closed_at is null and last_heartbeat_at > now() - interval '30 seconds';
    if v_url is null then v_t.status := 'FAILED'; v_t.error := coalesce(v_t.error, 'room_gone'); end if;
  end if;
  return jsonb_build_object('status', v_t.status, 'error', coalesce(v_t.error, ''), 'room_code', coalesce(v_t.room_code, ''), 'endpoint_url', coalesce(v_url, ''));
end $$;

create function public.host_ticket_cancel(p_ticket uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.host_tickets set status = 'CANCELLED'
    where id = p_ticket and secret_hash = private.sha256_hex(p_secret) and status = 'PENDING';
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------------ app: pairing
create function public.host_ticket_peek(p_ticket uuid, p_secret text, p_installation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.host_tickets;
  v_owner uuid;
  v_revoked timestamptz;
begin
  select * into v_t from public.host_tickets where id = p_ticket and secret_hash = private.sha256_hex(p_secret);
  if not found then perform private.host_fail('ticket_not_found'); end if;
  if v_t.status <> 'PENDING' then perform private.host_fail('ticket_used'); end if;
  if v_t.expires_at < now() then perform private.host_fail('ticket_expired'); end if;
  if p_installation is not null then
    select owner_id, revoked_at into v_owner, v_revoked from public.host_installations where id = p_installation;
  end if;
  return jsonb_build_object(
    'room_name', v_t.room_name, 'visibility', v_t.visibility, 'desired_bots', v_t.desired_bots,
    'host_display_name', v_t.host_display_name, 'protocol', v_t.protocol,
    'linked', v_owner is not null and v_owner = v_t.owner_id and v_revoked is null,
    'conflict', v_owner is not null and v_owner <> v_t.owner_id
  );
end $$;

create function public.host_ticket_claim(p_ticket uuid, p_secret text, p_installation uuid, p_install_secret text, p_app_version text, p_protocol integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.host_tickets;
  v_host public.host_installations;
  v_token text := private.random_token();
  v_expires timestamptz := now() + interval '12 hours';
  v_code text;
begin
  if p_install_secret is null or char_length(p_install_secret) not between 32 and 256 then perform private.host_fail('invalid'); end if;
  select * into v_t from public.host_tickets where id = p_ticket and secret_hash = private.sha256_hex(p_secret) for update;
  if not found then perform private.host_fail('ticket_not_found'); end if;
  if v_t.status <> 'PENDING' then perform private.host_fail('ticket_used'); end if;
  if v_t.expires_at < now() then
    update public.host_tickets set status = 'EXPIRED' where id = v_t.id;
    perform private.host_fail('ticket_expired');
  end if;
  if p_protocol is distinct from v_t.protocol::integer then
    -- The site learns why (it shows "atualize o Graao Host") through the ticket status.
    update public.host_tickets set status = 'FAILED', error = 'version_mismatch' where id = v_t.id;
    return jsonb_build_object('error', 'version_mismatch');
  end if;

  if p_installation is not null then
    select * into v_host from public.host_installations where id = p_installation for update;
  end if;
  if v_host.id is null then
    insert into public.host_installations (owner_id, secret_hash, app_version, protocol, status, last_heartbeat_at)
      values (v_t.owner_id, private.sha256_hex(p_install_secret), left(coalesce(p_app_version, ''), 32), p_protocol, 'STARTING', now())
      returning * into v_host;
  else
    if v_host.owner_id <> v_t.owner_id then perform private.host_fail('installation_conflict'); end if;
    if v_host.revoked_at is not null then perform private.host_fail('installation_revoked'); end if;
    if v_host.secret_hash <> private.sha256_hex(p_install_secret) then perform private.host_fail('installation_secret'); end if;
    update public.host_installations set app_version = left(coalesce(p_app_version, ''), 32), protocol = p_protocol, status = 'STARTING', last_heartbeat_at = now()
      where id = v_host.id;
  end if;

  v_code := private.host_new_room_code();
  delete from private.host_sessions where host_id = v_host.id and expires_at < now();
  insert into private.host_sessions (token_hash, host_id, expires_at) values (private.sha256_hex(v_token), v_host.id, v_expires);
  update public.host_tickets set status = 'CLAIMED', host_id = v_host.id, room_code = v_code, claimed_at = now() where id = v_t.id;
  return jsonb_build_object(
    'host_id', v_host.id, 'session_token', v_token, 'session_expires_at', v_expires, 'room_code', v_code,
    'room_name', v_t.room_name, 'visibility', v_t.visibility, 'desired_bots', v_t.desired_bots,
    'host_display_name', v_t.host_display_name, 'tunnel_mode', private.host_cfg('tunnel_mode') #>> '{}'
  );
end $$;

-- The app could not host this ticket (or it is busy with another room): the site shows why.
create function public.host_ticket_fail(p_session text, p_ticket uuid, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host public.host_installations := private.host_session_host(p_session);
begin
  update public.host_tickets set status = 'FAILED', error = left(coalesce(p_error, 'unknown'), 200)
    where id = p_ticket and status in ('PENDING', 'CLAIMED')
      and (host_id = v_host.id or (status = 'PENDING' and owner_id = v_host.owner_id));
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------------ app: rooms
create function public.host_room_publish(p_session text, p_ticket uuid, p_endpoint_id text, p_endpoint_url text, p_room jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host public.host_installations := private.host_session_host(p_session);
  v_t public.host_tickets;
  v_c record;
  v_room_id uuid;
  v_loopback boolean := coalesce((private.host_cfg('allow_loopback_endpoints'))::text = 'true', false);
begin
  select * into v_t from public.host_tickets where id = p_ticket and host_id = v_host.id for update;
  -- A failed attempt may be retried from the app for a while (same claim).
  if not found or v_t.status not in ('CLAIMED', 'FAILED') or v_t.claimed_at < now() - interval '30 minutes' then
    perform private.host_fail('ticket_used');
  end if;
  if p_endpoint_url is null or not (p_endpoint_url ~ '^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
       or (v_loopback and p_endpoint_url ~ '^ws://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$'))
     or p_endpoint_id is null or char_length(p_endpoint_id) not between 1 and 80 then
    perform private.host_fail('endpoint_invalid');
  end if;
  select * into v_c from private.host_room_counts(p_room);
  perform private.host_sweep();
  -- One live room per installation: a new one replaces the previous.
  update public.host_rooms set closed_at = now(), status = 'CLOSED', close_reason = 'replaced' where host_id = v_host.id and closed_at is null;
  insert into public.host_rooms (room_code, host_id, ticket_id, name, host_display_name, human_count, desired_bot_count, effective_bot_count,
                                 visibility, status, available, endpoint_id, endpoint_url, protocol)
    values (v_t.room_code, v_host.id, v_t.id, v_t.room_name, v_t.host_display_name, v_c.o_humans, v_c.o_desired, v_c.o_effective,
            v_t.visibility, v_c.o_status, v_c.o_available, p_endpoint_id, p_endpoint_url, v_t.protocol)
    returning id into v_room_id;
  update public.host_tickets set status = 'READY', room_id = v_room_id, ready_at = now(), error = null where id = v_t.id;
  update public.host_installations set status = 'HOSTING', active_room_id = v_room_id, last_heartbeat_at = now() where id = v_host.id;
  return jsonb_build_object('room_id', v_room_id);
end $$;

create function public.host_heartbeat(p_session text, p_status text, p_room jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host public.host_installations;
  v_c record;
  v_live boolean;
begin
  begin
    v_host := private.host_session_host(p_session);
  exception when raise_exception then
    if sqlerrm = 'graao_host:installation_revoked' then return jsonb_build_object('revoked', true, 'room_closed', true); end if;
    raise;
  end;
  if p_status is null or p_status not in ('STARTING', 'ONLINE', 'HOSTING', 'STOPPING', 'ERROR') then perform private.host_fail('invalid'); end if;
  update public.host_installations set status = p_status, last_heartbeat_at = now() where id = v_host.id;
  select exists (select 1 from public.host_rooms where host_id = v_host.id and closed_at is null) into v_live;
  if p_room is not null and v_live then
    select * into v_c from private.host_room_counts(p_room);
    update public.host_rooms
      set human_count = v_c.o_humans, desired_bot_count = v_c.o_desired, effective_bot_count = v_c.o_effective,
          status = v_c.o_status, available = v_c.o_available, last_heartbeat_at = now()
      where host_id = v_host.id and closed_at is null;
  end if;
  return jsonb_build_object('revoked', false, 'room_closed', v_host.active_room_id is not null and not v_live);
end $$;

create function public.host_room_close(p_session text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host public.host_installations := private.host_session_host(p_session);
begin
  update public.host_rooms set closed_at = now(), status = 'CLOSED', close_reason = left(coalesce(p_reason, ''), 120)
    where host_id = v_host.id and closed_at is null;
  update public.host_installations set status = 'ONLINE', active_room_id = null where id = v_host.id;
  return jsonb_build_object('ok', true);
end $$;

create function public.host_session_end(p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host_id uuid;
begin
  select host_id into v_host_id from private.host_sessions where token_hash = private.sha256_hex(p_session);
  if v_host_id is not null then
    update public.host_rooms set closed_at = now(), status = 'CLOSED', close_reason = coalesce(close_reason, 'session_end')
      where host_id = v_host_id and closed_at is null;
    update public.host_installations set status = 'OFFLINE', active_room_id = null where id = v_host_id;
    delete from private.host_sessions where token_hash = private.sha256_hex(p_session);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------------ everyone: list, resolve
create function public.host_public_rooms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r order by r.available desc, r.created_at desc), '[]'::jsonb)
  from (
    select room.id as room_id, room.room_code, room.name, room.host_id,
           -- An opaque per-account id (never the account id itself).
           left(private.sha256_hex(i.owner_id::text || ':graao-host'), 16) as host_player_id,
           room.host_display_name, room.max_participants, room.human_count, room.desired_bot_count,
           room.effective_bot_count, room.visibility, room.status, room.available, room.endpoint_id,
           room.protocol, room.created_at, room.last_heartbeat_at
    from public.host_rooms room join public.host_installations i on i.id = room.host_id
    where room.closed_at is null and room.visibility = 'PUBLIC' and i.revoked_at is null
      and room.last_heartbeat_at > now() - interval '30 seconds'
    order by room.available desc, room.created_at desc
    limit 100
  ) r
$$;

-- roomId (code) → the live endpoint of that room. Knowing a private room's code is the invitation.
create function public.host_room_endpoint(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('room_code', room.room_code, 'endpoint_url', room.endpoint_url, 'protocol', room.protocol,
                            'status', room.status, 'available', room.available)
  from public.host_rooms room join public.host_installations i on i.id = room.host_id
  where room.room_code = upper(p_code) and room.closed_at is null and i.revoked_at is null
    and room.last_heartbeat_at > now() - interval '30 seconds'
  limit 1
$$;

-- ------------------------------------------------------------------------------------------------ owner: installations
create function public.host_my_installations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'host_id', id, 'owner_id', owner_id, 'app_version', app_version, 'protocol', protocol,
      'status', case when last_heartbeat_at < now() - interval '30 seconds' then 'OFFLINE' else status end,
      'active_room_id', active_room_id, 'last_heartbeat_at', last_heartbeat_at, 'revoked', revoked_at is not null
    ) order by created_at desc), '[]'::jsonb)
  from public.host_installations where owner_id = auth.uid()
$$;

create function public.host_revoke(p_host uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform private.host_fail('unauthenticated'); end if;
  update public.host_installations set revoked_at = now(), status = 'OFFLINE', active_room_id = null
    where id = p_host and owner_id = auth.uid() and revoked_at is null;
  if not found then perform private.host_fail('invalid'); end if;
  update public.host_rooms set closed_at = now(), status = 'CLOSED', close_reason = 'revoked' where host_id = p_host and closed_at is null;
  -- Sessions stay until they expire: every use now answers "revoked", so the app learns it and stops.
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------------ Edge Function (service role)
create function public.host_session_validate(p_session text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_host public.host_installations := private.host_session_host(p_session);
  v_tunnel private.host_tunnels;
begin
  select * into v_tunnel from private.host_tunnels where host_id = v_host.id;
  return jsonb_build_object('host_id', v_host.id, 'tunnel_id', v_tunnel.tunnel_id, 'hostname', v_tunnel.hostname, 'dns_record_id', v_tunnel.dns_record_id);
end $$;

create function public.host_tunnel_upsert(p_host uuid, p_tunnel_id text, p_hostname text, p_dns_record_id text) returns jsonb
language sql security definer set search_path = '' as $$
  insert into private.host_tunnels (host_id, tunnel_id, hostname, dns_record_id) values (p_host, p_tunnel_id, p_hostname, p_dns_record_id)
  on conflict (host_id) do update set tunnel_id = excluded.tunnel_id, hostname = excluded.hostname,
    dns_record_id = excluded.dns_record_id, last_used_at = now();
  select jsonb_build_object('ok', true);
$$;

-- Tunnels to recycle: installations revoked, or silent for p_days (a stable hostname per PC costs a DNS record and one
-- of the account's tunnels; see docs/hosting/GRAAO_HOST_TUNNELS.md).
create function public.host_tunnels_stale(p_days integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('host_id', t.host_id, 'tunnel_id', t.tunnel_id, 'hostname', t.hostname, 'dns_record_id', t.dns_record_id)), '[]'::jsonb)
  from private.host_tunnels t join public.host_installations i on i.id = t.host_id
  where i.revoked_at is not null or t.last_used_at < now() - make_interval(days => greatest(p_days, 1))
$$;

create function public.host_tunnel_forget(p_host uuid) returns jsonb
language sql security definer set search_path = '' as $$
  delete from private.host_tunnels where host_id = p_host;
  select jsonb_build_object('ok', true);
$$;

-- ------------------------------------------------------------------------------------------------ grants
revoke all on function public.host_config(), public.host_ticket_create(text, text, text, integer, integer, text),
  public.host_ticket_status(uuid, text), public.host_ticket_cancel(uuid, text), public.host_ticket_peek(uuid, text, uuid),
  public.host_ticket_claim(uuid, text, uuid, text, text, integer), public.host_ticket_fail(text, uuid, text),
  public.host_room_publish(text, uuid, text, text, jsonb), public.host_heartbeat(text, text, jsonb),
  public.host_room_close(text, text), public.host_session_end(text), public.host_public_rooms(),
  public.host_room_endpoint(text), public.host_my_installations(), public.host_revoke(uuid),
  public.host_session_validate(text), public.host_tunnel_upsert(uuid, text, text, text),
  public.host_tunnels_stale(integer), public.host_tunnel_forget(uuid)
  from public, anon, authenticated;

grant execute on function public.host_config(), public.host_public_rooms(), public.host_room_endpoint(text),
  public.host_ticket_status(uuid, text), public.host_ticket_cancel(uuid, text), public.host_ticket_peek(uuid, text, uuid),
  public.host_ticket_claim(uuid, text, uuid, text, text, integer), public.host_ticket_fail(text, uuid, text),
  public.host_room_publish(text, uuid, text, text, jsonb), public.host_heartbeat(text, text, jsonb),
  public.host_room_close(text, text), public.host_session_end(text)
  to anon, authenticated;
grant execute on function public.host_ticket_create(text, text, text, integer, integer, text), public.host_my_installations(),
  public.host_revoke(uuid) to authenticated;
grant execute on function public.host_session_validate(text), public.host_tunnel_upsert(uuid, text, text, text),
  public.host_tunnels_stale(integer), public.host_tunnel_forget(uuid) to service_role;

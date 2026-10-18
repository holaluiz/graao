-- Graao Host: an expired hosting request is reported as expired, never as "already used".
--
-- 0003 checked `status <> 'PENDING'` before the expiry. Once the site's poll (`host_ticket_status`) or the cleanup had
-- marked a ticket EXPIRED, an app that opened it late (the person took more than five minutes to confirm, or to install
-- the app) showed "Pedido já usado" instead of "Pedido expirado". Same functions otherwise; `create or replace` keeps
-- their owner and grants.

create or replace function public.host_ticket_peek(p_ticket uuid, p_secret text, p_installation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t public.host_tickets;
  v_owner uuid;
  v_revoked timestamptz;
begin
  select * into v_t from public.host_tickets where id = p_ticket and secret_hash = private.sha256_hex(p_secret);
  if not found then perform private.host_fail('ticket_not_found'); end if;
  if v_t.status = 'EXPIRED' or (v_t.status = 'PENDING' and v_t.expires_at < now()) then perform private.host_fail('ticket_expired'); end if;
  if v_t.status <> 'PENDING' then perform private.host_fail('ticket_used'); end if;
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

create or replace function public.host_ticket_claim(p_ticket uuid, p_secret text, p_installation uuid, p_install_secret text, p_app_version text, p_protocol integer)
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
  if v_t.status = 'EXPIRED' or (v_t.status = 'PENDING' and v_t.expires_at < now()) then perform private.host_fail('ticket_expired'); end if;
  if v_t.status <> 'PENDING' then perform private.host_fail('ticket_used'); end if;
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

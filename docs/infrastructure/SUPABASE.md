# Supabase (TESTING)

Supabase remembers the player; Colyseus runs the match. Project **graao** (`roxnhqzeznsdnsqjcmmn`, sa-east-1, free
plan), created 2026-10-17. Schema in `packages/database/migrations` (applied in order; never edit an applied file).

## Tables (RLS on everywhere)

| Table | Who writes | Who reads |
|---|---|---|
| `profiles` (id = auth user, `display_name`, `appearance` jsonb of catalog ids, `settings` jsonb) | the player (own row: insert/update) | the player (own row) |
| `matches` (code, start/end, duration, winner index, protocol, server version) | the match server only, via `record_match` | participants (`private.played_in`) |
| `match_players` (per-player line: placement, won, kills, deaths, damage dealt/taken, shots, hits, spells, loadout, appearance, `profile_id` or null for a guest) | the match server only | participants |

- `record_match(p_secret, p_match)`: SECURITY DEFINER, callable with the publishable key, refuses anything whose secret
  does not hash to a row of `private.server_keys`. The advisor flags it as anon-executable SECURITY DEFINER: that is
  intended (the secret is the gate). No service-role key is used anywhere.
- `my_matches(p_limit)`: SECURITY INVOKER; the caller's latest matches with every participant's line (menu history).
- Profile ids in results come only from tokens the match server verified; a guest's line has `profile_id` null.

## Auth

- Browser: anonymous sign-in (`ProfileService`, supabase-js loaded lazily after the menu, session in localStorage
  under `graao.auth`). The cloud row wins at startup unless the player already changed something this session; the
  first sign-in uploads this browser's name, look and settings. Without Supabase (no env, offline, or anonymous
  sign-ins disabled) everything works from localStorage and the player joins as a guest.
- Match server: verifies the access token on join (JWKS, ES256) and keeps only the user id.
- **Pending (needs the project owner):** turn on *Authentication → Sign In / Providers → Allow anonymous sign-ins*.
  Until then every player is a guest (matches are still recorded, without a profile).

## Environment

- Client (`apps/client/.env.local`, publishable values only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Server (`apps/server/.env`, never committed): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GRAAO_SERVER_SECRET`.
  The local dev secret is registered as `dev-local`; each deployment registers its own (see the migrations README).

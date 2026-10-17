# Supabase (TODO — needs a project)

Supabase remembers the player; Colyseus runs the match.

Planned tables (RLS on): `profiles` (id = `auth.uid()`, display name), `appearances` (player_id + the 12 appearance
ids), `settings`, `match_results` (written by the server at match end with the service key, never by clients).

Auth: DEV GUEST now; Supabase anonymous or email auth for the public MVP. The server validates the access token on
join. The service role key never reaches the browser.

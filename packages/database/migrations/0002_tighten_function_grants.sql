-- my_matches runs as the caller (RLS on matches/match_players applies through private.played_in).
alter function public.my_matches(integer) security invoker;
revoke execute on function public.my_matches(integer) from anon;
-- record_match is the match server's write path: callable with the publishable key (anon) but gated by the server
-- secret inside. Signed-in players have no reason to call it.
revoke execute on function public.record_match(text, jsonb) from authenticated;
revoke execute on function private.played_in(uuid) from anon;
revoke execute on function private.touch_updated_at() from anon, authenticated;

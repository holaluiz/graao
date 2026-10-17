# graao database migrations

Applied in order to the Supabase project `graao` (sa-east-1), through the Supabase MCP `apply_migration` or the SQL
editor. Each file is applied once; never edit an applied file, add a new one.

After applying `0001` on a new project, register the match server's secret. Only its SHA-256 goes to the database; the
secret itself lives in the server's environment as `GRAAO_SERVER_SECRET`:

```sql
insert into private.server_keys (id, secret_sha256) values ('<name>', decode('<sha256 hex of the secret>', 'hex'));
```

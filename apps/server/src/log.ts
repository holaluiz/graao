/** Structured one-line logs (JSON fields) for the server console and container logs. */
export function log(msg: string, fields: Record<string, unknown> = {}): void {
  const t = new Date().toISOString().slice(11, 23);
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  console.log(`[graao ${t}] ${msg}${extra}`);
}

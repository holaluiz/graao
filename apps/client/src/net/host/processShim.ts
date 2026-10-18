/**
 * The server code reads `process.env` (its mode and an empty config: no database, no sign-in checks in the browser).
 * Imported first by the host worker, before the room module evaluates.
 */
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
g.process ??= { env: { NODE_ENV: import.meta.env.DEV ? 'development' : 'production' } };

export {};

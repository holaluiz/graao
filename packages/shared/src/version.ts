/** Semantic version of the client build. Shown in the dev UI and sent on join. */
export const CLIENT_VERSION = '0.9.0';
/**
 * Bump on any breaking change to messages or their meaning, and on any change to the shared world or movement
 * (terrain, layout, colliders, MOVEMENT): a server simulating another world corrects every client's prediction all
 * the time, which players feel as being pushed around. The server rejects other versions.
 * 10: world of PR #8 (ridges, channels, biome scatter, village) and the 1 s input backlog.
 */
export const PROTOCOL_VERSION = 10;
/** Version segment of immutable asset URLs (`/assets/v1/...`). */
export const ASSET_VERSION = 'v1';

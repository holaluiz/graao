/**
 * World interactivity (docs/world/WORLD_DESIGN.md, "Interatividade"): the doors of the houses open and close, single
 * crates break under fire and punches. Doors come from the kit's door modules (KitPrefab.door), crates from prefabs
 * whose cover is 'destrutivel'. The room's server owns every state and sends it to everyone (game-core
 * interactiveSystem.ts); big landmarks and walls never break.
 */
export const INTERACTIVES = {
  door: {
    /** How far (m, from the character's chest to the middle of the opening) a door can be used. */
    useRange: 2.3,
    /** Per player: shortest gap between two door requests (ms). */
    intervalMs: 280,
    /** Client animation of a swing (ms); the collider changes at once. */
    swingMs: 260,
    /** Leaf thickness (m). */
    leafT: 0.05,
    /** A bot walking into a closed door opens it within this distance of the opening (m). */
    botRange: 1.25,
    /** About one door in this many starts open in every match (picked by the door's id: same on client and server). */
    openEvery: 3,
  },
  crate: {
    /** Hit points of a breakable crate (a rifle burst, a few pistol shots or three punches). */
    hp: 60,
    /** A shotgun's pellets hit a crate for this share of their damage each (they all land on such a big target). */
    pelletShare: 1,
  },
} as const;

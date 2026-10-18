/**
 * Dumps the procedural body of each body type (bind pose, rig space, meters) for the Blender garment script:
 * mesh (positions, triangles, region per vertex), rig joints and the head ellipsoid. Garments modeled in Blender are
 * fitted to exactly this surface, so they follow the body the code builds.
 *
 *   pnpm tsx tools/character/dump-body.ts   →   tools/character/body-ref.json
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRig, SLIM, STURDY } from '../../apps/client/src/character/rig/GRARig';
import { makeBodyShape } from '../../apps/client/src/character/build/anatomy';
import { PartBuilder, REGION_IDS } from '../../apps/client/src/character/build/PartBuilder';
import { buildBody } from '../../apps/client/src/character/parts/body';

const round = (v: number) => Math.round(v * 1e5) / 1e5;
const out: Record<string, unknown> = { regions: REGION_IDS };
for (const [id, props] of [['body.slim', SLIM], ['body.sturdy', STURDY]] as const) {
  const rig = createRig(props);
  const shape = makeBodyShape(props, id === 'body.sturdy');
  const b = new PartBuilder();
  buildBody(b, shape);
  out[id] = {
    positions: b.pos.map(round),
    indices: b.index,
    regions: b.region,
    joints: Object.fromEntries(rig.defs.map((d) => [d.name, d.pos])),
    proportions: props,
    head: { center: shape.head.center, a: shape.head.a, b: shape.head.b, c: shape.head.c },
    torso: shape.torso,
    arm: shape.arm,
    leg: shape.leg,
  };
}
const file = fileURLToPath(new URL('./body-ref.json', import.meta.url));
writeFileSync(file, JSON.stringify(out));
console.log('wrote', file);

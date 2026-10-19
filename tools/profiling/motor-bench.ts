/**
 * Cost of one CharacterMotor.step on the real planet (µs per 1/60 s step), the number the server pays per player and
 * per command: `pnpm exec tsx tools/profiling/motor-bench.ts`. Runs a character around the Vila (running, jumping
 * against walls), then idles; traversal states (hang, climb, glide) add their own probes on top of this baseline.
 */
import { CharacterMotor, createCharacterState, createGameWorld, latLonToDir, newInput } from '@graao/game-core';
import { PLANET } from '@graao/game-data';
import { InputButton, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';

const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);
const dir = latLonToDir(14.5, 0);
const h = world.terrain.heightAt(dir) + 0.5;
const spawn: Vec3 = { x: dir.x * (PLANET.radius + h), y: dir.y * (PLANET.radius + h), z: dir.z * (PLANET.radius + h) };
const s = createCharacterState(spawn, v3normalize(v3projectOnPlane({ x: 1, y: 0, z: 0 }, dir)));
const body = motor.createBody(s);
const inp = newInput();

function run(label: string, steps: number, drive: (i: number) => void): void {
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    drive(i);
    motor.step(body, s, inp, 1 / 60);
  }
  const us = ((performance.now() - t0) * 1000) / steps;
  console.log(`${label.padEnd(28)} ${us.toFixed(1)} µs/step (${steps} steps)`);
}

// Warm-up (JIT, Rapier broad phase).
run('warm-up', 600, () => {});
run('idle on the ground', 3000, () => {
  inp.wish = { x: 0, y: 0, z: 0 };
  inp.buttons = 0;
});
let heading = 0;
run('running + jumping (vila)', 6000, (i) => {
  const up = v3normalize(s.pos);
  heading += 0.004;
  const north = v3normalize(v3projectOnPlane({ x: 0, y: 1, z: 0 }, up));
  const east = v3normalize({ x: up.y * north.z - up.z * north.y, y: up.z * north.x - up.x * north.z, z: up.x * north.y - up.y * north.x });
  inp.wish = { x: north.x * Math.cos(heading) + east.x * Math.sin(heading), y: north.y * Math.cos(heading) + east.y * Math.sin(heading), z: north.z * Math.cos(heading) + east.z * Math.sin(heading) };
  inp.buttons = InputButton.SPRINT | (i % 50 < 3 ? InputButton.JUMP : 0);
});
const r = Math.hypot(s.pos.x, s.pos.y, s.pos.z);
console.log(`end radius ${r.toFixed(2)} m, grounded ${s.grounded}, state ${s.moveState}`);

// Traversal overhead, A/B interleaved in this process (the machine's load changes between runs, not between blocks):
// the same run with every traversal capability (grab probes in the air, glide checks) and with none (as bots).
{
  const blocks: Record<'com' | 'sem', number[]> = { com: [], sem: [] };
  for (let b = 0; b < 16; b++) {
    const key = b % 2 ? 'sem' : 'com';
    s.traversalCaps = key === 'com' ? undefined : 0;
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      const up = v3normalize(s.pos);
      heading += 0.004;
      const north = v3normalize(v3projectOnPlane({ x: 0, y: 1, z: 0 }, up));
      const east = v3normalize({ x: up.y * north.z - up.z * north.y, y: up.z * north.x - up.x * north.z, z: up.x * north.y - up.y * north.x });
      inp.wish = { x: north.x * Math.cos(heading) + east.x * Math.sin(heading), y: north.y * Math.cos(heading) + east.y * Math.sin(heading), z: north.z * Math.cos(heading) + east.z * Math.sin(heading) };
      inp.buttons = InputButton.SPRINT | (i % 50 < 3 ? InputButton.JUMP : 0);
      motor.step(body, s, inp, 1 / 60);
      if (s.traversal) s.traversal = 0;
    }
    blocks[key].push(((performance.now() - t0) * 1000) / 600);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
  console.log(`A/B correndo na vila: com travessia ${med(blocks.com).toFixed(1)} µs, sem ${med(blocks.sem).toFixed(1)} µs (mediana de 8 blocos de 600 passos)`);
  s.traversalCaps = undefined;
}

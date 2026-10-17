/**
 * UFO drop tuning numbers (docs/gameplay/UFO_DEPLOYMENT.md): dive duration and steering reach from the middle of the
 * jump window, with the shared controller and the real world, over 10 random routes.
 *   npx tsx tools/profiling/dive-stats.ts
 */
import { CharacterMotor, createCharacterState, createGameWorld, diveStart, makeUfoRoute, mulberry32, newInput, ufoSpeed } from '@graao/game-core';
import { InputButton, v3angle, v3normalize, v3projectOnPlane } from '@graao/shared';
const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);
const out: string[] = [];
for (const [label, buttons, steer] of [['normal', 0, false], ['rápido (Shift)', InputButton.SPRINT, false], ['normal + planando em frente', 0, true]] as const) {
  const times: number[] = []; const reach: number[] = [];
  for (let k = 0; k < 10; k++) {
    const route = makeUfoRoute(mulberry32(k * 13 + 1), 0);
    const d = diveStart(route, (route.open + route.close) / 2);
    const s = createCharacterState(d.pos, d.facing); s.vel = { ...d.vel }; s.diving = true;
    const body = motor.createBody(s); const inp = newInput(); let t = 0;
    while (s.diving && t < 30) { const up = v3normalize(s.pos); inp.wish = steer ? v3normalize(v3projectOnPlane(d.facing, up)) : { x: 0, y: 0, z: 0 }; inp.buttons = buttons; motor.step(body, s, inp, 1 / 60); t += 1 / 60; }
    body.dispose(); times.push(t); reach.push(v3angle(v3normalize(d.pos), v3normalize(s.pos)) * 100);
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  out.push(`${label}: ${avg(times).toFixed(1)} s (min ${Math.min(...times).toFixed(1)}, max ${Math.max(...times).toFixed(1)}), alcance ${avg(reach).toFixed(0)} m`);
}
out.push(`velocidade do OVNI: ${ufoSpeed(makeUfoRoute(mulberry32(1), 0)).toFixed(1)} m/s`);
console.log(out.join('\n'));
process.exit(0);

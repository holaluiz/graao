/**
 * Times of the Serra do Mirante's three routes on the real map (docs/world/SERRA_DO_MIRANTE.md), played with plain
 * inputs through the shared motor: `pnpm exec tsx tools/profiling/vertical-routes.ts`.
 */
import { CharacterMotor, createCharacterState, createGameWorld, frameOfPlacement, newInput, type CharacterState } from '@graao/game-core';
import { GRAAO_MAP, PLANET, TraversalMode } from '@graao/game-data';
import { InputButton, v3dot, v3len, v3normalize, type Vec3 } from '@graao/shared';

const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);
const F = frameOfPlacement(world.terrain, GRAAO_MAP.placements.find((p) => p.id === 'vert-serra-macico')!);
const radial = (p: Vec3) => v3len(p) - PLANET.radius;
const SUMMIT = radial(F.at(0, 11.6, 0));
const tan = (v: Vec3, up: Vec3) => { const k = v3dot(v, up); return { x: v.x - up.x * k, y: v.y - up.y * k, z: v.z - up.z * k }; };
const dirTo = (s: CharacterState, t: Vec3) => { const d = tan({ x: t.x - s.pos.x, y: t.y - s.pos.y, z: t.z - s.pos.z }, v3normalize(s.pos)); const l = v3len(d); return l < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: d.x / l, y: d.y / l, z: d.z / l }; };
function runner(p: Vec3) {
  const u = v3normalize(p);
  const s = createCharacterState({ x: p.x + u.x * 0.05, y: p.y + u.y * 0.05, z: p.z + u.z * 0.05 }, F.forward);
  const body = motor.createBody(s);
  const inp = newInput();
  let steps = 0;
  const step = (wish: Vec3, buttons: number) => { inp.wish = wish; inp.buttons = buttons; motor.step(body, s, inp, 1 / 60); steps++; };
  for (let i = 0; i < 20; i++) step({ x: 0, y: 0, z: 0 }, 0);
  steps = 0;
  return { s, step, get t() { return steps / 60; }, done: () => body.dispose() };
}
// Route A: run (sprint) through the trail points.
{
  const r = runner(F.at(8.9, 0, 9.0));
  for (const t of [F.at(8.9, 0, 7.0), F.at(8.9, 4.2, -5.6), F.at(-7.0, 4.2, -5.4), F.at(-7.0, 4.2, -4.5), F.at(-7.0, 8.0, 4.0), F.at(-5.2, 8.0, 2.9), F.at(3.6, 8.0, 2.9), F.at(3.6, 11.6, -3.6), F.at(1.8, 11.6, -3.2), F.at(0, 11.6, 0)]) {
    let i = 0;
    for (; i < 1200 && v3len(tan({ x: t.x - r.s.pos.x, y: t.y - r.s.pos.y, z: t.z - r.s.pos.z }, v3normalize(r.s.pos))) > 0.6; i++) r.step(dirTo(r.s, t), 0);
    if (process.env.DBG) { const q = { x: r.s.pos.x - F.base.x, y: r.s.pos.y - F.base.y, z: r.s.pos.z - F.base.z }; console.log('  alvo', i >= 1200 ? 'PRESO' : 'ok', v3dot(q, F.side).toFixed(1), (radial(r.s.pos) - radial(F.base)).toFixed(2), v3dot(q, F.forward).toFixed(1)); }
  }
  console.log(`rota A (trilha, corrida normal): ${r.t.toFixed(1)} s, cume ${radial(r.s.pos) > SUMMIT - 0.3 ? 'sim' : 'NÃO'}`);
  r.done();
}
// Route B: climb each face, rest until the stamina is back over 60, walk to the next face.
{
  const r = runner(F.at(0.4, 0, 7.6));
  const into = { x: -F.forward.x, y: -F.forward.y, z: -F.forward.z };
  let minStamina = 100;
  const step0 = r.step;
  r.step = (w, b) => { step0(w, b); minStamina = Math.min(minStamina, r.s.stamina); };
  for (const [top, next] of [[4.2, F.at(0.4, 4.2, 4.4)], [8.0, F.at(0.4, 8.0, 2.7)], [11.6, null]] as const) {
    let k = 0;
    while (k++ < 900 && !(r.s.grounded && r.s.traversal === TraversalMode.NONE && radial(r.s.pos) > radial(F.at(0, top, 0)) - 0.3)) r.step(into, r.s.grounded && k % 40 < 3 ? InputButton.JUMP : 0);
    while (r.s.stamina < 60) r.step({ x: 0, y: 0, z: 0 }, 0);
    if (next) for (let i = 0; i < 240 && v3len(tan({ x: next.x - r.s.pos.x, y: next.y - r.s.pos.y, z: next.z - r.s.pos.z }, v3normalize(r.s.pos))) > 0.4; i++) r.step(dirTo(r.s, next), 0);
  }
  console.log(`rota B (escalada, descansando até 60 de stamina): ${r.t.toFixed(1)} s, stamina mínima ${minStamina.toFixed(0)}, cume ${radial(r.s.pos) > SUMMIT - 0.3 ? 'sim' : 'NÃO'}`);
  r.done();
}
// Route C: jump into the west updraft holding jump, steer east once over the summit.
{
  const r = runner(F.at(-10.9, 0, -0.8));
  while (r.t < 10 && radial(r.s.pos) < SUMMIT + 2.5) r.step({ x: 0, y: 0, z: 0 }, InputButton.JUMP);
  if (process.env.DBG) console.log('  topo da corrente', radial(r.s.pos).toFixed(2), 'modo', r.s.traversal, 't', r.t.toFixed(1));
  while (r.t < 20 && !r.s.grounded) r.step(F.side, InputButton.JUMP);
  if (process.env.DBG) { const q = { x: r.s.pos.x - F.base.x, y: r.s.pos.y - F.base.y, z: r.s.pos.z - F.base.z }; console.log('  pousou', v3dot(q, F.side).toFixed(1), (radial(r.s.pos) - radial(F.base)).toFixed(2), v3dot(q, F.forward).toFixed(1)); }
  console.log(`rota C (corrente + travessia): ${r.t.toFixed(1)} s, cume ${radial(r.s.pos) > SUMMIT - 0.3 ? 'sim' : 'NÃO'}`);
  r.done();
}

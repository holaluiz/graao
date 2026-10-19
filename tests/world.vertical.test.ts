/**
 * The vertical world on the real planet (docs/world/SERRA_DO_MIRANTE.md, FLOATING_ISLANDS.md): the Serra do Mirante's
 * three routes to the summit and the Arquipélago dos Sinos, driven through the real CharacterMotor, Rapier and map — the
 * same code the authoritative server runs. Every route is played with plain inputs (wish, jump, sprint), like a player.
 */
import { describe, expect, it } from 'vitest';
import { CharacterMotor, InteractiveSystem, buildNavGraph, createCharacterState, createGameWorld, decodeInput, frameOfPlacement, newInput, type CharacterBody, type CharacterState } from '@graao/game-core';
import { GRAAO_MAP, PLANET, TraversalMode } from '@graao/game-data';
import { AIM_SCALE, InputButton, WISH_SCALE, v3dot, v3len, v3normalize, type Vec3 } from '@graao/shared';
import { BotNavigator } from '../apps/server/src/sim/BotNav';
import { botIntent } from '../apps/server/src/sim/BotBrain';

const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);
const DT = 1 / 60;
const R = PLANET.radius;

const byId = (id: string) => {
  const p = GRAAO_MAP.placements.find((q) => q.id === id);
  if (!p) throw new Error(`sem ${id}`);
  return p;
};
/** The frame the layout builds for a map placement (massif, islands). */
const massif = frameOfPlacement(world.terrain, byId('vert-serra-macico'));
const sino = frameOfPlacement(world.terrain, byId('vert-ilha-do-sino'));
const oratorio = frameOfPlacement(world.terrain, byId('vert-ilha-do-oratorio'));
const torre = frameOfPlacement(world.terrain, byId('vert-ilha-da-torre'));
const radial = (p: Vec3) => v3len(p) - R;
const SUMMIT = radial(massif.at(0, 11.6, 0));

interface Runner {
  s: CharacterState;
  body: CharacterBody;
  seen: Set<number>;
}

/** A character standing (feet) at world point `p`, facing `toward`. */
function spawn(p: Vec3, toward?: Vec3): Runner {
  const up = v3normalize(p);
  const f = toward ? flat(toward, up) : flat({ x: -up.y, y: up.x, z: 0 }, up);
  const s = createCharacterState({ x: p.x + up.x * 0.05, y: p.y + up.y * 0.05, z: p.z + up.z * 0.05 }, f);
  const r = { s, body: motor.createBody(s), seen: new Set<number>() };
  step(r, 0.3, () => ({ wish: null, buttons: 0 }));
  return r;
}
/** The tangent part of `v` at local up `up` (its length is the horizontal distance). */
function tangent(v: Vec3, up: Vec3): Vec3 {
  const k = v3dot(v, up);
  return { x: v.x - up.x * k, y: v.y - up.y * k, z: v.z - up.z * k };
}
/** The tangent direction of `v` (unit; zero when `v` is vertical). */
function flat(v: Vec3, up: Vec3): Vec3 {
  const t = tangent(v, up);
  const l = v3len(t);
  return l < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: t.x / l, y: t.y / l, z: t.z / l };
}
const inp = newInput();
/** Steps for up to `seconds`, the control function picking wish (a world vector, flattened) and buttons each step. */
function step(r: Runner, seconds: number, ctl: (s: CharacterState, i: number) => { wish: Vec3 | null; buttons: number }, until?: (s: CharacterState) => boolean): boolean {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const c = ctl(r.s, i);
    const up = v3normalize(r.s.pos);
    inp.wish = c.wish ? flat(c.wish, up) : { x: 0, y: 0, z: 0 };
    inp.buttons = c.buttons;
    motor.step(r.body, r.s, inp, DT);
    r.seen.add(r.s.traversal);
    expect(Number.isFinite(r.s.pos.x + r.s.pos.y + r.s.pos.z)).toBe(true);
    if (until?.(r.s)) return true;
  }
  return false;
}
/** Walks toward a world point until within `reach` m (horizontally); jumps when stuck. */
function walkTo(r: Runner, target: Vec3, reach = 0.6, seconds = 12): boolean {
  let last = { ...r.s.pos };
  let stuck = 0;
  return step(r, seconds, (s, i) => {
    if (i % 30 === 0) {
      stuck = v3len({ x: s.pos.x - last.x, y: s.pos.y - last.y, z: s.pos.z - last.z }) < 0.2 ? stuck + 1 : 0;
      last = { ...s.pos };
    }
    return { wish: { x: target.x - s.pos.x, y: target.y - s.pos.y, z: target.z - s.pos.z }, buttons: stuck > 1 && i % 30 < 3 ? InputButton.JUMP : 0 };
  }, (s) => {
    const d = { x: target.x - s.pos.x, y: target.y - s.pos.y, z: target.z - s.pos.z };
    return v3len(tangent(d, v3normalize(s.pos))) < reach && Math.abs(v3dot(d, v3normalize(s.pos))) < 1.2;
  });
}
const done = (r: Runner) => r.body.dispose();

describe('Serra do Mirante', () => {
  it('route A: the trail ramps lead from the foot to the summit without jumping, climbing or gliding', () => {
    const r = spawn(massif.at(10.2, 0, 9.0));
    const path = [massif.at(8.9, 0, 7.0), massif.at(8.9, 4.2, -5.6), massif.at(-7.0, 4.2, -5.4), massif.at(-7.0, 4.2, -4.5), massif.at(-7.0, 8.0, 4.0), massif.at(-5.2, 8.0, 2.9), massif.at(3.6, 8.0, 2.9), massif.at(3.6, 11.6, -3.6), massif.at(1.8, 11.6, -3.2), massif.at(0, 11.6, 0)];
    for (const p of path) expect(walkTo(r, p), `trilha até ${radial(p).toFixed(1)} m`).toBe(true);
    expect(r.s.grounded).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(SUMMIT - 0.3);
    expect([...r.seen]).toEqual([TraversalMode.NONE]);
    done(r);
  });

  it('route B: three climbable faces with the terraces as rest ledges lead to the summit', () => {
    const r = spawn(massif.at(0.4, 0, 7.6), massif.forward);
    const into = { x: -massif.forward.x, y: -massif.forward.y, z: -massif.forward.z };
    for (const [face, top] of [[1, 4.2], [2, 8.0], [3, 11.6]] as const) {
      // Jump at the face and push up it until standing on the terrace above, then rest.
      const ok = step(r, 12, (s, i) => ({ wish: into, buttons: s.grounded && i % 40 < 3 ? InputButton.JUMP : 0 }), (s) => s.grounded && s.traversal === TraversalMode.NONE && radial(s.pos) > radial(massif.at(0, top, 0)) - 0.3);
      expect(ok, `paredão ${face}`).toBe(true);
      expect(r.seen.has(TraversalMode.CLIMB)).toBe(true);
      step(r, 2.5, () => ({ wish: null, buttons: 0 }));
      expect(r.s.stamina).toBeGreaterThan(60);
      if (face < 3) walkTo(r, massif.at(0.4, top, face === 1 ? 4.4 : 2.7), 0.4, 4);
    }
    expect(radial(r.s.pos)).toBeGreaterThan(SUMMIT - 0.3);
    done(r);
  });

  it('route C: the updraft on the west side and the corrente across carry a glider onto the summit', () => {
    const r = spawn(massif.at(-10.9, 0, -0.8), massif.side);
    const east = massif.side;
    // Jump into the column and hold jump: the kite opens and rises; then steer east across to the summit.
    const up = step(r, 8, () => ({ wish: null, buttons: InputButton.JUMP }), (s) => radial(s.pos) > SUMMIT + 2.5);
    expect(up, 'subiu na corrente').toBe(true);
    expect(r.s.traversal).toBe(TraversalMode.GLIDE);
    const landed = step(r, 6, () => ({ wish: east, buttons: InputButton.JUMP }), (s) => s.grounded);
    expect(landed).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(SUMMIT - 0.3);
    done(r);
  });
});

describe('Arquipélago dos Sinos', () => {
  it('the Corrente do Sino lifts a glider beside the island, which lands and walks on it', () => {
    const r = spawn(sino.at(-7.9, 0, 0.6), sino.side);
    const top = radial(sino.base);
    const up = step(r, 8, () => ({ wish: null, buttons: InputButton.JUMP }), (s) => radial(s.pos) > top + 2.5);
    expect(up).toBe(true);
    const landed = step(r, 5, () => ({ wish: sino.side, buttons: InputButton.JUMP }), (s) => s.grounded);
    expect(landed).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(top - 0.2);
    expect(walkTo(r, sino.at(1.5, 0, 1.5), 0.5, 6)).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(top - 0.2);
    done(r);
  });

  it('the rope bridge leads to the Oratório and the floating stones up to the Ilha da Torre', () => {
    const r = spawn(sino.at(3.5, 0, 0.3), sino.side);
    expect(walkTo(r, oratorio.at(0, 0, 0), 0.6, 10)).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(radial(oratorio.base) - 0.3);
    // Jump from stone to stone (aim at each in turn) and pull up onto the Ilha da Torre.
    const stones = GRAAO_MAP.placements.filter((p) => /^vert-pedra-\d$/.test(p.id)).map((p) => frameOfPlacement(world.terrain, p).base);
    walkTo(r, oratorio.at(-0.6, 0, -3.0), 0.4, 4);
    for (const st of stones) {
      const ok = step(r, 4, (s, i) => ({ wish: { x: st.x - s.pos.x, y: st.y - s.pos.y, z: st.z - s.pos.z }, buttons: s.grounded && i > 4 && i % 25 < 3 ? InputButton.JUMP : 0 }), (s) => s.grounded && Math.abs(radial(s.pos) - radial(st)) < 0.2 && v3len(tangent({ x: st.x - s.pos.x, y: st.y - s.pos.y, z: st.z - s.pos.z }, v3normalize(s.pos))) < 0.6);
      expect(ok, `pedra a ${radial(st).toFixed(1)} m`).toBe(true);
    }
    const t = torre.at(0, 0, 0);
    const up = step(r, 4, (s, i) => ({ wish: { x: t.x - s.pos.x, y: t.y - s.pos.y, z: t.z - s.pos.z }, buttons: s.grounded && i % 30 < 3 ? InputButton.JUMP : 0 }), (s) => s.grounded && radial(s.pos) > radial(torre.base) - 0.2);
    expect(up, 'subiu na Ilha da Torre').toBe(true);
    done(r);
  });

  it('the Ilha do Sino bell wakes the updraft to the Ilha da Torre; the summit bell, the corrente to the island', () => {
    const events: unknown[] = [];
    const system = new InteractiveSystem({ physics: world.physics, layout: world.layout, actors: () => [], emit: (e) => events.push(e) });
    motor.windActive = system.windsOn;
    const bells = world.layout.bells ?? [];
    const bIsland = bells.find((b) => b.mapId === 'vert-ilha-do-sino')!;
    const bSummit = bells.find((b) => b.mapId === 'vert-serra-macico')!;
    expect(bIsland).toBeTruthy();
    expect(bSummit).toBeTruthy();
    // Silent: the column beside the island's north edge does nothing.
    const r = spawn(sino.at(2.6, 0, -3.4), { x: -sino.forward.x, y: -sino.forward.y, z: -sino.forward.z });
    expect(system.ring({ index: 0, state: r.s }, bIsland.id, 1000)).toBe(0);
    const north = { x: -sino.forward.x, y: -sino.forward.y, z: -sino.forward.z };
    // Run off the north edge into the column with jump held, ride it up, then steer to the Ilha da Torre.
    step(r, 2, () => ({ wish: north, buttons: InputButton.JUMP }), (s) => !s.grounded && v3len(tangent({ x: s.pos.x - sino.at(2.6, 0, -7.6).x, y: s.pos.y - sino.at(2.6, 0, -7.6).y, z: s.pos.z - sino.at(2.6, 0, -7.6).z }, v3normalize(s.pos))) < 1.0);
    const rose = step(r, 8, () => ({ wish: null, buttons: InputButton.JUMP }), (s) => radial(s.pos) > radial(torre.base) + 1.0);
    expect(rose, 'subiu na corrente do sino').toBe(true);
    const t = torre.at(0, 0, 0);
    const landed = step(r, 4, (s) => ({ wish: { x: t.x - s.pos.x, y: t.y - s.pos.y, z: t.z - s.pos.z }, buttons: InputButton.JUMP }), (s) => s.grounded);
    expect(landed).toBe(true);
    expect(radial(r.s.pos)).toBeGreaterThan(radial(torre.base) - 0.2);
    done(r);
    // The summit bell: from the summit's east edge a glide reaches the Ilha do Sino only while it rings.
    const glide = (ringing: boolean) => {
      system.reset();
      if (ringing) system.ring({ index: 1, state: { pos: { ...bSummit.position, x: bSummit.position.x - bSummit.up.x * 2, y: bSummit.position.y - bSummit.up.y * 2, z: bSummit.position.z - bSummit.up.z * 2 } } }, bSummit.id, 5000);
      const g = spawn(massif.at(1.9, 11.6, 1.2), massif.side);
      const target = sino.at(-3.0, 0, 0);
      step(g, 1.0, (s) => ({ wish: { x: target.x - s.pos.x, y: target.y - s.pos.y, z: target.z - s.pos.z }, buttons: InputButton.JUMP }), (s) => !s.grounded && radial(s.pos) < SUMMIT - 0.5);
      step(g, 6, (s) => ({ wish: { x: target.x - s.pos.x, y: target.y - s.pos.y, z: target.z - s.pos.z }, buttons: InputButton.JUMP }), (s) => s.grounded);
      const onIsland = radial(g.s.pos) > radial(sino.base) - 0.3;
      done(g);
      return onIsland;
    };
    expect(glide(true), 'com o sino do cume').toBe(true);
    expect(glide(false), 'sem o sino do cume').toBe(false);
    motor.windActive = null;
  });
});

describe('bots in the vertical world (docs/world/VERTICAL_BOT_NAVIGATION.md)', () => {
  const nav = buildNavGraph(world);

  it('a bot walks route A from the foot of the massif to the summit, with no traversal of its own', () => {
    const from = massif.at(4.0, 0, 11.0);
    const goal = massif.at(0, 11.6, 0);
    const up = v3normalize(from);
    // Bots start no traversal (the room gives them traversalCaps 0): only walking, the ramps and the jumps of BotBrain.
    const s = createCharacterState({ x: from.x + up.x * 0.3, y: from.y + up.y * 0.3, z: from.z + up.z * 0.3 }, massif.forward);
    s.traversalCaps = 0;
    const body = motor.createBody(s);
    const navigator = new BotNavigator();
    const seen = new Set<number>();
    let arrived = false;
    for (let i = 0; i < 90 * 60 && !arrived; i++) {
      const now = 1000 + (i * 1000) / 60;
      const step = s.grounded ? navigator.next(nav, s.pos, goal, now) : { point: null, stuck: false, left: 0 };
      const intent = botIntent(s, undefined, 1, now, step.stuck, step.point ?? goal, false);
      decodeInput([i, Math.round(intent.wish.x * WISH_SCALE), Math.round(intent.wish.y * WISH_SCALE), Math.round(intent.wish.z * WISH_SCALE), Math.round(intent.aim.x * AIM_SCALE), Math.round(intent.aim.y * AIM_SCALE), Math.round(intent.aim.z * AIM_SCALE), intent.buttons], inp);
      motor.step(body, s, inp, DT);
      seen.add(s.traversal);
      arrived = s.grounded && radial(s.pos) > SUMMIT - 0.4 && v3len(tangent({ x: goal.x - s.pos.x, y: goal.y - s.pos.y, z: goal.z - s.pos.z }, v3normalize(s.pos))) < 2.5;
    }
    body.dispose();
    expect(arrived).toBe(true);
    expect([...seen]).toEqual([TraversalMode.NONE]);
  }, 60000);

  it('the islands are not in the walking graph of the bots (no link a bot could not follow)', () => {
    const top = nav.nearest(sino.at(0, 0, 0), 2.0);
    const ground = nav.nearest(massif.at(4.0, 0, 11.0), 3.0);
    expect(ground).toBeGreaterThanOrEqual(0);
    // Either no node stands on the island, or none joins it to the ground.
    expect(top < 0 || nav.route(ground, top) === null).toBe(true);
  });
});

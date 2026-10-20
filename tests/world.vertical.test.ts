/**
 * The vertical world on the real planet (docs/world/SERRA_DO_MIRANTE.md, FLOATING_ISLANDS.md): the Serra do Mirante's
 * three routes to the summit and the Arquipélago dos Sinos, driven through the real CharacterMotor, Rapier and map — the
 * same code the authoritative server runs. Every route is played with plain inputs (wish, jump, sprint), like a player.
 */
import { describe, expect, it } from 'vitest';
import { CharacterMotor, InteractiveSystem, TraversalCap, buildNavGraph, createCharacterState, createGameWorld, decodeInput, frameOfPlacement, kitShape, newInput, type CharacterBody, type CharacterState } from '@graao/game-core';
import { GRAAO_MAP, KIT_PREFABS, PLANET, TraversalMode } from '@graao/game-data';
import { AIM_SCALE, InputButton, WISH_SCALE, v3dot, v3len, v3normalize, type Vec3 } from '@graao/shared';
import { BotNavigator, type NavContext } from '../apps/server/src/sim/BotNav';
import { botDropAhead, botIntent, botLinkIntent } from '../apps/server/src/sim/BotBrain';

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

describe('rock looks (kitVertical: relief, bands, convex hulls)', () => {
  const vertical = Object.values(KIT_PREFABS).filter((p) => p.category === 'vertical');

  it('a hull rock collides with the very points it is drawn from; relief and bands never change a collider', () => {
    let hulls = 0;
    for (const prefab of vertical) {
      const solid = prefab.parts.filter((p) => (p.solid ?? 'full') !== 'none');
      const colliders = kitShape(prefab).colliders;
      expect(colliders).toHaveLength(solid.length);
      solid.forEach((p, i) => {
        const c = colliders[i]!;
        if (p.shape === 'hull') {
          hulls++;
          expect(c.type).toBe('hull');
          const pts = c.type === 'hull' ? c.points : [];
          expect(pts).toHaveLength(p.pts!.length);
          // Unrotated parts: the collider's points are the part's, moved to its centre.
          if (!p.rx && !p.ry && !p.rz) pts.forEach((v, k) => expect(v).toBeCloseTo(p.pts![k]! + [p.x, p.y, p.z][k % 3]!, 9));
          for (let k = 0; k < p.pts!.length; k++) expect(Math.abs(p.pts![k]!)).toBeLessThanOrEqual([p.hx, p.hy, p.hz][k % 3]! + 1e-9);
        }
        if (p.relief || p.bands) {
          if (p.shape === 'box') expect(c).toMatchObject({ type: 'cuboid', hx: p.hx, hy: p.hy, hz: p.hz });
          expect(p.relief ?? 0).toBeLessThanOrEqual(0.1);
        }
      });
    }
    expect(hulls).toBeGreaterThanOrEqual(12);
  });

  it('the rock under an island stays inside 0.8 of its slab: whoever hangs from the edge clears it', () => {
    for (const [id, hw, hd] of [['ilha-flutuante-g', 5.5, 4.5], ['ilha-flutuante-m', 3.5, 3.5], ['ilha-flutuante-p', 2.5, 2.5]] as const) {
      const rock = KIT_PREFABS[id]!.parts.find((p) => p.shape === 'hull')!;
      for (let k = 0; k < rock.pts!.length; k += 3) {
        expect(Math.abs(rock.x + rock.pts![k]!), id).toBeLessThanOrEqual(hw * 0.8 + 1e-9);
        expect(Math.abs(rock.z + rock.pts![k + 2]!), id).toBeLessThanOrEqual(hd * 0.8 + 1e-9);
        expect(rock.y + rock.pts![k + 1]!, id).toBeLessThanOrEqual(-0.9 + 1e-9);
      }
    }
  });

  it('the crest behind the massif stands flush with the back terrace (no crevice) and leaves gaps open', () => {
    // Out from the back terrace (tier 1's top, 4.2 m), 1 m over it, toward the back (−Z in the massif's frame).
    const back = { x: -massif.forward.x, y: -massif.forward.y, z: -massif.forward.z };
    const from = (x: number) => massif.at(x, 5.2, -5.4);
    const blade = world.physics.castRay(from(-1.6), back, 3);
    expect(blade, 'a lâmina do meio').not.toBeNull();
    expect(blade!.toi).toBeGreaterThan(0.55);
    expect(blade!.toi).toBeLessThan(0.65);
    // Between the blades the terrace's edge stays open to the drop.
    expect(world.physics.castRay(from(-4.15), back, 3), 'vão entre lâminas').toBeNull();
    expect(world.physics.castRay(from(0.8), back, 3), 'vão entre lâminas').toBeNull();
    // The blades never reach over the terrace: nothing in its strip, at any height up to the summit.
    for (const p of KIT_PREFABS['crista-mirante']!.parts) for (let k = 2; k < p.pts!.length; k += 3) expect(p.z + p.pts![k]!).toBeLessThanOrEqual(-6 + 1e-9);
  });

  it('boulders on the summit and the terrace sit on the rock, no point of them floating', () => {
    const tops: Record<string, number> = { 'macico-mirante-cume': 11.6, 'macico-mirante-meio': 4.2 };
    for (const [id, top] of Object.entries(tops)) {
      for (const p of KIT_PREFABS[id]!.parts.filter((q) => q.shape === 'hull')) {
        let low = Infinity;
        for (let k = 1; k < p.pts!.length; k += 3) low = Math.min(low, p.y + p.pts![k]!);
        expect(low, id).toBeLessThanOrEqual(top + 1e-9);
      }
    }
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

  it('the islands are off the walking graph; only traversal links join them to the ground', () => {
    const top = nav.nearest(sino.at(1.5, 0, 1.5), 2.0);
    const ground = nav.nearest(massif.at(4.0, 0, 11.0), 3.0);
    expect(ground).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    // On foot no way joins them (plain queries never take a link)...
    expect(nav.route(ground, top)).toBeNull();
    // ...with the links a bot can do there is a way up (the Corrente do Sino) and a way down (a glide).
    const all = () => true;
    expect(nav.route(ground, top, undefined, all)).not.toBeNull();
    expect(nav.route(top, ground, undefined, all)).not.toBeNull();
    expect(nav.stats.links).toBe(GRAAO_MAP.traversalLinks!.length);
    // Every map link landed on two nodes; corrente links know their wind, and the Torre's is an event wind.
    expect(nav.links.find((l) => l.id === 'vert-lk-corrente-torre')!.event).toBe(true);
    expect(nav.links.find((l) => l.id === 'vert-lk-corrente-sino')!.event).toBe(false);
    expect(nav.links.every((l) => l.kind !== 'corrente' || l.wind >= 0)).toBe(true);
  });

  /** Report of a bot run: where it ended, what it went through, the links it set out on and the ones it gave up. */
  interface BotRun {
    arrived: boolean;
    seen: Set<number>;
    links: string[];
    blocked: string[];
    /** Bells the bot rang (map placement ids). */
    rang: string[];
    /** Steps the room's edge guard stopped (a walk toward a drop no walk takes). */
    edges: number;
    seconds: number;
    pos: Vec3;
  }
  /**
   * A bot driven like the server drives one (GraaoMatchRoom.updateBots): the navigator plans with the bot's traversal,
   * the intent is computed at the room's 20 Hz and fed to the motor at 60 Hz, a link's intent replaces the walk's, and
   * the motor may start a traversal only while a link is under way (traversalCaps = the navigator's caps).
   */
  /** The point a character stands on under (or just over) `p`: frame points away from a frame's centre float (d²/2R). */
  const footing = (p: Vec3, lift = 0): Vec3 => {
    const u = v3normalize(p);
    const hit = world.physics.castRay({ x: p.x + u.x * 1.5, y: p.y + u.y * 1.5, z: p.z + u.z * 1.5 }, { x: -u.x, y: -u.y, z: -u.z }, 4)!;
    const k = 1.5 - hit.toi + lift;
    return { x: p.x + u.x * k, y: p.y + u.y * k, z: p.z + u.z * k };
  };
  /**
   * With `system` the bells are real: the bot may ring them (validated by the InteractiveSystem, as the room does), and
   * their event winds blow in the motor while they ring.
   */
  function runBot(from: Vec3, to: Vec3, o: { caps?: number; windOn?: (w: number) => boolean; seconds?: number; facing?: Vec3; system?: InteractiveSystem } = {}): BotRun {
    // Standing on whatever is under `from` (a terrace, an island, the ground), as a bot that walked there; the goal is
    // the footing under `to`.
    const goal = footing(to);
    const s = createCharacterState(footing(from, 0.04), flat(o.facing ?? massif.forward, v3normalize(from)));
    s.traversalCaps = 0;
    const body = motor.createBody(s);
    const navigator = new BotNavigator();
    const run: BotRun = { arrived: false, seen: new Set(), links: [], blocked: [], rang: [], edges: 0, seconds: 0, pos: s.pos };
    const system = o.system;
    const bells = system?.bells.map((b) => ({ id: b.id, pos: b.position, winds: world.physics.winds.filter((w) => w.trigger === b.mapId).map((w) => w.index) }));
    const windOn = system ? (w: number) => system.windsOn.has(w) : o.windOn;
    if (system) motor.windActive = system.windsOn;
    const arrived = (st: CharacterState) => st.grounded && v3len(tangent({ x: goal.x - st.pos.x, y: goal.y - st.pos.y, z: goal.z - st.pos.z }, v3normalize(st.pos))) < 2.5 && Math.abs(radial(st.pos) - radial(goal)) < 1.2;
    let intent = { wish: { x: 0, y: 0, z: 0 }, aim: s.facing, buttons: 0 };
    const total = Math.round((o.seconds ?? 90) * 60);
    for (let i = 0; i < total && !run.arrived; i++) {
      const now = 1000 + (i * 1000) / 60;
      if (i % 3 === 0) {
        const ctx: NavContext = { caps: o.caps ?? TraversalCap.ALL, stamina: s.stamina, grounded: s.grounded, traversal: s.traversal, windOn, bells };
        const walking = s.grounded || s.swimming;
        const step = walking || navigator.linking ? navigator.next(nav, s.pos, goal, now, ctx) : { point: null, stuck: false, left: 0 };
        const base = botIntent(s, undefined, 1, now, step.stuck, step.point ?? goal, false);
        intent = { wish: base.wish, aim: base.aim, buttons: base.buttons };
        if (step.link || s.traversal === TraversalMode.CLIMB || s.traversal === TraversalMode.HANG) Object.assign(intent, botLinkIntent(s, step, world.physics.winds));
        if (s.grounded && !navigator.linking && botDropAhead(world.physics, s.pos, intent.wish)) {
          intent.wish = { x: 0, y: 0, z: 0 };
          navigator.edge(now);
          run.edges++;
        }
        if (step.link && run.links.at(-1) !== step.link.id) run.links.push(step.link.id);
        if (system && step.ring !== undefined && system.bellNear(s.pos) === step.ring && system.ring({ index: 0, state: s }, step.ring, now) === 0) run.rang.push(system.bells.find((b) => b.id === step.ring)!.mapId);
        s.traversalCaps = navigator.caps;
      }
      system?.update(now);
      decodeInput([i, Math.round(intent.wish.x * WISH_SCALE), Math.round(intent.wish.y * WISH_SCALE), Math.round(intent.wish.z * WISH_SCALE), Math.round(intent.aim.x * AIM_SCALE), Math.round(intent.aim.y * AIM_SCALE), Math.round(intent.aim.z * AIM_SCALE), intent.buttons], inp);
      motor.step(body, s, inp, DT);
      run.seen.add(s.traversal);
      expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true);
      run.arrived = arrived(s);
      run.seconds = i / 60;
    }
    run.blocked = nav.links.filter((l) => navigator.isBlocked(l.id, 1000 + run.seconds * 1000)).map((l) => l.id);
    run.pos = { ...s.pos };
    body.dispose();
    if (system) motor.windActive = null;
    return run;
  }
  const summary = (r: BotRun) => `chegou ${r.arrived} em ${r.seconds.toFixed(1)} s; links ${r.links.join(' → ') || '—'}; sinos ${r.rang.join(', ') || '—'}; paradas na borda ${r.edges}; bloqueados ${r.blocked.join(', ') || '—'}; termina a ${radial(r.pos).toFixed(1)} m`;

  it('a bot climbs route B: the three faces of the massif, with the terraces as rests', () => {
    const r = runBot(massif.at(0.4, 0, 9.5), massif.at(0, 11.6, 0), { caps: TraversalCap.LEDGE | TraversalCap.CLIMB, seconds: 60 });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.links).toEqual(['vert-lk-paredao-1', 'vert-lk-paredao-2', 'vert-lk-paredao-3']);
    expect(r.seen.has(TraversalMode.CLIMB)).toBe(true);
    expect(r.seen.has(TraversalMode.GLIDE)).toBe(false);
    expect(r.blocked).toEqual([]);
  }, 60000);

  it('a bot rides route C: the west updraft and the corrente across onto the summit', () => {
    const r = runBot(massif.at(-10.0, 0, 4.0), massif.at(0, 11.6, 0), { caps: TraversalCap.GLIDE, seconds: 60 });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.links).toEqual(['vert-lk-corrente-mirante']);
    expect(r.seen.has(TraversalMode.GLIDE)).toBe(true);
    expect(r.seen.has(TraversalMode.CLIMB)).toBe(false);
  }, 60000);

  it('a bot takes the Corrente do Sino up to the island, walks across it and over the bridge to the Oratório', () => {
    const r = runBot(massif.at(10.2, 0, 9.0), oratorio.at(0.3, 0, -0.2), { seconds: 70 });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.links).toEqual(['vert-lk-corrente-sino']);
    expect(r.blocked).toEqual([]);
  }, 70000);

  it('a bot on the island heading for the ground (the Tormenta, a fight) glides down, then walks', () => {
    const r = runBot(sino.at(1.5, 0, 1.5), massif.at(10.2, 0, 9.0), { seconds: 60, facing: sino.forward });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.links.length, summary(r)).toBe(1);
    expect(r.links[0]).toMatch(/^vert-lk-planagem-/);
    expect(r.seen.has(TraversalMode.GLIDE)).toBe(true);
  }, 60000);

  it('a bot jumps the floating stones from the Oratório up to the Ilha da Torre (its bell silent)', () => {
    const r = runBot(oratorio.at(0.3, 0, -0.2), torre.at(0.6, 0, 0.9), { seconds: 60, windOn: () => false, facing: oratorio.forward });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.links[0]).toBe('vert-lk-salto-0');
    expect(r.links.at(-1)).toBe('vert-lk-salto-torre');
    expect(r.blocked).toEqual([]);
  }, 60000);

  it('a bot on the Ilha do Sino heading for the Ilha da Torre rings the island bell and rides its updraft', () => {
    const system = new InteractiveSystem({ physics: world.physics, layout: world.layout, actors: () => [], emit: () => {} });
    const r = runBot(sino.at(1.5, 0, 1.5), torre.at(0.6, 0, 0.9), { seconds: 60, facing: sino.forward, system });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.rang, summary(r)).toEqual(['vert-ilha-do-sino']);
    // The bell's updraft instead of the bridge, the Oratório and six jumps over the stones.
    expect(r.links, summary(r)).toEqual(['vert-lk-corrente-torre']);
    expect(r.seen.has(TraversalMode.GLIDE)).toBe(true);
    expect(r.blocked).toEqual([]);
  }, 60000);

  it('a bot on the summit heading for the Ilha do Sino rings the summit bell and glides across on its corrente', () => {
    const system = new InteractiveSystem({ physics: world.physics, layout: world.layout, actors: () => [], emit: () => {} });
    const r = runBot(massif.at(0, 11.6, 0), sino.at(-1.0, 0, 2.6), { seconds: 60, system });
    expect(r.arrived, summary(r)).toBe(true);
    expect(r.rang, summary(r)).toEqual(['vert-serra-macico']);
    expect(r.links, summary(r)).toEqual(['vert-lk-corrente-cume-ilha']);
    expect(r.blocked).toEqual([]);
    // With no bell to ring the same bot goes the long way: glide down, walk to the Corrente do Sino, ride it up.
    const ground = runBot(massif.at(0, 11.6, 0), sino.at(-1.0, 0, 2.6), { seconds: 90, windOn: () => false });
    expect(ground.arrived, summary(ground)).toBe(true);
    expect(ground.links, summary(ground)).toEqual(['vert-lk-planagem-cume', 'vert-lk-corrente-sino']);
  }, 120000);

  it('on foot a bot stops at an island edge instead of walking off it (only a link takes it down)', () => {
    // Straight at a point on the ground beyond the south edge, as a bot fighting or heading for a goal with no plan.
    const target = world.terrain.surfaceAt(v3normalize(sino.at(0.5, 0, 22)));
    const walk = (guard: boolean) => {
      const r = spawn(sino.at(0.5, 0, 1.5), sino.forward);
      let stops = 0;
      step(r, 4, (s) => {
        const wish = { x: target.x - s.pos.x, y: target.y - s.pos.y, z: target.z - s.pos.z };
        if (guard && s.grounded && botDropAhead(world.physics, s.pos, wish)) {
          stops++;
          return { wish: null, buttons: 0 };
        }
        return { wish, buttons: 0 };
      });
      const h = radial(r.s.pos);
      done(r);
      return { h, stops };
    };
    const guarded = walk(true);
    expect(guarded.stops).toBeGreaterThan(0);
    expect(guarded.h).toBeGreaterThan(radial(sino.base) - 0.5);
    // The same walk without the guard goes over the edge.
    expect(walk(false).h).toBeLessThan(radial(sino.base) - 5);
    // A step down the graph takes (a terrace, under 3,4 m) is not stopped: from the summit's front edge to tier 2.
    expect(botDropAhead(world.physics, massif.at(0, 11.6, 1.6), massif.forward)).toBe(false);
  });

  it('without traversal a bot plans no link: it walks route A (and never reaches an island)', () => {
    expect(nav.plan(massif.at(4.0, 0, 11.0), sino.at(1.5, 0, 1.5))).toBeNull();
    const summit = nav.plan(massif.at(4.0, 0, 11.0), massif.at(0, 11.6, 0));
    expect(summit).not.toBeNull();
    expect(summit!.links.every((l) => l === null)).toBe(true);
  });
});

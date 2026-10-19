/**
 * Bots find their way through the Minas Gerais planet (docs/world/WORLD_DESIGN.md, "Bots"): the navigation graph
 * (game-core nav.ts) is built from the real terrain and colliders, and a bot — the server's own BotNavigator and
 * botIntent driving the real character motor — walks from one point of interest to another: into the chapel, up to the
 * sobrado's upper floor, over the viaduct, into the market, out to the island over the footbridge (never through the
 * lake), up the cleft behind the waterfall, between regions.
 */
import { describe, expect, it } from 'vitest';
import { KIT, PLANET } from '@graao/game-data';
import { CharacterMotor, buildNavGraph, createCharacterState, createGameWorld, decodeInput, newInput, placementToWorld, waterDepth, type Placement } from '@graao/game-core';
import { AIM_SCALE, WISH_SCALE, v3dot, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';
import { BotNavigator } from '../apps/server/src/sim/BotNav';
import { botIntent } from '../apps/server/src/sim/BotBrain';
import { regionPlane } from '../tools/world/author';

const world = await createGameWorld({ includeVisual: false });
const nav = buildNavGraph(world);
const motor = new CharacterMotor(world.physics);
const R = PLANET.radius;
const sink = { placements: [], chestSpots: [], waypoints: [], trails: [] };
const vila = regionPlane(sink, 'vila', { lat: 8, lon: 0 });
const bairro = regionPlane(sink, 'bairro', { lat: -12.06, lon: -18.02 }, 42.8);
const lago = regionPlane(sink, 'lago', { lat: -30, lon: -38 }, 50);
const bosque = regionPlane(sink, 'bosque', { lat: 34, lon: 62 }, 0);

function piece(mapId: string, prefix = ''): Placement {
  const p = world.layout.placements.find((q) => q.mapId === mapId && (q.prefab ?? '').startsWith(prefix));
  if (!p) throw new Error(`no placement ${mapId} ${prefix}`);
  return p;
}
const at = (p: Placement, x: number, y: number, z: number) => placementToWorld(p, x, y, z, { x: 0, y: 0, z: 0 });
const heightOf = (p: Placement, q: Vec3) => v3dot({ x: q.x - p.position.x, y: q.y - p.position.y, z: q.z - p.position.z }, p.up);
const flatDistance = (a: Vec3, b: Vec3) => {
  const d = v3projectOnPlane({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v3normalize(a));
  return Math.hypot(d.x, d.y, d.z);
};

/**
 * A bot walks from `from` to `goal` the way the server drives it: BotNavigator picks the next path point, botIntent
 * turns it into a quantized input command, the motor moves the capsule. Returns how it went.
 */
function botWalk(from: Vec3, goal: Vec3, seconds: number, o: { reach?: number; level?: (q: Vec3) => boolean } = {}) {
  const up = v3normalize(from);
  const s = createCharacterState({ x: from.x + up.x * 0.3, y: from.y + up.y * 0.3, z: from.z + up.z * 0.3 }, v3normalize(v3projectOnPlane({ x: goal.x - from.x, y: goal.y - from.y, z: goal.z - from.z }, up)));
  const body = motor.createBody(s);
  const navigator = new BotNavigator();
  const inp = newInput();
  let wet = 0;
  let arrived = false;
  let t = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const now = 1000 + (i * 1000) / 60;
    if (flatDistance(s.pos, goal) < (o.reach ?? 1.0) && (!o.level || o.level(s.pos))) {
      arrived = true;
      t = i / 60;
      break;
    }
    const step = s.grounded || s.swimming ? navigator.next(nav, s.pos, goal, now) : { point: null, stuck: false, left: 0 };
    const intent = botIntent(s, undefined, 1, now, step.stuck, step.point ?? goal, false);
    // The same quantized command the room queues for a bot.
    decodeInput([i, Math.round(intent.wish.x * WISH_SCALE), Math.round(intent.wish.y * WISH_SCALE), Math.round(intent.wish.z * WISH_SCALE), Math.round(intent.aim.x * AIM_SCALE), Math.round(intent.aim.y * AIM_SCALE), Math.round(intent.aim.z * AIM_SCALE), intent.buttons], inp);
    motor.step(body, s, inp, 1 / 60);
    if (waterDepth(s.pos) > 0.6) wet++;
  }
  body.dispose();
  return { arrived, seconds: t, wet, end: s.pos };
}

describe('the navigation graph', () => {
  it('covers the planet with standing spots on the ground, the floors, the stairs and the decks', () => {
    const { stats } = nav;
    expect(stats.nodes).toBeGreaterThan(6000);
    expect(stats.largest / stats.nodes).toBeGreaterThan(0.95);
    expect(stats.raised).toBeGreaterThan(300);
    expect(stats.doors).toBeGreaterThan(30);
    expect(stats.drops).toBeGreaterThan(10);
    expect(stats.ms).toBeLessThan(15000);
  });

  it('is deterministic (same world, same graph)', () => {
    const again = buildNavGraph(world);
    expect(again.stats.nodes).toBe(nav.stats.nodes);
    expect(again.stats.edges).toBe(nav.stats.edges);
    expect(again.nodes[1234]!.pos).toEqual(nav.nodes[1234]!.pos);
  });

  it('plans between every pair of main regions without crossing deep water', () => {
    const centres = [vila.ground(2.6, -3), bairro.ground(-20, 0), lago.ground(-9.6, 24.0), bosque.ground(12.6, -12), vila.ground(0, 33.6)];
    for (const a of centres) for (const b of centres) {
      if (a === b) continue;
      const path = nav.path(a, b);
      expect(path, 'sem caminho').not.toBeNull();
      for (const q of path!) expect(waterDepth(q)).toBeLessThan(0.7);
    }
  });

  it('knows the elevated places: the sobrado upper floor, the viaduct deck, the lajes, the island footbridge', () => {
    const s = piece('vila-sobrado', 'fundacao');
    const via = piece('bairro-viaduto', 'viaduto-tabuleiro');
    const casa = piece('bairro-casa-laje', 'fundacao');
    for (const [name, p, f, h] of [['sobrado', at(s, 1.0, KIT.roofTop, -1.0), s, KIT.roofTop], ['viaduto', at(via, 0, KIT.roofTop, 0), via, KIT.roofTop], ['laje', at(casa, 0.5, KIT.roofTop, 0.5), casa, KIT.roofTop]] as const) {
      const n = nav.nearest(p, 3);
      expect(n, name).toBeGreaterThanOrEqual(0);
      expect(heightOf(f, nav.nodes[n]!.pos), name).toBeGreaterThan(h - 0.4);
      const path = nav.path(vila.ground(2.6, -3), nav.nodes[n]!.pos);
      expect(path, `${name}: sem caminho a partir do largo`).not.toBeNull();
    }
  });
});

describe('bots on foot', () => {
  it('cross the largo, climb the ladeira and the stairway, and walk into the chapel', () => {
    const cap = piece('vila-capela', 'fundacao');
    const r = botWalk(vila.ground(4.4, -4.6), at(cap, 0, KIT.floorTop, -1.0), 40, { level: (q) => Math.abs(heightOf(cap, q) - KIT.floorTop) < 0.5 });
    expect(r.arrived).toBe(true);
    expect(r.wet).toBe(0);
  });

  it('go up the sobrado inner stair to the upper floor', () => {
    const s = piece('vila-sobrado', 'fundacao');
    const r = botWalk(vila.ground(-2, 0), at(s, 1.2, KIT.roofTop, -1.0), 40, { level: (q) => heightOf(s, q) > KIT.roofTop - 0.4 });
    expect(r.arrived).toBe(true);
  });

  it('cross the viaduct and go into the market', () => {
    const via = piece('bairro-viaduto', 'viaduto-tabuleiro');
    const m = piece('bairro-mercado', 'fundacao');
    const deck = botWalk(bairro.ground(-20, 0), at(via, 0, KIT.roofTop, 2), 40, { level: (q) => heightOf(via, q) > KIT.roofTop - 0.4 });
    expect(deck.arrived).toBe(true);
    const market = botWalk(bairro.ground(-20, 0), at(m, -1.8, KIT.floorTop, 0), 60, { level: (q) => Math.abs(heightOf(m, q) - KIT.floorTop) < 0.5 });
    expect(market.arrived).toBe(true);
  });

  it('walk out to the island over the footbridge, never through the lake', () => {
    const r = botWalk(lago.ground(-12, 24), lago.ground(-6.8, -2.6), 50);
    expect(r.arrived).toBe(true);
    expect(r.wet).toBe(0);
  });

  it('climb the cleft behind the waterfall to the top of the cliff', () => {
    const fall = piece('bosque-cachoeira', 'cachoeira-paredao');
    const r = botWalk(bosque.ground(-5, -23), at(fall, -3.0, 5.0, -5.0), 40, { level: (q) => heightOf(fall, q) > 4.6 });
    expect(r.arrived).toBe(true);
  });

  it('travel between regions: from the vila to the Bairro do Horizonte', () => {
    const r = botWalk(vila.ground(2.6, -3), bairro.ground(-20, 8), 90);
    expect(r.arrived).toBe(true);
    expect(r.wet).toBe(0);
  });
});

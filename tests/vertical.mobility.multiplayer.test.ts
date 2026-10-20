/**
 * Integration: mobility magic as alternative routes in the vertical world (docs/world/VERTICAL_WORLD_DESIGN.md, "rotas
 * alternativas"), through the real graao server with two Colyseus SDK clients in free roam. Each spell is played where
 * the map promises it a shortcut, against the same spot without it, and with the transitions the traversal must
 * survive (a spell out of a climb, a dash into rock, a dash off an island's edge):
 * - Linha de Varal: from the ground, a rope to the Ilha do Sino's lip and the ledge onto the island;
 * - Pulo de Pipa: from terrace 1 onto terrace 2 over a plain rock face (no climb, no ramp), which a double jump misses;
 * - Asa de Papel: from the summit to the Ilha do Sino with the bell silent (the universal kite falls short);
 * - Atalho de Giz: a portal from the ground onto the island (only its caster goes through);
 * - Ricochete: kicks off a climbing wall, away and up, with no instant regrab;
 * - Passo de Vento: stops at the rock (no tunnelling); off the island's edge, then the kite opens and lands.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { GRAAO_MAP, TraversalMode } from '@graao/game-data';
import { GROUPS_WORLD_QUERY, frameOfPlacement, validateTargetPoint, type PlacementFrame } from '@graao/game-core';
import { AbilityReject, InputButton, MovementState, v3len, v3normalize, type GameEvent, type Vec3 } from '@graao/shared';
import { getWorld } from '../apps/server/src/world';
import { ZERO, abilityServer, add, flatAt, neg, pair, radial, sleep, sub, toward, type Seat } from './helpers/abilityRoom';

const { url, opened } = abilityServer();
const debug = (...a: unknown[]) => {
  if (process.env.GRAAO_DEBUG) console.log(...a);
};
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

describe('mobility magic as alternative routes in the vertical world', () => {
  let massif: PlacementFrame;
  let sino: PlacementFrame;
  let sinoTop = 0;
  /** The real support under a point: the first solid surface straight down from 2 m above it. */
  let support: (p: Vec3, from?: number) => Vec3 | null;
  let ray: (from: Vec3, dir: Vec3, max: number) => number | null;
  let physics: Awaited<ReturnType<typeof getWorld>>['physics'];
  let winds: Vec3[] = [];

  beforeAll(async () => {
    const world = await getWorld();
    const byId = (id: string) => GRAAO_MAP.placements.find((p) => p.id === id)!;
    massif = frameOfPlacement(world.terrain, byId('vert-serra-macico'));
    sino = frameOfPlacement(world.terrain, byId('vert-ilha-do-sino'));
    sinoTop = radial(sino.base);
    physics = world.physics;
    winds = world.physics.winds.map((w) => w.base);
    support = (p: Vec3, from = 2) => {
      const up = v3normalize(p);
      const o = add(p, up, from);
      const hit = world.physics.castRay(o, neg(up), from + 30, GROUPS_WORLD_QUERY);
      return hit ? add(o, neg(up), hit.toi) : null;
    };
    ray = (from: Vec3, dir: Vec3, max: number) => world.physics.castRay(from, dir, max, GROUPS_WORLD_QUERY)?.toi ?? null;
  });

  /** Waits (sending idle commands) until the player is standing again. */
  const settle = (s: Seat, sp: (s: Seat) => { grounded: boolean }, seconds = 3) => s.drive(seconds, () => ({ wish: ZERO, buttons: 0 }), () => sp(s).grounded);

  it('Linha de Varal: from the ground, a rope to the island’s lip and the ledge up onto the Ilha do Sino', async () => {
    const { A, B, sp, put } = await pair(url, opened, ['clothesline', 'wind_step', 'soft_step', 'sun_meteor'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], sino.at(0, 0, 14));
    put(B, support(sino.at(-3, 0, 16), 0)!, sino.forward);
    // A on the open ground 3 m off the south edge (z 4.5), facing the island.
    const foot = support(sino.at(0.5, -12, 7.5), 0)!;
    put(A, foot, neg(sino.forward));
    await settle(A, sp);
    debug(`varal: chão ${radial(sp(A).pos).toFixed(2)} m, topo da ilha ${sinoTop.toFixed(2)} m`);
    // Aim at the slab's south face, just under the top.
    const lip = sino.at(0.5, -0.25, 4.5);
    const origin = add(sp(A).pos, v3normalize(sp(A).pos), 1.35);
    const d = sub(lip, origin);
    const l = v3len(d);
    debug(`varal: corda de ${l.toFixed(2)} m, o raio bate a ${ray(origin, { x: d.x / l, y: d.y / l, z: d.z / l }, 14)?.toFixed(2)} m`);
    const rope = await A.cast(0, 'clothesline', undefined, { x: d.x / l, y: d.y / l, z: d.z / l });
    expect(rope.ok, `varal: ${rope.r}`).toBe(true);
    { const an = (sp(A).abilityMovement as { anchor?: Vec3 } | undefined)?.anchor; if (an) debug(`varal: âncora a ${(radial(an) - sinoTop).toFixed(2)} m do topo, z ${dot(sub(an, sino.base), sino.forward).toFixed(2)}`); else debug('varal: sem âncora', JSON.stringify(sp(A).abilityMovement)); }
    // Pulled up to the lip; pushing toward the island, A grabs the edge, hangs and pulls up.
    const seen = new Set<number>();
    const into = toward(foot, sino.at(0.5, 0, 0));
    const vtrace: string[] = [];
    const up = await A.drive(6, () => {
      seen.add(sp(A).traversal);
      if (vtrace.length < 60) vtrace.push(`${radial(sp(A).pos).toFixed(2)}${sp(A).abilityMovement ? "*" : ""}${sp(A).grounded ? "g" : ""}/${dot(sub(sp(A).pos, sino.base), sino.forward).toFixed(2)}`);
      return { wish: into, buttons: 0 };
    }, () => sp(A).grounded && radial(sp(A).pos) > sinoTop - 0.3);
    debug(`varal: A a ${radial(sp(A).pos).toFixed(2)} m, estados ${[...seen].join(',')}
  ${vtrace.join(' ')}`);
    expect(up, `A a ${radial(sp(A).pos).toFixed(1)} m`).toBe(true);
    expect(seen.has(TraversalMode.HANG) || seen.has(TraversalMode.MANTLE), 'subiu pela beirada').toBe(true);
    // Standing on the slab, inside its edge.
    expect(dot(sub(sp(A).pos, sino.base), sino.forward)).toBeLessThan(4.5);
    expect(B.events.some((e) => e.e === 'cast' && e.a === 'clothesline' && e.by === A.index)).toBe(true);
  }, 30000);

  it('Pulo de Pipa: from terrace 1 onto terrace 2 over a plain rock face, which a double jump alone misses', async () => {
    const { A, sp, put } = await pair(url, opened, ['kite_jump', 'wind_step', 'soft_step', 'sun_meteor'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], massif.at(12, 0, 0));
    const t1 = radial(massif.at(0, 4.2, 0));
    const t2 = radial(massif.at(0, 8.0, 0));
    // The front terrace of patamar 1 (z 3.6…6), west of paredão 2: patamar 2's plain rock face (no ledge, no climb).
    const start = support(massif.at(-3.8, 4.6, 4.7), 0)!;
    expect(radial(start), 'terraço 1').toBeGreaterThan(t1 - 0.3);
    const west = neg(massif.forward);
    debug(`pipa: a face do patamar 2 está a ${ray(add(start, v3normalize(start), 1), west, 4)?.toFixed(2)} m`);
    const attempt = async (magic: boolean) => {
      put(A, start, west);
      await settle(A, sp);
      let phase = 0;
      let cast = null as Promise<{ ok: boolean; r: number }> | null;
      const trace: string[] = [];
      const ok = await A.drive(3, () => {
        const s = sp(A);
        const vUp = dot(s.vel, v3normalize(s.pos));
        trace.push(`${phase}:${radial(s.pos).toFixed(2)}/${vUp.toFixed(1)}${s.grounded ? "g" : ""}${s.airJumped ? "j" : ""}`);
        // Jump; at the top of it the double jump; at the top of that, the kite's jump (when allowed).
        if (phase === 0) { phase = 1; return { wish: west, buttons: InputButton.JUMP }; }
        if (phase === 1 && vUp < 0.4 && !s.grounded) { phase = 2; return { wish: west, buttons: InputButton.JUMP }; }
        if (phase === 2 && vUp < 0.4 && s.airJumped) {
          phase = 3;
          if (magic) cast = A.cast(0, 'kite_jump');
        }
        return { wish: west, buttons: 0 };
      }, () => phase === 3 && sp(A).grounded);
      if (cast) expect((await cast).ok, 'pipa aceita no ar').toBe(true);
      debug(`pipa ${magic ? 'com' : 'sem'} magia: ${ok ? 'pousou' : 'no ar'} a ${radial(sp(A).pos).toFixed(2)} m (t1 ${t1.toFixed(2)}, t2 ${t2.toFixed(2)}, início ${radial(start).toFixed(2)})
  ${trace.join(' ')}`);
      return radial(sp(A).pos);
    };
    const without = await attempt(false);
    expect(without, 'sem magia fica no terraço 1').toBeLessThan(t2 - 1);
    const withMagic = await attempt(true);
    expect(withMagic, 'com o Pulo de Pipa chega ao terraço 2').toBeGreaterThan(t2 - 0.3);
    expect(sp(A).traversal).toBe(TraversalMode.NONE);
  }, 40000);

  it('Asa de Papel: in still air it carries much farther than the universal kite; off the summit it lands on the island', async () => {
    const { A, sp, put } = await pair(url, opened, ['paper_wings', 'wind_step', 'soft_step', 'sun_meteor'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], massif.at(12, 0, 0));
    // Still air: the far side of the planet from the Serra and its winds, 14 m over the ground, a heading with 45 m of
    // open air ahead.
    const far = support(neg(massif.base), 0)!;
    for (const w of winds) expect(v3len(sub(w, far)), 'longe dos ventos').toBeGreaterThan(60);
    const upF = v3normalize(far);
    const start = add(far, upF, 14);
    let heading: Vec3 | null = null;
    for (let i = 0; i < 12 && !heading; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const h = v3normalize(add(scale(massif.side, Math.cos(a0)), massif.forward, Math.sin(a0)));
      const t = toward(far, add(far, h, 5));
      if ([2, 6, 10, 14].every((k) => ray(add(far, upF, k), t, 45) === null)) heading = t;
    }
    expect(heading, 'um rumo aberto').toBeTruthy();
    const still = async (magic: boolean) => {
      put(A, start, heading!);
      let cast = null as Promise<{ ok: boolean; r: number }> | null;
      if (magic) cast = A.cast(0, 'paper_wings');
      await A.drive(10, () => ({ wish: toward(sp(A).pos, add(sp(A).pos, heading!, 5)), buttons: InputButton.JUMP }), () => sp(A).grounded);
      if (cast) expect((await cast).ok, 'asa aceita no ar').toBe(true);
      const d = v3len(flatAt(sub(sp(A).pos, start), start));
      debug(`asa no ar parado ${magic ? 'com' : 'sem'} magia: ${d.toFixed(1)} m`);
      return d;
    };
    const kite = await still(false);
    const wings = await still(true);
    expect(wings, `asa ${wings.toFixed(1)} m × pipa ${kite.toFixed(1)} m`).toBeGreaterThan(kite * 1.5);
    // Off the summit toward the Ilha do Sino (the bell silent): the wings land on it.
    const summit = support(massif.at(0.6, 11.8, -0.6), 0)!;
    const target = sino.at(1.5, 0, 1.5);
    put(A, summit, toward(summit, target));
    await settle(A, sp);
    await sleep(15500); // the wings' 15 s recharge
    let cast = null as Promise<{ ok: boolean; r: number }> | null;
    let airborne = 0;
    await A.drive(12, () => {
      const st = sp(A);
      if (!st.grounded) airborne++;
      if (!cast && airborne > 6) cast = A.cast(0, 'paper_wings');
      return { wish: toward(st.pos, target), buttons: !st.grounded && airborne > 3 ? InputButton.JUMP : 0 };
    }, () => airborne > 10 && sp(A).grounded);
    expect(cast, 'lançou a asa').toBeTruthy();
    expect((await cast!).ok, 'asa aceita no ar').toBe(true);
    debug(`asa do cume: pousou a ${radial(sp(A).pos).toFixed(2)} m`);
    expect(radial(sp(A).pos), 'com a Asa de Papel: pousa na ilha').toBeGreaterThan(sinoTop - 0.3);
  }, 60000);

  it('Atalho de Giz: from the summit, a portal onto the island and back, used by its caster and by no one else', async () => {
    const { A, B, sp, put } = await pair(url, opened, ['wind_step', 'gust_ring', 'soft_step', 'chalk_shortcut'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], massif.at(12, 0, 0));
    // A portal needs a line of sight to its far end: from under an island its top is never in view, from the summit
    // (2 m higher, 20 m away) it is.
    let found: { start: Vec3; exit: Vec3 } | null = null;
    for (const [sx, sz] of [[0.2, 0.4], [1.2, 0.8], [1.5, -0.6], [0.6, 1.2], [-0.4, 0.9]] as const) {
      for (const [ex, ez] of [[1.5, 1.0], [0.5, 2.0], [-0.5, 3.0], [2.5, 0.0], [3.5, -1.0], [0.5, -2.5]] as const) {
        const s0 = support(massif.at(sx, 11.8, sz), 0)!;
        const e0 = support(sino.at(ex, 0.5, ez), 0)!;
        if (!found && radial(e0) > sinoTop - 0.3 && validateTargetPoint(physics, s0, e0, 25) === AbilityReject.OK) {
          found = { start: s0, exit: e0 };
          debug(`atalho: do cume (${sx}, ${sz}) para a ilha (${ex}, ${ez})`);
        }
      }
    }
    expect(found, 'um ponto do cume que enxerga a ilha').toBeTruthy();
    const { start, exit } = found!;
    const dir = toward(start, exit);
    put(A, start, dir);
    put(B, support(massif.at(-1.4, 11.8, 0.6), 0)!, dir);
    await settle(A, sp);
    await settle(B, sp);
    const portal = await A.cast(3, 'chalk_shortcut', exit, dir);
    expect(portal.ok, `atalho: ${portal.r}`).toBe(true);
    const at = (e: Extract<GameEvent, { e: 'abilityEntity' }>) => ({ x: e.entity.at[0] / 1000, y: e.entity.at[1] / 1000, z: e.entity.at[2] / 1000 });
    const portals = () => A.events.filter((e): e is Extract<GameEvent, { e: 'abilityEntity' }> => e.e === 'abilityEntity' && e.entity.kind === 'portal');
    for (let t = 0; t < 2000 && new Set(portals().map((e) => e.entity.id)).size < 2; t += 20) await sleep(20);
    const entryView = portals().find((e) => radial(at(e)) > sinoTop + 1);
    expect(entryView, 'o portal de entrada no cume').toBeTruthy();
    const entry = at(entryView!);
    debug(`atalho: entrada a ${radial(entry).toFixed(2)} m, saída a ${radial(exit).toFixed(2)} m`);
    // B walks into A's portal first: nothing (only its caster may use it).
    await B.drive(2.5, () => ({ wish: toward(sp(B).pos, entry), buttons: 0 }), () => v3len(flatAt(sub(sp(B).pos, entry), entry)) < 0.4);
    await B.drive(0.6, () => ({ wish: ZERO, buttons: 0 }));
    expect(radial(sp(B).pos), 'B continua no cume').toBeGreaterThan(sinoTop + 1);
    // B steps off the portal again (nobody is sent onto someone standing at the far end).
    await B.drive(0.8, () => ({ wish: toward(entry, start), buttons: 0 }));
    // A steps into it: on the island; walks on, off the far portal.
    const away = neg(toward(exit, start));
    const through = await A.drive(3, () => ({ wish: toward(sp(A).pos, entry), buttons: 0 }), () => radial(sp(A).pos) < sinoTop + 1);
    expect(through, `A a ${radial(sp(A).pos).toFixed(1)} m`).toBe(true);
    await A.drive(0.5, () => ({ wish: away, buttons: 0 }));
    await settle(A, sp);
    expect(radial(sp(A).pos), 'A na ilha').toBeGreaterThan(sinoTop - 0.3);
    const local = sub(sp(A).pos, sino.base);
    expect(Math.abs(dot(local, sino.side)), 'dentro da laje (x)').toBeLessThan(5.5);
    expect(Math.abs(dot(local, sino.forward)), 'dentro da laje (z)').toBeLessThan(4.5);
    // And back the same way while the portals last.
    await sleep(1600);
    const back = await A.drive(3, () => ({ wish: toward(sp(A).pos, exit), buttons: 0 }), () => radial(sp(A).pos) > sinoTop + 1);
    expect(back, 'de volta ao cume pelo portal da ilha').toBe(true);
  }, 30000);

  it('Ricochete: kicks off a climbing wall, away from it and up, with no instant regrab; rejected away from any wall', async () => {
    const { A, sp, put } = await pair(url, opened, ['ricochet', 'wind_step', 'soft_step', 'sun_meteor'], ['paper_wall', 'gust_ring', 'steady_hand', 'sun_meteor'], massif.at(0, 0, 14));
    // Out in the open: no wall within reach, refused.
    put(A, support(massif.at(0.4, 0, 12), 0)!, massif.forward);
    await settle(A, sp);
    const open = await A.cast(0, 'ricochet', undefined, neg(massif.forward));
    expect(open.ok).toBe(false);
    // On paredão 1 (route B): jump at it and push up until climbing.
    const into = neg(massif.forward);
    put(A, support(massif.at(0.4, 0, 7.6), 0)!, into);
    await settle(A, sp);
    const climbing = await A.drive(4, () => ({ wish: into, buttons: sp(A).grounded ? InputButton.JUMP : 0 }), () => sp(A).traversal === TraversalMode.CLIMB && radial(sp(A).pos) > radial(massif.at(0, 1.2, 0)));
    expect(climbing, 'escalando o paredão').toBe(true);
    const wallZ = dot(sub(sp(A).pos, massif.base), massif.forward);
    const kick = await A.cast(0, 'ricochet', undefined, into);
    expect(kick.ok, `ricochete: ${kick.r}`).toBe(true);
    // Off the wall at once, moving south (away) and up; still pushing into the wall, no grab for a moment.
    const states = new Set<number>();
    let furthest = wallZ;
    let maxUp = -Infinity;
    await A.drive(0.6, () => {
      const s = sp(A);
      states.add(s.traversal);
      furthest = Math.max(furthest, dot(sub(s.pos, massif.base), massif.forward));
      maxUp = Math.max(maxUp, dot(s.vel, v3normalize(s.pos)));
      return { wish: into, buttons: 0 };
    });
    debug(`ricochete: de z ${wallZ.toFixed(2)} até ${furthest.toFixed(2)}, subida máx ${maxUp.toFixed(2)} m/s, estados ${[...states].join(',')}`);
    expect(states.has(TraversalMode.CLIMB), 'soltou a parede').toBe(false);
    expect(furthest - wallZ, 'afastou-se da parede').toBeGreaterThan(1.5);
    expect(maxUp, 'para cima').toBeGreaterThan(2);
    await settle(A, sp, 4);
    expect(sp(A).grounded).toBe(true);
  }, 30000);

  it('Passo de Vento: stops at the rock (no tunnelling); off the island’s edge, then the kite opens and lands', async () => {
    const { A, B, sp, put } = await pair(url, opened, ['wind_step', 'gust_ring', 'soft_step', 'sun_meteor'], ['wind_step', 'gust_ring', 'steady_hand', 'sun_meteor'], massif.at(14, 0, 0));
    // Into the front face of patamar 1 (z 6), west of paredão 1: from the ground at z 9.5, 6 m of dash would end
    // 2.5 m inside the rock.
    const foot = support(massif.at(-4, 0.5, 9.5), 0)!;
    const north = neg(massif.forward);
    put(A, foot, north);
    await settle(A, sp);
    const z0 = dot(sub(sp(A).pos, massif.base), massif.forward);
    const free = ray(add(sp(A).pos, v3normalize(sp(A).pos), 1), north, 8);
    debug(`passo: da posição z ${z0.toFixed(2)} o primeiro obstáculo está a ${free?.toFixed(2)} m`);
    const dash = await A.cast(0, 'wind_step', undefined, north);
    expect(dash.ok, `passo: ${dash.r}`).toBe(true);
    let minZ = z0;
    await A.drive(0.8, () => {
      minZ = Math.min(minZ, dot(sub(sp(A).pos, massif.base), massif.forward));
      return { wish: ZERO, buttons: 0 };
    });
    debug(`passo na rocha: de z ${z0.toFixed(2)} até ${minZ.toFixed(2)} (face em 6)`);
    expect(minZ, 'parou na face').toBeGreaterThan(6 + 0.25);
    expect(z0 - minZ, 'andou até a face').toBeGreaterThan(2.5);
    // Off the Ilha do Sino's south edge (B: A's dash is recharging): the dash carries B over the void; jump held opens
    // the kite; B lands below.
    put(B, sino.at(0.5, 0, 2.6), sino.forward);
    await settle(B, sp);
    const off = await B.cast(0, 'wind_step', undefined, sino.forward);
    expect(off.ok, `passo da borda: ${off.r}`).toBe(true);
    const states = new Set<number>();
    const down = await B.drive(9, () => {
      states.add(sp(B).moveState);
      return { wish: sino.forward, buttons: InputButton.JUMP };
    }, () => sp(B).grounded && radial(sp(B).pos) < sinoTop - 5);
    expect(down, `B a ${radial(sp(B).pos).toFixed(1)} m`).toBe(true);
    expect(states.has(MovementState.GLIDE), 'B abriu a pipa depois do passo').toBe(true);
  }, 40000);
});

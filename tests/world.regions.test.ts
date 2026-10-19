/**
 * The Minas Gerais planet plays like it looks (docs/world/POI_DESIGN.md): a character on the real spherical world, with
 * the real character controller and colliders, walks every route the regions were designed around — the ladeira up to
 * the chapel, the sobrado's stair and balcony, the way onto the roofs, the stone bridge and the stream under it, both
 * levels of the viaduct, the footbridge between the lajes, the market, the footbridges to the island, the cleft behind
 * the waterfall, the lookout — and the map's buildings, doors and chest spots are checked against the terrain.
 * Region positions come from the same authoring planes as the map (tools/world/author.ts).
 */
import { describe, expect, it } from 'vitest';
import { CHEST_SPOTS, GRAAO_MAP, KIT, KIT_BUILDINGS, MAP_HASH, MOVEMENT, PLANET, validateMap } from '@graao/game-data';
import { CharacterMotor, GROUPS_WORLD_QUERY, Group, groups, buildingSite, createCharacterState, createGameWorld, newInput, placementToWorld, resolveChestSpots, waterDepth, type CharacterBody, type CharacterState, type Placement } from '@graao/game-core';
import { InputButton, v3dot, v3len, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';
import { regionPlane } from '../tools/world/author';

const world = await createGameWorld({ includeVisual: false });
const motor = new CharacterMotor(world.physics);
const R = PLANET.radius;
const sink = { placements: [], chestSpots: [], waypoints: [], trails: [] };
const vila = regionPlane(sink, 'vila', { lat: 8, lon: 0 });
const bairro = regionPlane(sink, 'bairro', { lat: -12.06, lon: -18.02 }, 42.8);
const lago = regionPlane(sink, 'lago', { lat: -30, lon: -38 }, 50);

/** A map placement's piece: the first layout placement of `mapId` (whose prefab starts with `prefix`). */
function piece(mapId: string, prefix = ''): Placement {
  const p = world.layout.placements.find((q) => q.mapId === mapId && (q.prefab ?? '').startsWith(prefix));
  if (!p) throw new Error(`no placement ${mapId} ${prefix}`);
  return p;
}
const at = (p: Placement, x: number, y: number, z: number) => placementToWorld(p, x, y, z, { x: 0, y: 0, z: 0 });
const heightOf = (p: Placement, q: Vec3) => v3dot({ x: q.x - p.position.x, y: q.y - p.position.y, z: q.z - p.position.z }, p.up);
const aboveGround = (q: Vec3) => v3len(q) - (R + world.terrain.heightAt(v3normalize(q)));

interface Walker {
  s: CharacterState;
  body: CharacterBody;
  min: number;
  max: number;
  wet: boolean;
}

/** A character standing (after settling) at `feet`. */
function spawn(feet: Vec3, facing?: Vec3): Walker {
  const up = v3normalize(feet);
  const f = facing ? v3normalize(v3projectOnPlane(facing, up)) : v3normalize(v3projectOnPlane({ x: 0, y: 1, z: 0.3 }, up));
  const s = createCharacterState({ x: feet.x + up.x * 0.2, y: feet.y + up.y * 0.2, z: feet.z + up.z * 0.2 }, f);
  const body = motor.createBody(s);
  const inp = newInput();
  for (let i = 0; i < 30; i++) motor.step(body, s, inp, 1 / 60);
  return { s, body, min: Infinity, max: -Infinity, wet: false };
}

/**
 * Runs through `points` in order (steering on the tangent plane), each within `reach` m, `maxSeconds` per point.
 * `jump` hops whenever the runner is stuck against something (a crate, a ledge); `track` records min/max of a metric.
 * Returns '' when every point was reached, else where the runner stopped (in `frame`'s local metres when given).
 */
function walk(w: Walker, points: Vec3[], o: { track?: (q: Vec3) => number; maxSeconds?: number; reach?: number; jump?: boolean; frame?: Placement } = {}): string {
  const inp = newInput();
  for (const [k, target] of points.entries()) {
    let ok = false;
    let stuck = 0;
    let last = { ...w.s.pos };
    for (let i = 0; i < (o.maxSeconds ?? 8) * 60; i++) {
      const up = v3normalize(w.s.pos);
      const to = v3projectOnPlane({ x: target.x - w.s.pos.x, y: target.y - w.s.pos.y, z: target.z - w.s.pos.z }, up);
      if (v3len(to) < (o.reach ?? 0.4)) {
        ok = true;
        break;
      }
      inp.wish = v3normalize(to);
      inp.buttons = 0;
      if (o.jump && i % 10 === 0) {
        const moved = Math.hypot(w.s.pos.x - last.x, w.s.pos.y - last.y, w.s.pos.z - last.z);
        stuck = moved < 0.25 ? stuck + 1 : 0;
        last = { ...w.s.pos };
      }
      if (o.jump && stuck >= 2 && i % 20 < 2) inp.buttons = InputButton.JUMP;
      motor.step(w.body, w.s, inp, 1 / 60);
      if (o.track) {
        const m = o.track(w.s.pos);
        w.min = Math.min(w.min, m);
        w.max = Math.max(w.max, m);
      }
      if (w.s.swimming || waterDepth(w.s.pos) > 0.05) w.wet = true;
    }
    if (!ok) {
      const d = v3len(v3projectOnPlane({ x: target.x - w.s.pos.x, y: target.y - w.s.pos.y, z: target.z - w.s.pos.z }, v3normalize(w.s.pos)));
      const f = o.frame;
      const local = f ? (() => {
        const q = { x: w.s.pos.x - f.position.x, y: w.s.pos.y - f.position.y, z: w.s.pos.z - f.position.z };
        return ` local (${v3dot(q, f.side).toFixed(2)}, ${v3dot(q, f.up).toFixed(2)}, ${v3dot(q, f.forward).toFixed(2)})`;
      })() : '';
      return `ponto ${k}: parou a ${d.toFixed(2)} m${local}${w.s.grounded ? '' : ' (no ar)'}${w.s.swimming ? ' (nadando)' : ''}${blockers(w.s.pos, target)}`;
    }
  }
  return '';
}

/** What stands between a stopped runner and its target (knee, waist and head rays, 1 m) and what it stands on. */
function blockers(pos: Vec3, target: Vec3): string {
  const up = v3normalize(pos);
  const dir = v3normalize(v3projectOnPlane({ x: target.x - pos.x, y: target.y - pos.y, z: target.z - pos.z }, up));
  const name = (handle: number) => {
    if (handle === world.physics.terrainHandle) return 'terreno';
    const p = world.physics.propByCollider.get(handle);
    return p ? `${p.mapId ?? p.kind}/${p.prefab ?? p.kind}` : `#${handle}`;
  };
  const hits: string[] = [];
  for (const h of [0.35, 0.9, 1.5]) {
    const hit = world.physics.castRay(lift(pos, h), dir, 1.0, groups(0xffff, Group.TERRAIN | Group.PROP | Group.RAIL));
    if (hit) hits.push(`${h} m: ${name(hit.handle)} a ${hit.toi.toFixed(2)}`);
  }
  const down = world.physics.castRay(lift(pos, 0.5), { x: -up.x, y: -up.y, z: -up.z }, 2);
  return ` · bloqueio [${hits.join('; ') || 'nada'}] · pisa em ${down ? name(down.handle) : 'nada'}`;
}

/** Pushes along `dir` for `seconds`. */
function push(w: Walker, dir: Vec3, seconds: number): void {
  const inp = newInput();
  inp.wish = dir;
  for (let i = 0; i < seconds * 60; i++) motor.step(w.body, w.s, inp, 1 / 60);
}

const shot = (from: Vec3, to: Vec3) => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  return world.physics.castRay(from, v3normalize(d), v3len(d), GROUPS_WORLD_QUERY);
};
const lift = (q: Vec3, h: number) => {
  const u = v3normalize(q);
  return { x: q.x + u.x * h, y: q.y + u.y * h, z: q.z + u.z * h };
};

// ------------------------------------------------------------------------------------------------ the map

describe('the map', () => {
  it('is valid, versioned and hashed', () => {
    expect(validateMap(GRAAO_MAP)).toEqual([]);
    expect(MAP_HASH).toMatch(/^planeta-graao@\d+\.\d+\.\d+#[0-9a-f]{8}$/);
    expect(GRAAO_MAP.mapVersion).toBeGreaterThanOrEqual(2);
  });

  it('has every main region built (buildings, landmarks, chest spots)', () => {
    const count = (region: string) => GRAAO_MAP.placements.filter((p) => p.region === region).length;
    for (const region of ['vila', 'bairro', 'lago', 'fenda', 'planalto', 'serra', 'bosque']) expect(count(region), region).toBeGreaterThan(8);
    for (const id of ['capela-lanternas', 'sobrado-azul', 'chafariz', 'viaduto', 'mercado', 'coreto', 'pavilhao-lago', 'bloco-pilotis', 'cachoeira', 'casa-sitio', 'boca-mina', 'mirante-madeira', 'ponte-pedra']) {
      expect(GRAAO_MAP.placements.some((p) => p.prefab === id), id).toBe(true);
    }
    expect(world.layout.anchors.length).toBeGreaterThan(10);
  });

  it('sets every building on the ground: no floating floors, no ground through a floor, every door within steps', () => {
    for (const mp of GRAAO_MAP.placements) {
      const b = KIT_BUILDINGS[mp.prefab];
      if (!b) continue;
      const site = buildingSite(world.terrain, b, mp);
      expect(site.warnings, mp.id).toEqual([]);
      if (!b.foundation || (mp.settle ?? b.settle) === 'center') continue;
      // The ground never rises above the floor's base, and never falls below the stone base under it.
      expect(site.high, mp.id).toBeLessThan(0.01);
      const plinth = site.extra.find((e) => e.prefab.startsWith('embasamento'));
      const depth = plinth ? Number(plinth.prefab.split('-').pop()) / 10 : KIT.foundation;
      expect(site.low, mp.id).toBeGreaterThan(-depth);
    }
  });

  it('no solid piece of one placement goes into another (modules joined end to end and terraced stone bases aside)', () => {
    const { physics } = world;
    const R = physics.R;
    // Every collider, shrunk by 12 cm (touching is fine, overlapping is an authoring error).
    const m = 0.12;
    const shrink = (sh: InstanceType<typeof R.Shape>): InstanceType<typeof R.Shape> => {
      const s = sh as unknown as { halfExtents?: Vec3; vertices?: Float32Array; halfHeight?: number; radius?: number };
      if (s.halfExtents) return new R.Cuboid(Math.max(0.01, s.halfExtents.x - m), Math.max(0.01, s.halfExtents.y - m), Math.max(0.01, s.halfExtents.z - m));
      if (s.vertices) {
        const v = s.vertices;
        const n = v.length / 3;
        const c = [0, 0, 0];
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += v[i * 3 + k]! / n;
        return new R.ConvexPolyhedron(v.map((x, i) => c[i % 3]! + (x - c[i % 3]!) * 0.85), null);
      }
      if (s.halfHeight !== undefined && s.radius !== undefined) return sh instanceof R.Cone ? new R.Cone(Math.max(0.01, s.halfHeight - m), Math.max(0.01, s.radius - m)) : new R.Cylinder(Math.max(0.01, s.halfHeight - m), Math.max(0.01, s.radius - m));
      return new R.Ball(Math.max(0.01, (s.radius ?? 0.1) - m));
    };
    const bad = new Set<string>();
    physics.world.forEachCollider((c) => {
      const p = physics.propByCollider.get(c.handle);
      if (!p?.mapId) return;
      physics.world.intersectionsWithShape(c.translation(), c.rotation(), shrink(c.shape), (o) => {
        const q = physics.propByCollider.get(o.handle);
        if (!q?.mapId || q.mapId === p.mapId) return true;
        const joined = p.prefab === q.prefab || !!p.prefab?.startsWith('embasamento') || !!q.prefab?.startsWith('embasamento');
        if (!joined) bad.add(`${[p.mapId, q.mapId].sort().join(' × ')} (${p.prefab} / ${q.prefab})`);
        return true;
      }, undefined, groups(0xffff, Group.PROP | Group.RAIL));
    });
    expect([...bad]).toEqual([]);
  });

  it('every chest spot is valid where it was authored (indoors, on roofs and decks, behind cover)', () => {
    const spots = resolveChestSpots(world, CHEST_SPOTS);
    for (const s of spots) {
      expect(s.ok, `${s.def.id}: ${s.reason}`).toBe(true);
      expect(s.moved, s.def.id).toBeLessThan(2.5);
    }
    const per = (region: string) => spots.filter((s) => s.def.region === region).length;
    expect(per('Vila das Lanternas')).toBeGreaterThanOrEqual(6);
    expect(per('Bairro do Horizonte')).toBeGreaterThanOrEqual(6);
    expect(per('Lago Espelho')).toBeGreaterThanOrEqual(4);
    expect(per('Bosque dos Varais')).toBeGreaterThanOrEqual(4);
  });
});

// ------------------------------------------------------------------------------------------------ Vila das Lanternas

describe('Vila das Lanternas (Ouro Preto) on foot', () => {
  it('climbs the ladeira from the largo, takes the stairway to the adro and enters the chapel', () => {
    const w = spawn(vila.ground(2.6, -3));
    const esc = piece('vila-escadaria-adro');
    const cap = piece('vila-capela', 'fundacao');
    const route = [vila.ground(2.5, 3), vila.ground(1.0, 9.5), vila.ground(0, 13), vila.ground(0, 17), vila.ground(0, 21), at(esc, 0, 0.1, -0.6), at(esc, 0, 2.4, 4.4), vila.ground(1.9, 32.2), vila.ground(0, 33.8), at(cap, 0, 0.15, 6.6), at(cap, 0, 0.15, 2.0), at(cap, 0, 0.15, -2.0)];
    expect(walk(w, route, { maxSeconds: 10, frame: cap })).toBe('');
    expect(heightOf(cap, w.s.pos)).toBeCloseTo(KIT.floorTop, 0);
    expect(w.s.grounded).toBe(true);
    // The adro is ≈ 5 m above the largo.
    expect(world.terrain.heightAt(v3normalize(w.s.pos)) - world.terrain.heightAt(vila.dirAt(0, 0))).toBeGreaterThan(4);
    w.body.dispose();
  });

  it('enters the sobrado, climbs its inner stair and steps out on a balcony over the largo', () => {
    const s = piece('vila-sobrado', 'fundacao');
    const w = spawn(at(s, 0, 0, 5.6), s.forward);
    const route = [at(s, 0, 0.15, 2.4), at(s, -1.1, 0.15, 3.3), at(s, -2.2, 0.15, 3.3), at(s, -2.2, KIT.roofTop, -2.1), at(s, 0.2, KIT.roofTop, -2.3), at(s, 1.4, KIT.roofTop, 1.0), at(s, 2.0, KIT.roofTop, 3.2), at(s, 2.0, KIT.roofTop, 4.5)];
    expect(walk(w, route, { maxSeconds: 8, reach: 0.35, frame: s })).toBe('');
    expect(heightOf(s, w.s.pos)).toBeCloseTo(KIT.roofTop, 0);
    // The balcony railing keeps the player on it.
    push(w, s.forward, 1.0);
    expect(heightOf(s, w.s.pos)).toBeGreaterThan(KIT.roofTop - 0.2);
    w.body.dispose();
  });

  it('gets onto the roofs from the yard: woodpile, crates, the lean-to, the main roof up to the ridge', () => {
    const casa = piece('vila-casa-puxado', 'fundacao');
    const crates = piece('vila-puxado-caixotes');
    const step = piece('vila-puxado-caixote');
    const w = spawn(at(step, 0, 0, 1.4), casa.forward);
    // Hop onto the woodpile, the crate stack, then onto the lean-to, then walk up the tiles (≈ 30°) to the ridge.
    const route = [at(step, 0, 0.72, 0), at(crates, 0, 1.8, 0), at(casa, 1.4, 2.6, -4.6), at(casa, 1.4, 3.3, -2.6), at(casa, 1.4, 4.7, -0.3)];
    expect(walk(w, route, { maxSeconds: 8, jump: true, reach: 0.5, frame: casa })).toBe('');
    expect(heightOf(casa, w.s.pos)).toBeGreaterThan(KIT.wallTop + 1.2);
    w.body.dispose();
  });

  it('crosses the stone bridge dry, and wades the stream under its arch', () => {
    const ponte = piece('vila-ponte-pedra');
    const w = spawn(at(ponte, 0, 0, -5.4), ponte.forward);
    expect(walk(w, [at(ponte, 0, 0.7, 0), at(ponte, 0, 0, 5.4)], { track: aboveGround, frame: ponte })).toBe('');
    expect(w.wet).toBe(false);
    w.body.dispose();
    // In the stream bed: from upstream (east) under the arch to downstream.
    const s = spawn(vila.ground(3.5, -14.2));
    expect(walk(s, [vila.ground(-1.0, -14.0), vila.ground(-4.0, -14.2), vila.ground(-7.5, -15.2)], { maxSeconds: 12 })).toBe('');
    expect(s.wet).toBe(true);
    s.body.dispose();
  });

  it('colonial walls stop shots, windows let them through, the fountain is low cover', () => {
    const c = piece('vila-casa-oeste', 'fundacao');
    // Front wall beside the door: blocked. Window (local x = ±2): open between sill and lintel.
    expect(shot(at(c, -1.0, 1.6, 5), at(c, -1.0, 1.6, 0))).not.toBeNull();
    expect(shot(at(c, -2.0, 1.75, 5), at(c, -2.0, 1.75, 1))).toBeNull();
    const ch = piece('vila-chafariz', 'chafariz-pedra');
    expect(shot(at(ch, -4, 0.5, 0), at(ch, 4, 0.5, 0))).not.toBeNull();
    // Over the basin, beside the pedestal (the houses on the largo are 3.2 m away on either side).
    expect(shot(at(ch, -3, 1.5, 1.2), at(ch, 3, 1.5, 1.2))).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ Bairro do Horizonte

describe('Bairro do Horizonte (Belo Horizonte) on foot', () => {
  const via = piece('bairro-viaduto', 'viaduto-tabuleiro');

  it('crosses the viaduct on top: up the north-west stair, over the deck, down the south-east one', () => {
    const w = spawn(at(via, 0, 0, -17.6), via.forward);
    expect(walk(w, [at(via, 0, KIT.roofTop, -11), at(via, 0, KIT.roofTop, 0), at(via, 0, KIT.roofTop, 11), at(via, 0, 0, 17.8)], { maxSeconds: 10, track: (q) => heightOf(via, q), frame: via })).toBe('');
    expect(w.max).toBeGreaterThan(KIT.roofTop - 0.1);
    w.body.dispose();
  });

  it('goes down the side stair from the deck to the railway, and runs the valley under the viaduct', () => {
    const w = spawn(at(via, 1.2, KIT.roofTop, 0), via.forward);
    expect(walk(w, [at(via, 3.2, KIT.roofTop, 0), at(via, 4.05, KIT.roofTop, 0.5), at(via, 4.05, 0.2, 6.2)], { maxSeconds: 8, reach: 0.45, frame: via })).toBe('');
    w.body.dispose();
    const u = spawn(bairro.ground(-4.2, -15));
    expect(walk(u, [bairro.ground(-4.2, -6), bairro.ground(-4.2, 0), bairro.ground(-4.2, 6), bairro.ground(-4.2, 15)], { maxSeconds: 8, frame: via })).toBe('');
    u.body.dispose();
  });

  it('crosses the footbridge between the two lajes', () => {
    const casa = piece('bairro-casa-laje', 'fundacao');
    const merc = piece('bairro-mercearia', 'fundacao');
    const w = spawn(at(casa, 1.6, KIT.roofTop, 2), casa.forward);
    expect(walk(w, [at(merc, -1.6, KIT.roofTop, 2)], { track: aboveGround, frame: casa })).toBe('');
    expect(w.min).toBeGreaterThan(KIT.roofTop - 0.4);
    w.body.dispose();
  });

  it('walks into the market between the stalls and up its back stair to the roof', () => {
    const m = piece('bairro-mercado', 'fundacao');
    const w = spawn(at(m, -1.1, 0, 6.6), m.forward);
    expect(walk(w, [at(m, -1.1, 0.15, 4.0), at(m, -1.1, 0.15, 0), at(m, 4.6, 0.15, 0), at(m, 7.4, 0, 0)], { maxSeconds: 8, frame: m })).toBe('');
    expect(walk(w, [at(m, 7.4, 0, -6.4), at(m, 3.4, 0, -6.1), at(m, -3.4, 4.44, -6.1), at(m, -3.4, 4.44, -4.2)], { maxSeconds: 10, reach: 0.45, frame: m })).toBe('');
    expect(heightOf(m, w.s.pos)).toBeGreaterThan(4.2);
    w.body.dispose();
  });

  it('the viaduct parapet and pillars are cover', () => {
    expect(shot(at(via, -6, KIT.roofTop + 0.6, 3), at(via, 6, KIT.roofTop + 0.6, 3))).not.toBeNull();
    expect(shot(at(via, -6, KIT.roofTop + 1.5, 3), at(via, 6, KIT.roofTop + 1.5, 3))).toBeNull();
    expect(shot(at(via, -2.2, 1.0, -5), at(via, -2.2, 1.0, -1))).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ Lago, Bosque, Serra

describe('Lago Espelho, Bosque dos Varais and the serras on foot', () => {
  it('walks the footbridges out to the island without touching the water', () => {
    const w = spawn(lago.ground(-7.2, 19.6));
    expect(walk(w, [lago.ground(-7.2, 15), lago.ground(-7.2, 9), lago.ground(-7.2, 3), lago.ground(-7.0, -2.0)], { maxSeconds: 10, track: (q) => v3len(q) - (R + PLANET.seaLevel) })).toBe('');
    expect(w.wet).toBe(false);
    w.body.dispose();
  });

  it('runs up the ramp of the block on pilotis into its hall', () => {
    const ramp = piece('lago-bloco-pilotis', 'rampa-pilotis');
    const w = spawn(at(ramp, 0, 0, -0.8), ramp.forward);
    expect(walk(w, [at(ramp, 0, KIT.roofTop, 9.6), at(ramp, 0, KIT.roofTop, 11.4)], { maxSeconds: 8, frame: ramp })).toBe('');
    expect(heightOf(ramp, w.s.pos)).toBeGreaterThan(KIT.roofTop - 0.2);
    w.body.dispose();
  });

  it('climbs the hidden cleft behind the waterfall to the top of the cliff', () => {
    const fall = piece('bosque-cachoeira', 'cachoeira-paredao');
    const w = spawn(at(fall, 0, 0, 1.4), { x: -fall.forward.x, y: -fall.forward.y, z: -fall.forward.z });
    expect(walk(w, [at(fall, 0, 0.1, -0.3), at(fall, 0, 5.0, -6.0), at(fall, -3.0, 5.0, -4.0)], { maxSeconds: 10, reach: 0.45, frame: fall })).toBe('');
    expect(heightOf(fall, w.s.pos)).toBeGreaterThan(4.8);
    w.body.dispose();
  });

  it('walks onto the farmhouse porch and into its kitchen', () => {
    const s = piece('bosque-casa-sitio', 'fundacao');
    const w = spawn(at(s, -1, 0, 6.8), s.forward);
    expect(walk(w, [at(s, -1, 0.15, 4.4), at(s, -1, 0.15, 2.2), at(s, 0.4, 0.15, -1.0)], { maxSeconds: 8, frame: s })).toBe('');
    expect(heightOf(s, w.s.pos)).toBeCloseTo(KIT.floorTop, 0);
    w.body.dispose();
  });

  it('climbs the lookouts of the Planalto and the Serra on foot', () => {
    for (const id of ['planalto-mirante', 'serra-mirante']) {
      const m = piece(id);
      const w = spawn(at(m, 1.0, 0, 6.4), { x: -m.forward.x, y: -m.forward.y, z: -m.forward.z });
      expect(walk(w, [at(m, 1.0, 0.1, 5.4), at(m, 1.0, 2.4, 1.6), at(m, -0.8, 2.4, -0.6)], { maxSeconds: 8, reach: 0.45, frame: m }), id).toBe('');
      expect(heightOf(m, w.s.pos), id).toBeGreaterThan(2.2);
      w.body.dispose();
    }
  });
});

// The doors, stairs and footbridges were sized for the capsule.
it('kit clearances fit the character capsule', () => {
  const height = 2 * (MOVEMENT.capsuleHalfHeight + MOVEMENT.capsuleRadius);
  expect(KIT.door.h).toBeGreaterThan(height + 0.5);
  expect(KIT.door.w).toBeGreaterThan(MOVEMENT.capsuleRadius * 2 + 0.5);
  expect(KIT.stair.width).toBeGreaterThan(MOVEMENT.capsuleRadius * 2 + 0.4);
  expect(Math.atan2(KIT.stair.rise, KIT.stair.run) * (180 / Math.PI)).toBeLessThan(MOVEMENT.maxSlopeClimbDeg - 10);
  expect(KIT.stoop.rise).toBeLessThan(MOVEMENT.autostepHeight);
});

import { describe, expect, it } from 'vitest';
import { PLANET, TORMENTA } from '@graao/game-data';
import { v3angle } from '@graao/shared';
import { mulberry32 } from './rng';
import { latLonToDir } from './sphere';
import { createTerrain } from './terrain';
import {
  GRATormentaSystem,
  planTormenta,
  tormentaCircleAt,
  tormentaEdgeMeters,
  tormentaInside,
  tormentaPhaseMsg,
  tormentaReachability,
  tormentaStage,
  walkableAt,
  walkableFraction,
} from './tormenta';

const DEG = Math.PI / 180;
const terrain = createTerrain();
const on = (lat: number, lon: number, lift = 0) => {
  const d = latLonToDir(lat, lon);
  const r = PLANET.radius + lift;
  return { x: d.x * r, y: d.y * r, z: d.z * r };
};

describe('Tormenta plan', () => {
  const plans = Array.from({ length: 40 }, (_, i) => planTormenta(mulberry32(i * 97 + 5), terrain, 1_000_000));

  it('starts with the whole planet safe and closes in three reductions of growing damage', () => {
    for (const p of plans) {
      expect(p.circles).toHaveLength(TORMENTA.phases.length + 1);
      expect(p.circles[0]!.radius).toBeGreaterThanOrEqual(Math.PI);
      for (let k = 1; k < p.circles.length; k++) expect(p.circles[k]!.radius).toBeCloseTo(TORMENTA.phases[k - 1]!.radiusDeg * DEG, 5);
      const dmg = p.phases.map((ph) => ph.damage);
      expect([...dmg].sort((a, b) => a - b)).toEqual(dmg);
      expect(p.finalDamage).toBeGreaterThanOrEqual(dmg[dmg.length - 1]!);
      // Back to back: each hold starts when the previous shrink ends.
      for (let k = 1; k < p.phases.length; k++) expect(p.phases[k]!.t0).toBe(p.phases[k - 1]!.b);
    }
  });

  it('nests every circle inside the previous one (the boundary never moves outward)', () => {
    for (const p of plans) {
      for (let k = 1; k < p.circles.length; k++) {
        const a = p.circles[k - 1]!;
        const b = p.circles[k]!;
        expect(v3angle(a.center, b.center) + b.radius).toBeLessThanOrEqual(a.radius + 1e-5);
      }
      // Sampled through every phase: each moment's circle contains every later one.
      for (let k = 1; k <= p.phases.length; k++) {
        const m = tormentaPhaseMsg(p, k);
        let prev = tormentaCircleAt(m, m.t0);
        for (let t = m.a; t <= m.b; t += (m.b - m.a) / 12) {
          const c = tormentaCircleAt(m, t);
          expect(v3angle(prev.center, c.center) + c.radius).toBeLessThanOrEqual(prev.radius + 1e-5);
          prev = { center: { ...c.center }, radius: c.radius };
        }
      }
    }
  });

  it('ends on walkable land: no final region in a lake, the sea or on a cliff', () => {
    for (const p of plans) {
      const f = p.circles[p.circles.length - 1]!;
      expect(walkableAt(terrain, f.center)).toBe(true);
      expect(walkableFraction(terrain, f.center, f.radius)).toBeGreaterThanOrEqual(TORMENTA.finalWalkable);
    }
    // The finals spread over the planet (not always the same spot).
    const finals = plans.map((p) => p.circles[p.circles.length - 1]!.center);
    const spread = Math.max(...finals.map((c) => v3angle(c, finals[0]!)));
    expect(spread / DEG).toBeGreaterThan(90);
  });

  it('keeps every new region reachable by running, from the worst point of the previous one', () => {
    for (const r of tormentaReachability(TORMENTA, TORMENTA.checkSpeed, TORMENTA.pathFactor)) {
      expect(r.needS, `phase ${r.phase}`).toBeLessThan(r.haveS);
    }
  });
});

describe('Tormenta geometry (geodesic, never flat X/Z)', () => {
  const center = latLonToDir(8, 0);
  const circle = { center, radius: 30 * DEG };

  it('tells inside from outside by the angle around the planet centre, at opposite sides of the planet', () => {
    expect(tormentaInside(circle, on(8, 0))).toBe(true);
    expect(tormentaInside(circle, on(-8, 180))).toBe(false); // the antipode
    expect(tormentaEdgeMeters(circle, on(-8, 180))).toBeCloseTo((180 - 30) * DEG * PLANET.radius, 3);
    // Mirrored across the equator: same X/Z, different side of the boundary (a flat X/Z test would call both inside).
    const north = on(40, 0);
    const south = { x: north.x, y: -north.y, z: north.z };
    expect(tormentaInside(circle, north)).toBe(false);
    expect(tormentaInside({ center: latLonToDir(40, 0), radius: 10 * DEG }, north)).toBe(true);
    expect(tormentaInside({ center: latLonToDir(40, 0), radius: 10 * DEG }, south)).toBe(false);
    // Height does not matter (a roof or a jump is still inside), only the direction.
    expect(tormentaInside(circle, on(8, 0, 30))).toBe(true);
    // Edge distance in metres along the surface.
    expect(tormentaEdgeMeters(circle, on(8 + 31, 0))).toBeCloseTo(1 * DEG * PLANET.radius, 3);
    expect(tormentaEdgeMeters(circle, on(8 + 20, 0))).toBeLessThan(0);
  });

  it('a whole-planet circle has nobody outside, the antipode included', () => {
    const plan = planTormenta(mulberry32(3), terrain, 0);
    const m = tormentaPhaseMsg(plan, 1);
    const c = tormentaCircleAt(m, m.t0);
    const anti = { x: -plan.circles[1]!.center.x * 100, y: -plan.circles[1]!.center.y * 100, z: -plan.circles[1]!.center.z * 100 };
    expect(tormentaInside(c, anti)).toBe(true);
    expect(tormentaStage(m, m.t0)).toBe('hold');
    expect(tormentaStage(m, m.a + 1)).toBe('shrink');
  });
});

describe('GRATormentaSystem (server)', () => {
  it('publishes each phase once, then the final region; integers only', () => {
    const sys = new GRATormentaSystem();
    const first = sys.start(10_000, mulberry32(11), terrain);
    expect(first.k).toBe(1);
    for (const v of [...first.c, first.r, ...first.tc, first.tr, first.t0, first.a, first.b, first.dmg, first.every]) expect(Number.isInteger(v)).toBe(true);
    const plan = sys.schedule!;
    const ks: number[] = [];
    for (let t = 10_000; t <= plan.phases[plan.phases.length - 1]!.b + 5000; t += 50) if (sys.update(t).changed) ks.push(sys.view!.k);
    expect(ks).toEqual([2, 3, 4]);
    const fin = sys.view!;
    expect(fin.k).toBe(fin.n + 1);
    expect(tormentaStage(fin, fin.t0 + 1)).toBe('final');
    expect(fin.c).toEqual(fin.tc);
    expect(fin.dmg).toBe(TORMENTA.finalDamage);
  });

  it('reports one damage pulse per interval, never two for the same one, and no burst after a stall', () => {
    const sys = new GRATormentaSystem({ ...TORMENTA, pulseMs: 1000 });
    sys.start(0, mulberry32(5), terrain);
    const pulses: number[] = [];
    // A 20 Hz server for 5.3 s, with every tick run twice (a stray second update must not hurt again).
    for (let t = 0; t <= 5300; t += 50) {
      if (sys.update(t).damage) pulses.push(t);
      if (sys.update(t).damage) pulses.push(-t);
    }
    expect(pulses).toEqual([1000, 2000, 3000, 4000, 5000]);
    // The server stalls for 4.5 s: one pulse when it comes back, not four.
    expect(sys.update(9500).damage).toBeGreaterThan(0);
    expect(sys.update(9600).damage).toBe(0);
    expect(sys.update(10000).damage).toBeGreaterThan(0);
  });

  it('tests a position against the circle at the last update: inside while holding, outside once it closed', () => {
    const final = latLonToDir(8, 0);
    const sys = new GRATormentaSystem({ ...TORMENTA, phases: [{ waitMs: 1000, shrinkMs: 1000, radiusDeg: 20, damage: 5 }] });
    sys.start(0, mulberry32(1), terrain, final);
    const near = on(10, 2);
    const far = on(-8, 180);
    sys.update(500);
    expect(sys.outside(near)).toBe(false);
    expect(sys.outside(far)).toBe(false);
    sys.update(1500);
    expect(sys.outside(far)).toBe(true);
    expect(sys.outside(near)).toBe(false);
    sys.update(2500);
    expect(sys.view!.k).toBe(2);
    expect(sys.outside(far)).toBe(true);
    expect(sys.outside(on(8 + 21, 0))).toBe(true);
    expect(sys.outside(on(8 + 19, 0))).toBe(false);
    sys.stop();
    expect(sys.outside(far)).toBe(false);
    expect(sys.update(4000).damage).toBe(0);
  });
});

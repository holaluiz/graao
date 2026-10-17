/** Tops, built from the body's own torso and arm rings with outward offsets (no clipping by construction). */
import * as THREE from 'three';
import type { BoneName } from '../rig/GRARig';
import { inflate, mirrorRings, ringAt, sliceRings, torsoPoint, type BodyShape } from '../build/anatomy';
import { PartBuilder, Slot, facing, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';

/**
 * Outer offset of each top's torso shell (`inflate(ring, d, k)`, prints and trims included) and of long sleeves. Body
 * extras (chain, fanny pack, flag) sit just outside it, so they never sink into a thick jacket or float over a tank.
 */
export const TOP_FIT: Record<string, { d: number; k: number; sleeve?: number }> = {
  'top.tee': { d: 0.016, k: 1.05 },
  'top.time': { d: 0.019, k: 1.05 },
  'top.regata': { d: 0.014, k: 1.04 },
  'top.cropped': { d: 0.016, k: 1.05 },
  'top.chita': { d: 0.022, k: 1.05 },
  'top.xadrez': { d: 0.02, k: 1.05, sleeve: 0.02 },
  'top.cortavento': { d: 0.026, k: 1.06, sleeve: 0.024 },
  'top.hoodie': { d: 0.028, k: 1.06, sleeve: 0.024 },
  'top.longsleeve': { d: 0.016, k: 1.04, sleeve: 0.018 },
  'top.vest': { d: 0.036, k: 1.07 },
};
export function topFit(topId: string): { d: number; k: number; sleeve?: number } {
  return TOP_FIT[topId] ?? TOP_FIT['top.tee']!;
}

/** Offset of a `torsoShell` at height y (its hem flare grows toward y0). */
const shellD = (y: number, y0: number, y1: number, d: number, flare: number) => d + flare * Math.pow(1 - Math.min(1, Math.max(0, (y - y0) / (y1 - y0))), 3);

/** Point on a garment shell at (x, y): front (side 1) or back (side -1). */
function shellAt(s: BodyShape, x: number, y: number, side: 1 | -1, d: number, k: number): V3 {
  const r = ringAt(s.torso, 1, y);
  const ra = r.ra * k + d;
  const rb = r.rb * k + d;
  const n = Math.max(2.2, (r.n ?? 2) - 0.2);
  const q = Math.min(0.98, Math.abs(x) / ra);
  return [x, y, r.p[2] + side * rb * Math.pow(1 - Math.pow(q, n), 1 / n)];
}

/** Button-shirt collar: two flaps meeting in a V under the chin. */
function collarFlaps(b: PartBuilder, s: BodyShape, d: number, k: number, slot: SlotId): void {
  for (const sx of [1, -1]) {
    const m = new THREE.Matrix4().makeRotationX(-0.45).multiply(new THREE.Matrix4().makeRotationZ(sx * 0.6));
    b.roundedBox(shellAt(s, sx * 0.036, 1.268, 1, d + 0.008, k), [0.034, 0.016, 0.005], { slot, bones: ['Spine2', 'Neck'] }, 4, 10, 6, new THREE.Matrix3().setFromMatrix4(m));
  }
}

/** Buttons down the placket. */
function buttons(b: PartBuilder, s: BodyShape, d: number, k: number, ys: number[], slot: SlotId): void {
  for (const y of ys) b.ellipsoid(shellAt(s, 0, y, 1, d + 0.002, k), [0.0065, 0.0065, 0.003], { slot, bones: ['Spine', 'Spine1', 'Spine2'], outline: 0.3 }, 8, 5);
}

/** Line laid over a sleeve at angle `phi` around it (0 = top): plaid lines and track stripes. */
function sleeveLine(b: PartBuilder, rings: RingSpec[], side: 'Left' | 'Right', phi: number, lift: number, width: number, slot: SlotId): void {
  const cy = Math.cos(phi);
  const cz = Math.sin(phi);
  b.tube(
    rings.map((r) => ({ p: [r.p[0], r.p[1] + cy * (r.ra + lift), r.p[2] + cz * (r.rb + lift)] as V3, ra: 0.0025, rb: width })),
    { slot, bones: armBones(side), ref: [0, cy, cz], segments: 6, capStart: 'flat', capEnd: 'flat', outline: 0.2 },
  );
}

const TORSO_BONES: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg'];
const armBones = (side: 'Left' | 'Right'): BoneName[] => [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`] as BoneName[];

/** Torso shell between two heights; optional hem flare. */
function torsoShell(s: BodyShape, y0: number, y1: number, d: number, k: number, flare: number, count = 10): RingSpec[] {
  const rings = inflate(sliceRings(s.torso, 1, y0, y1, count), d, k);
  return rings.map((r, i) => {
    const t = 1 - i / (rings.length - 1);
    const f = flare * Math.pow(t, 3);
    return { ...r, ra: r.ra + f, rb: r.rb + f * 0.8, n: Math.max(2.2, (r.n ?? 2) - 0.2) };
  });
}

/** Sleeve along the arm from the shoulder to `x1` (left side x values). */
function sleeve(s: BodyShape, side: 'Left' | 'Right', x0: number, x1: number, d: number, endFlare: number, count = 6): RingSpec[] {
  let rings = inflate(sliceRings(s.arm, 0, x0, x1, count), d, 1.04);
  rings = rings.map((r, i) => {
    const t = i / (rings.length - 1);
    return { ...r, ra: r.ra + endFlare * t * t, rb: r.rb + endFlare * t * t };
  });
  return side === 'Left' ? rings : mirrorRings(rings);
}

/** Splits a ring list into colored bands of `period` along `axis` (crisp stripes need separate vertex rings). */
function bands(rings: RingSpec[], axis: 0 | 1, period: number, slots: [SlotId, SlotId]): { rings: RingSpec[]; slot: SlotId }[] {
  const a = rings[0]!.p[axis];
  const z = rings[rings.length - 1]!.p[axis];
  const dir = Math.sign(z - a);
  const out: { rings: RingSpec[]; slot: SlotId }[] = [];
  let v = a;
  let n = 0;
  while ((z - v) * dir > 1e-4) {
    const next = dir > 0 ? Math.min(z, v + period) : Math.max(z, v - period);
    out.push({ rings: [ringAt(rings, axis, v), ringAt(rings, axis, (v + next) / 2), ringAt(rings, axis, next)], slot: slots[n % 2]! });
    v = next;
    n++;
  }
  return out;
}

function frontZ(s: BodyShape, y: number, d: number): number {
  const r = ringAt(s.torso, 1, y);
  return r.p[2] + r.rb + d;
}

export function buildTop(b: PartBuilder, s: BodyShape, topId: string): void {
  const p = s.p;
  const sh = p.shoulderX;
  switch (topId) {
    case 'top.time': {
      // Football shirt: V collar, side stripes, crest on the chest and a big 10 on the back.
      const [y0, y1, d, k, flare] = [0.865, 1.296, 0.016, 1.05, 0.016];
      b.tube(torsoShell(s, y0, y1, d, k, flare), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      b.tube(inflate(sliceRings(s.torso, 1, 1.28, 1.3, 2), 0.021, k), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      const flat = (pts: V3[], w: number, bones: BoneName[], ref: V3) =>
        b.tube(pts.map((p) => ({ p, ra: 0.003, rb: w })), { slot: Slot.TOP_ACCENT, bones, ref, segments: 6, capStart: 'round', capEnd: 'round', outline: 0.3 });
      for (const sx of [1, -1] as const) {
        const v: V3[] = [0, 0.33, 0.66, 1].map((t) => torsoPoint(s, 1.284 - 0.064 * t, sx * 0.34 * (1 - t), shellD(1.284 - 0.064 * t, y0, y1, d, flare) + 0.003, k).p);
        flat(v, 0.006, ['Spine2', 'Spine1', 'Neck'], [0, 0, 1]);
        const side: V3[] = [];
        for (let y = 1.19; y >= 0.885; y -= 0.0305) side.push(torsoPoint(s, y, sx * (Math.PI / 2), shellD(y, y0, y1, d, flare) + 0.002, k).p);
        flat(side, 0.01, TORSO_BONES, [sx, 0, 0]);
      }
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.125, 0.018, 0.012, 5), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, sh + 0.115, sh + 0.135, 0.024, 0.0, 2), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      // Crest on the left chest.
      const crest = shellAt(s, 0.062, 1.155, 1, d + 0.004, k);
      b.roundedBox(crest, [0.017, 0.021, 0.004], { slot: Slot.TOP_ACCENT, bones: ['Spine1', 'Spine2'], outline: 0.3 }, 3, 10, 6);
      // Number 10 on the back (seen from behind, the character's left is on the viewer's left).
      const back = (x: number, y: number): V3 => shellAt(s, x, y, -1, d + 0.003, k);
      flat([back(0.034, 1.16), back(0.034, 1.1), back(0.034, 1.04)], 0.0085, ['Spine', 'Spine1', 'Spine2'], [0, 0, 1]);
      const zero: V3[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        zero.push(back(-0.026 + Math.cos(a) * 0.024, 1.1 + Math.sin(a) * 0.056));
      }
      b.loop(zero, 0.003, 0.0085, { slot: Slot.TOP_ACCENT, bones: ['Spine', 'Spine1', 'Spine2'], outline: 0.3 });
      break;
    }
    case 'top.regata': {
      // Tank top: the shell stops under the arms; wide straps go over the shoulders.
      b.tube(torsoShell(s, 0.865, 1.2, 0.012, 1.04, 0.014), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const sx of [1, -1] as const) {
        const f = (x: number, y: number, side: 1 | -1, lift: number) => shellAt(s, sx * x, y, side, 0.012 + lift, 1.04);
        b.tube(
          [
            { p: f(0.074, 1.196, 1, 0.002), ra: 0.024, rb: 0.007 },
            { p: f(0.084, 1.255, 1, 0.004), ra: 0.025, rb: 0.007 },
            { p: [sx * 0.09, 1.298, -0.012], ra: 0.026, rb: 0.007 },
            { p: f(0.084, 1.255, -1, 0.004), ra: 0.025, rb: 0.007 },
            { p: f(0.074, 1.196, -1, 0.002), ra: 0.024, rb: 0.007 },
          ],
          { slot: Slot.TOP, bones: ['Spine1', 'Spine2', sx > 0 ? 'LeftShoulder' : 'RightShoulder'], ref: [1, 0, 0], segments: 8, capStart: 'flat', capEnd: 'flat' },
        );
      }
      break;
    }
    case 'top.cropped': {
      // Short top that shows the belly, puffed short sleeves.
      b.tube(torsoShell(s, 1.0, 1.296, 0.014, 1.05, 0.006, 8), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      b.tube(inflate(sliceRings(s.torso, 1, 0.992, 1.014, 2), 0.02, 1.05), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      b.tube(inflate(sliceRings(s.torso, 1, 1.28, 1.3, 2), 0.02, 1.05), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.085, 0.02, 0.022, 5), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, sh + 0.078, sh + 0.096, 0.03, 0.0, 2), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      break;
    }
    case 'top.chita': {
      // Short-sleeve button shirt in chita: big five-petal flowers with yellow hearts and leaves all around.
      const [y0, y1, d, k, flare] = [0.86, 1.296, 0.016, 1.05, 0.018];
      b.tube(torsoShell(s, y0, y1, d, k, flare), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.13, 0.018, 0.016, 5), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, sh + 0.12, sh + 0.14, 0.03, 0.0, 2), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      collarFlaps(b, s, d, k, Slot.TOP);
      buttons(b, s, d, k, [1.2, 1.13, 1.06, 0.99, 0.92], Slot.TOP_DETAIL);
      const rows = [0.93, 1.02, 1.11, 1.2];
      rows.forEach((y, row) => {
        for (let j = 0; j < 6; j++) {
          const th = (j + 0.5 * (row % 2) + 0.25) * (Math.PI / 3);
          const q = torsoPoint(s, y, th, shellD(y, y0, y1, d, flare) + 0.002, k);
          const R = 0.026 + 0.006 * Math.sin(j * 1.7 + row);
          const spin = j * 0.9 + row;
          b.flower(q.p, q.n, R, 0.0035, 5, { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, outline: 0.3 }, 0.42, spin, 20);
          const heart: V3 = [q.p[0] + q.n[0] * 0.003, q.p[1], q.p[2] + q.n[2] * 0.003];
          b.ellipsoid(heart, [R * 0.3, R * 0.3, 0.0025], { slot: Slot.POLLEN, bones: TORSO_BONES, outline: 0 }, 8, 4, facing(q.n));
          if ((j + row) % 2 === 0) {
            const leaf = torsoPoint(s, y - R * 0.9, th + 0.2, shellD(y, y0, y1, d, flare) + 0.0015, k);
            const rot = facing(leaf.n).multiply(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationZ(0.7)));
            b.ellipsoid(leaf.p, [R * 0.6, R * 0.26, 0.0022], { slot: Slot.LEAF, bones: TORSO_BONES, outline: 0.2 }, 8, 4, rot);
          }
        }
      });
      break;
    }
    case 'top.xadrez': {
      // Festa junina plaid: dark bands across, light lines down, crossing into a check. Long sleeves, chest pocket.
      const [y0, y1, d, k, flare] = [0.85, 1.296, 0.016, 1.05, 0.012];
      for (const band of bands(torsoShell(s, y0, y1, d, k, flare, 14), 1, 0.07, [Slot.TOP, Slot.TOP_ACCENT])) {
        b.tube(band.rings, { slot: band.slot, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      }
      for (let j = 0; j < 12; j++) {
        const th = (j + 0.5) * (Math.PI / 6);
        const line: RingSpec[] = [];
        for (let i = 0; i <= 9; i++) {
          const y = y0 + 0.008 + ((y1 - 0.03 - y0) * i) / 9;
          line.push({ p: torsoPoint(s, y, th, shellD(y, y0, y1, d, flare) + 0.002, k).p, ra: 0.0025, rb: 0.0065 });
        }
        b.tube(line, { slot: Slot.TOP_DETAIL, bones: TORSO_BONES, ref: [Math.sin(th), 0, Math.cos(th)], segments: 6, capStart: 'flat', capEnd: 'flat', outline: 0.2 });
      }
      collarFlaps(b, s, d, k, Slot.TOP_ACCENT);
      buttons(b, s, d + 0.003, k, [1.21, 1.14, 1.07, 1.0, 0.93], Slot.TOP_DETAIL);
      b.roundedBox(shellAt(s, 0.064, 1.13, 1, d + 0.008, k), [0.03, 0.032, 0.006], { slot: Slot.TOP_ACCENT, bones: ['Spine1', 'Spine2'], outline: 0.4 }, 5, 12, 8);
      for (const side of ['Left', 'Right'] as const) {
        const rings = sleeve(s, side, sh - 0.05, p.wristX - 0.03, 0.016, 0.004, 12);
        b.tube(rings.slice(0, 2), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        for (const band of bands(rings.slice(1), 0, 0.07, [Slot.TOP_ACCENT, Slot.TOP])) {
          b.tube(band.rings, { slot: band.slot, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
        }
        for (const phi of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) sleeveLine(b, rings.slice(2), side, phi, 0.002, 0.0055, Slot.TOP_DETAIL);
        b.tube(sleeve(s, side, p.wristX - 0.035, p.wristX - 0.008, 0.02, 0, 3), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      break;
    }
    case 'top.cortavento': {
      // 90s windbreaker: three color blocks, elastic hem and cuffs, stand-up collar, zip and sleeve stripes.
      const [d, k] = [0.024, 1.06];
      const block = (a: number, z: number, slot: SlotId, count: number) =>
        b.tube(inflate(sliceRings(s.torso, 1, a, z, count), d, k), { slot, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      block(0.84, 1.07, Slot.TOP, 6);
      block(1.07, 1.17, Slot.TOP_ACCENT, 3);
      block(1.17, 1.296, Slot.TOP_DETAIL, 5);
      b.tube(inflate(sliceRings(s.torso, 1, 0.812, 0.85, 3), d + 0.01, k), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      const collar: V3[] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        collar.push([Math.sin(a) * 0.066, 1.302, -0.013 + Math.cos(a) * 0.06]);
      }
      b.loop(collar, 0.028, 0.012, { slot: Slot.TOP_DETAIL, bones: ['Spine2', 'Neck'] }, 8);
      const zip: RingSpec[] = [];
      for (let y = 0.83; y <= 1.29; y += 0.046) zip.push({ p: shellAt(s, 0, y, 1, d + 0.003, k), ra: 0.004, rb: 0.005 });
      b.tube(zip, { slot: Slot.INK, bones: ['Hips', 'Spine', 'Spine1', 'Spine2'], ref: [0, 0, 1], segments: 6, capStart: 'flat', capEnd: 'flat', outline: 0.2 });
      for (const side of ['Left', 'Right'] as const) {
        const rings = sleeve(s, side, sh - 0.05, p.wristX - 0.03, 0.022, 0.006, 9);
        b.tube(rings, { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        sleeveLine(b, rings.slice(1), side, 0, 0.002, 0.009, Slot.TOP_ACCENT);
        b.tube(sleeve(s, side, p.wristX - 0.04, p.wristX - 0.005, 0.016, 0, 3), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      break;
    }
    case 'top.hoodie': {
      b.tube(torsoShell(s, 0.835, 1.296, 0.026, 1.06, 0.012), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Ribbed hem.
      b.tube(inflate(sliceRings(s.torso, 1, 0.8, 0.842, 3), 0.038, 1.06), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, p.wristX - 0.035, 0.022, 0.008, 9), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, p.wristX - 0.04, p.wristX - 0.005, 0.016, 0, 3), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      // Hood: a rolled collar around the back of the neck plus the hood mass on the upper back.
      const hood: V3[] = [
        [0.085, 1.29, 0.02],
        [0.08, 1.325, -0.05],
        [0.0, 1.34, -0.095],
        [-0.08, 1.325, -0.05],
        [-0.085, 1.29, 0.02],
      ];
      b.tube(hood.map((q) => ({ p: q, ra: 0.034, rb: 0.03 })), { slot: Slot.TOP, bones: ['Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'], ref: [0, 1, 0], segments: 10 });
      b.ellipsoid([0, 1.215, -0.112], [0.11, 0.09, 0.045], { slot: Slot.TOP, bones: ['Spine2', 'Spine1'] }, 12, 8);
      // Kangaroo pocket and drawstrings.
      b.roundedBox([0, 0.935, frontZ(s, 0.935, 0.03)], [0.095, 0.05, 0.012], { slot: Slot.TOP_ACCENT, bones: ['Spine', 'Hips', 'Spine1'] }, 5, 14, 8);
      for (const sx of [1, -1]) {
        b.tube(
          [
            { p: [sx * 0.026, 1.27, frontZ(s, 1.27, 0.035)], ra: 0.005, rb: 0.005 },
            { p: [sx * 0.029, 1.2, frontZ(s, 1.2, 0.036)], ra: 0.005, rb: 0.005 },
            { p: [sx * 0.03, 1.15, frontZ(s, 1.15, 0.036)], ra: 0.006, rb: 0.006 },
          ],
          { slot: Slot.SOLE, bones: ['Spine2', 'Spine1'], ref: [1, 0, 0], segments: 6, outline: 0.4 },
        );
      }
      break;
    }
    case 'top.longsleeve': {
      for (const band of bands(torsoShell(s, 0.86, 1.296, 0.014, 1.04, 0.008, 14), 1, 0.055, [Slot.TOP, Slot.TOP_ACCENT])) {
        b.tube(band.rings, { slot: band.slot, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      }
      b.tube(inflate(sliceRings(s.torso, 1, 1.283, 1.3, 2), 0.019, 1.04), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        const rings = sleeve(s, side, sh - 0.05, p.wristX - 0.01, 0.016, 0.004, 12);
        b.tube(rings.slice(0, 2), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        for (const band of bands(rings.slice(1), 0, 0.055, [Slot.TOP_ACCENT, Slot.TOP])) {
          b.tube(band.rings, { slot: band.slot, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
        }
      }
      break;
    }
    case 'top.vest': {
      // Under-shirt (accent) with short sleeves.
      b.tube(torsoShell(s, 0.87, 1.296, 0.012, 1.03, 0.004), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.11, 0.016, 0.01, 5), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
      }
      // Vest shell.
      b.tube(torsoShell(s, 0.845, 1.262, 0.034, 1.07, 0.016, 10), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Shoulder straps over the top.
      for (const sx of [1, -1]) {
        b.tube(
          [
            { p: [sx * 0.095, 1.255, frontZ(s, 1.255, 0.03)], ra: 0.03, rb: 0.012 },
            { p: [sx * 0.105, 1.29, -0.012], ra: 0.03, rb: 0.012 },
            { p: [sx * 0.095, 1.255, -0.012 - 0.1], ra: 0.03, rb: 0.012 },
          ],
          { slot: Slot.TOP, bones: ['Spine2', sx > 0 ? 'LeftShoulder' : 'RightShoulder'], ref: [1, 0, 0], segments: 8 },
        );
        // Chest pockets.
        b.roundedBox([sx * 0.07, 1.1, frontZ(s, 1.1, 0.04)], [0.04, 0.038, 0.01], { slot: Slot.TOP, bones: ['Spine1', 'Spine2'] }, 5, 12, 8);
        b.roundedBox([sx * 0.075, 0.92, frontZ(s, 0.92, 0.042)], [0.045, 0.035, 0.01], { slot: Slot.TOP, bones: ['Spine', 'Hips'] }, 5, 12, 8);
      }
      // Zip line.
      b.roundedBox([0, 1.05, frontZ(s, 1.05, 0.036)], [0.006, 0.19, 0.005], { slot: Slot.TOP_ACCENT, bones: ['Spine', 'Spine1', 'Spine2'], outline: 0.3 }, 4, 8, 10);
      break;
    }
    case 'top.tee':
    default: {
      b.tube(torsoShell(s, 0.865, 1.296, 0.014, 1.05, 0.02), { slot: Slot.TOP, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      // Collar band.
      b.tube(inflate(sliceRings(s.torso, 1, 1.28, 1.3, 2), 0.02, 1.05), { slot: Slot.TOP_ACCENT, bones: TORSO_BONES, ref: [1, 0, 0], segments: 18, capStart: 'open', capEnd: 'open' });
      for (const side of ['Left', 'Right'] as const) {
        b.tube(sleeve(s, side, sh - 0.05, sh + 0.125, 0.018, 0.014, 5), { slot: Slot.TOP, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'round', capEnd: 'open' });
        b.tube(sleeve(s, side, sh + 0.115, sh + 0.135, 0.026, 0.0, 2), { slot: Slot.TOP_ACCENT, bones: armBones(side), ref: [0, 1, 0], segments: 12, capStart: 'open', capEnd: 'open' });
      }
      // A graphic chest patch so the tee reads from distance (shape, not only color).
      b.roundedBox([0.05, 1.12, frontZ(s, 1.12, 0.017)], [0.032, 0.032, 0.004], { slot: Slot.TOP_ACCENT, bones: ['Spine1', 'Spine2'], outline: 0.3 }, 3, 10, 6);
      break;
    }
  }
}

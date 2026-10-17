/**
 * Hats, rigid on the Head bone. Brimmed hats are authored around the bare skull and seated over the hair with
 * `hatSeat` (bigger hair lifts and widens them); wrapped pieces (bandana, beanie) follow the hair surface itself.
 * Palette: HAT is the material (straw, leather) or the chosen color; HAT_ACCENT the band/ornaments.
 */
import * as THREE from 'three';
import type { HeadShape } from '../build/anatomy';
import { PartBuilder, Slot, facing, type RingSpec, type SlotId, type V3 } from '../build/PartBuilder';
import { dirOf, hairOuter, hairline, hatSeat, shell } from './hair';

const DEG = Math.PI / 180;
const BONES = ['Head' as const];

export function buildHat(b: PartBuilder, h: HeadShape, hatId: string, hairId: string): void {
  if (hatId === 'hat.none') return;
  const seat = hatSeat(hairId);
  const c = h.center;
  const flip = hatId === 'hat.bonetras' ? -1 : 1;
  /** Hat-local (meters around the bare skull's center, +z = face) to rig space. */
  const W = (x: number, y: number, z: number): V3 => [c[0] + flip * x * seat.k, c[1] + seat.lift + y * seat.k, c[2] + flip * z * seat.k];
  const k = seat.k;
  /** Vertical stack of rings around the head (crowns, bands). Profile rows: [y, half-width x, half-depth z]. */
  const crown = (rows: [number, number, number][], slot: SlotId, capEnd: 'round' | 'flat', capScale = 0.6, ripple?: { amp: number; freq: number }) =>
    b.tube(
      rows.map(([y, ra, rb]): RingSpec => ({ p: W(0, y, -0.0035), ra: ra * k, rb: rb * k })),
      { slot, bones: BONES, ref: [1, 0, 0], segments: 24, capStart: 'flat', capEnd, capScale, ripple },
    );
  const band = (y0: number, y1: number, ra: number, rb: number, slot: SlotId) =>
    crown([[y0, ra, rb], [y1, ra - 0.001, rb - 0.001]], slot, 'flat');

  switch (hatId) {
    case 'hat.palha': {
      // Festa junina straw hat: wide frayed brim, round crown, colored band and two patches.
      b.flower(W(0, 0.045, -0.0035), [0, 1, 0], 0.235 * k, 0.008 * k, 34, { slot: Slot.HAT, bones: BONES }, 0.06, 0, 102);
      crown([[0.03, 0.124, 0.132], [0.08, 0.122, 0.13], [0.13, 0.112, 0.118], [0.16, 0.09, 0.095]], Slot.HAT, 'round', 0.5);
      band(0.05, 0.078, 0.128, 0.136, Slot.HAT_ACCENT);
      for (const [x, y, slot] of [[0.05, 0.11, Slot.POLLEN], [-0.035, 0.125, Slot.LEAF]] as const) {
        const n: V3 = [x * 6, 0.25, 1];
        const z = Math.sqrt(Math.max(0, 0.12 * 0.12 - x * x)) + 0.004;
        b.roundedBox(W(x, y, z), [0.018 * k, 0.015 * k, 0.003 * k], { slot, bones: BONES, outline: 0.4 }, 4, 10, 6, facing(n));
      }
      break;
    }
    case 'hat.cangaceiro': {
      // Leather hat of the sertão: low crown, a half-moon brim turned up in front (and a smaller one behind),
      // a star and a row of coins.
      crown([[0.03, 0.124, 0.132], [0.09, 0.118, 0.126], [0.13, 0.095, 0.1]], Slot.HAT, 'round', 0.6);
      /**
       * Brim surface: u ∈ [-1, 1] around the head, v ∈ [0, 1] up the brim, `out` = offset along its normal. The
       * crescent's points stick out past the sides of the head and curl up a little.
       */
      const moon = (u: number, v: number, back: boolean, height: number, out = 0): V3 => {
        const th = u * 92 * DEG + (back ? Math.PI : 0);
        const tip = Math.pow(Math.abs(u), 3);
        const hgt = 0.022 + height * Math.pow(1 - u * u, 0.5) + 0.035 * tip;
        const lean = v * hgt * 0.28;
        const rad = 0.142 + v * 0.028 + 0.075 * tip + out * 0.94;
        return W(Math.sin(th) * (rad - lean * 0.2), 0.035 + v * hgt + out * 0.34, Math.cos(th) * (rad + 0.008 - lean));
      };
      for (const [back, height] of [[false, 0.17], [true, 0.09]] as const) {
        const grid: V3[][] = [];
        for (let i = 0; i <= 6; i++) {
          const row: V3[] = [];
          for (let j = 0; j <= 16; j++) row.push(moon(-1 + (2 * j) / 16, i / 6, back, height));
          grid.push(row);
        }
        b.slab(grid, 0.012 * k, { slot: Slot.HAT, bones: BONES });
      }
      // The front brim leans back, so its outward normal points forward and up.
      // Five-pointed star, one point straight up (spin and sample count put the points on vertices).
      b.flower(moon(0, 0.52, false, 0.17, 0.007), [0, 0.3, 0.95], 0.036 * k, 0.005 * k, 5, { slot: Slot.HAT_ACCENT, bones: BONES, outline: 0.5 }, 0.55, -0.3 * Math.PI, 40, true);
      for (let j = -5; j <= 5; j++) {
        if (j === 0) continue;
        const u = j / 6;
        const th = u * 92 * DEG;
        b.ellipsoid(moon(u, 0.86, false, 0.17, 0.007), [0.008 * k, 0.008 * k, 0.003 * k], { slot: Slot.HAT_ACCENT, bones: BONES, outline: 0.4 }, 8, 4, facing([Math.sin(th), 0.3, Math.cos(th)]));
      }
      break;
    }
    case 'hat.malandro': {
      // Samba malandro's hat: medium brim snapped down in front, flat-topped crown, dark band.
      const tilt = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(0.1));
      b.ellipsoid(W(0, 0.042, 0.0), [0.2 * k, 0.007 * k, 0.21 * k], { slot: Slot.HAT, bones: BONES }, 28, 6, tilt);
      crown([[0.035, 0.125, 0.133], [0.1, 0.118, 0.126], [0.152, 0.106, 0.113]], Slot.HAT, 'round', 0.3);
      band(0.047, 0.072, 0.129, 0.137, Slot.HAT_ACCENT);
      break;
    }
    case 'hat.bone':
    case 'hat.bonetras': {
      // Flat-brim cap: six-panel dome, top button, front patch. "Pra trás" is the same cap turned around.
      crown([[0.02, 0.13, 0.14], [0.07, 0.127, 0.136], [0.12, 0.108, 0.115], [0.155, 0.07, 0.074]], Slot.HAT, 'round', 0.8);
      b.ellipsoid(W(0, 0.032, 0.155), [0.105 * k, 0.007 * k, 0.092 * k], { slot: Slot.HAT, bones: BONES }, 20, 6);
      b.ellipsoid(W(0, 0.162, -0.0035), [0.014 * k, 0.008 * k, 0.014 * k], { slot: Slot.HAT_ACCENT, bones: BONES }, 8, 5);
      b.roundedBox(W(0, 0.088, 0.128), [0.03 * k, 0.02 * k, 0.004 * k], { slot: Slot.HAT_ACCENT, bones: BONES, outline: 0.4 }, 4, 10, 6, facing([0, 0.35, flip]));
      break;
    }
    case 'hat.touca': {
      // Ribbed beanie over the hair down to the brows, with a folded cuff.
      const pm = hairline(() => 72 * DEG, 93 * DEG, 104 * DEG);
      shell(b, h, { phiMax: pm, outer: () => 1.1, outerAt: (t, phi) => hairOuter(h, hairId, dirOf(t, phi), 0.014 + 0.003 * Math.sin(28 * t)), slot: Slot.HAT }, 56, 10);
      const cuff: V3[] = [];
      for (let i = 0; i < 28; i++) {
        const t = -Math.PI + (i / 28) * Math.PI * 2;
        cuff.push(hairOuter(h, hairId, dirOf(t, pm(t) - 7 * DEG), 0.02));
      }
      b.loop(cuff, 0.022, 0.011, { slot: Slot.HAT_ACCENT, bones: BONES }, 8);
      break;
    }
    case 'hat.bandana': {
      // Kerchief tied at the nape: two tails, scattered little prints.
      const pm = hairline(() => 64 * DEG, 88 * DEG, 108 * DEG);
      shell(b, h, { phiMax: pm, outer: () => 1.1, outerAt: (t, phi) => hairOuter(h, hairId, dirOf(t, phi), 0.01), slot: Slot.HAT }, 44, 10);
      const knot = hairOuter(h, hairId, dirOf(Math.PI, 102 * DEG), 0.018);
      b.ellipsoid(knot, [0.03, 0.022, 0.02], { slot: Slot.HAT, bones: BONES }, 10, 6);
      for (const s of [1, -1]) {
        b.tube(
          [
            { p: knot, ra: 0.02, rb: 0.006 },
            { p: [knot[0] + s * 0.025, knot[1] - 0.045, knot[2] - 0.012], ra: 0.016, rb: 0.005 },
            { p: [knot[0] + s * 0.04, knot[1] - 0.09, knot[2] - 0.016], ra: 0.006, rb: 0.004 },
          ],
          { slot: Slot.HAT, bones: BONES, ref: [1, 0, 0], segments: 8, capStart: 'flat', capEnd: 'round' },
        );
      }
      for (const [t, phi] of [[0, 0.5], [0.6, 0.75], [-0.6, 0.8], [1.3, 0.55], [-1.3, 0.6], [2.2, 0.9], [-2.3, 0.85], [3.0, 0.6], [0.3, 0.15], [-0.9, 0.3]] as const) {
        const d = dirOf(t, phi);
        b.flower(hairOuter(h, hairId, d, 0.013), [d.x, d.y, d.z], 0.011, 0.003, 4, { slot: Slot.HAT_ACCENT, bones: BONES, outline: 0 }, 0.5, t, 16);
      }
      break;
    }
    case 'hat.turbante': {
      // Wrapped turban: a tall volume tilted back over the nape and two twisted bands crossing in front.
      const tilt = new THREE.Matrix4().makeRotationX(-0.25);
      const T = (x: number, y: number, z: number): V3 => {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(tilt);
        return W(v.x, v.y, v.z);
      };
      const rows: [number, number, number][] = [[0.02, 0.13, 0.14], [0.07, 0.146, 0.156], [0.12, 0.15, 0.16], [0.18, 0.136, 0.143], [0.225, 0.09, 0.095]];
      b.tube(
        rows.map(([y, ra, rb]) => ({ p: T(0, y, -0.0035), ra: ra * k, rb: rb * k })),
        { slot: Slot.HAT, bones: BONES, ref: [1, 0, 0], segments: 24, capStart: 'flat', capEnd: 'round', capScale: 0.6 },
      );
      for (const [roll, slot] of [[0.38, Slot.HAT_ACCENT], [-0.38, Slot.HAT]] as const) {
        const m = new THREE.Matrix4().makeRotationZ(roll);
        const pts: V3[] = [];
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const v = new THREE.Vector3(Math.sin(a) * 0.15, 0, Math.cos(a) * 0.16).applyMatrix4(m);
          pts.push(T(v.x, v.y + 0.11, v.z - 0.0035));
        }
        b.loop(pts, 0.022 * k, 0.016 * k, { slot, bones: BONES }, 8);
      }
      break;
    }
    case 'hat.flores': {
      // Carnival flower crown: a leafy wreath with flowers in the hat color and white, yellow hearts.
      const wreath: V3[] = [];
      const ring = (a: number): V3 => W(Math.sin(a) * 0.124, 0.075, Math.cos(a) * 0.132 - 0.0035);
      for (let i = 0; i < 24; i++) wreath.push(ring((i / 24) * Math.PI * 2));
      b.loop(wreath, 0.008 * k, 0.008 * k, { slot: Slot.LEAF, bones: BONES }, 6);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const n = new THREE.Vector3(Math.sin(a), 0.45, Math.cos(a)).normalize();
        const p = ring(a);
        const at: V3 = [p[0] + n.x * 0.008, p[1] + n.y * 0.008, p[2] + n.z * 0.008];
        b.flower(at, [n.x, n.y, n.z], 0.03 * k, 0.008 * k, 5, { slot: i % 2 ? Slot.HAT_ACCENT : Slot.HAT, bones: BONES, outline: 0.5 }, 0.4, a, 20);
        b.ellipsoid([at[0] + n.x * 0.007, at[1] + n.y * 0.007, at[2] + n.z * 0.007], [0.009 * k, 0.009 * k, 0.005 * k], { slot: Slot.POLLEN, bones: BONES, outline: 0 }, 8, 4, facing([n.x, n.y, n.z]));
        const la = a + Math.PI / 10;
        const ln = new THREE.Vector3(Math.sin(la), 0.2, Math.cos(la)).normalize();
        const lp = ring(la);
        b.ellipsoid(lp, [0.022 * k, 0.01 * k, 0.004 * k], { slot: Slot.LEAF, bones: BONES, outline: 0.3 }, 8, 4, facing([ln.x, ln.y, ln.z]));
      }
      break;
    }
    default:
      break;
  }
}

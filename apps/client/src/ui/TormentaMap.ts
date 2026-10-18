/**
 * TormentaMap: the whole planet on a small disc, centred on the player. Azimuthal around the player with a
 * logarithmic radius: directions are true, the ground nearby keeps a readable size and the far side of the planet
 * (the antipode) is the rim, so a safe region on the other side of the world still shows where it is.
 *
 * The safe region is a plain fill, the Tormenta a hatched one, the region it closes onto a dashed outline, the player
 * the arrow in the middle (shapes and patterns, never colour only). Opponents never appear on it.
 *
 * Cheap by construction: the disc is redrawn about 10 times a second in a frame fixed to the planet at the player
 * (its local north); the camera heading only rotates the canvas through CSS, so turning stays smooth at no cost.
 */
import type { Vec3 } from '@graao/shared';

interface Cap {
  center: Vec3;
  /** Angular radius (rad). */
  radius: number;
}

export interface TormentaMapView {
  /** Unit direction from the planet centre to the player. */
  up: Vec3;
  /** Camera heading on the tangent plane. */
  forward: Vec3;
  right: Vec3;
  /** The safe region now, and the region it closes onto (null in the final region). */
  safe: Cap;
  next: Cap | null;
}

const SIZE = 116;
const SAMPLES = 96;
/** Logarithmic radius: k sets how much the ground near the player is magnified against the far side. */
const K = 6;
const NORM = Math.log1p(K * Math.PI);
const REDRAW_MS = 100;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export class TormentaMap {
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private hatch: CanvasPattern | null = null;
  private dpr = 0;
  private nextDraw = 0;
  private readonly north: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly east: Vec3 = { x: 1, y: 0, z: 0 };
  private readonly drawnNorth: Vec3 = { x: 0, y: 0, z: 0 };
  private lastKey = '';
  private readonly pts = new Float32Array(SAMPLES * 2);

  constructor() {
    this.el.className = 'torm-map';
    this.canvas.className = 'torm-map-disc';
    this.ctx = this.canvas.getContext('2d')!;
    const me = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    me.setAttribute('class', 'torm-map-me');
    me.setAttribute('viewBox', '-10 -10 20 20');
    me.innerHTML = '<path d="M0 -7 L5.5 6 L0 3 L-5.5 6 Z"/>';
    const legend = document.createElement('div');
    legend.className = 'torm-map-legend';
    legend.innerHTML = '<span><i class="sw storm"></i>Tormenta</span><span><i class="sw next"></i>próxima</span>';
    this.el.append(this.canvas, me, legend);
  }

  /** Per frame while shown. */
  update(v: TormentaMapView): void {
    const up = v.up;
    // The planet's local north at the player (world Y on the tangent plane; X near the poles), and east from the
    // camera's own handedness, so a point straight ahead lands straight up once the canvas turns by the heading.
    const ax = Math.abs(up.y) < 0.98 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const d = dot(ax, up);
    const n = this.north;
    n.x = ax.x - up.x * d;
    n.y = ax.y - up.y * d;
    n.z = ax.z - up.z * d;
    const nl = Math.hypot(n.x, n.y, n.z) || 1;
    n.x /= nl;
    n.y /= nl;
    n.z /= nl;
    const f = v.forward;
    const r = v.right;
    const hand = (f.y * r.z - f.z * r.y) * up.x + (f.z * r.x - f.x * r.z) * up.y + (f.x * r.y - f.y * r.x) * up.z < 0 ? -1 : 1;
    const e = this.east;
    e.x = hand * (up.y * n.z - up.z * n.y);
    e.y = hand * (up.z * n.x - up.x * n.z);
    e.z = hand * (up.x * n.y - up.y * n.x);
    const heading = Math.atan2(dot(f, e), dot(f, n));
    this.canvas.style.transform = `rotate(${(-heading).toFixed(4)}rad)`;

    // Redraw on the clock, or at once when the frame itself turned (crossing near a pole) or a new phase began.
    const now = performance.now();
    const key = `${v.safe.radius >= Math.PI - 1e-4}|${v.next ? v.next.radius.toFixed(4) : '-'}`;
    if (now < this.nextDraw && dot(n, this.drawnNorth) > 0.9995 && key === this.lastKey) return;
    this.nextDraw = now + REDRAW_MS;
    this.lastKey = key;
    this.drawnNorth.x = n.x;
    this.drawnNorth.y = n.y;
    this.drawnNorth.z = n.z;
    this.draw(v);
  }

  private draw(v: TormentaMapView): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.canvas.width = this.canvas.height = Math.round(SIZE * dpr);
      this.hatch = null;
    }
    const ctx = this.ctx;
    const R = (SIZE / 2) * dpr;
    const rim = R - 1.5 * dpr;
    if (!this.hatch) this.hatch = this.makeHatch(dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(R, R);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rim, 0, Math.PI * 2);
    ctx.clip();

    const safe = v.safe;
    const whole = safe.radius >= Math.PI - 1e-4;
    // The cap holding the far side of the planet maps onto the rim (background); the other one is the closed curve.
    const safeHoldsAntipode = whole || Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(safe.center, v.up)))) < safe.radius;
    const paint = (storm: boolean) => {
      ctx.fillStyle = storm ? '#e9e4da' : '#cfe3b4';
      ctx.fill();
      if (storm) {
        ctx.fillStyle = this.hatch!;
        ctx.fill();
      }
    };
    ctx.beginPath();
    ctx.rect(-R, -R, 2 * R, 2 * R);
    paint(!safeHoldsAntipode);
    if (!whole) {
      this.trace(safe, v.up, rim);
      paint(safeHoldsAntipode);
      ctx.lineWidth = 2.2 * dpr;
      ctx.strokeStyle = '#2a2130';
      ctx.stroke();
    }
    // A faint ring 50 m away along the ground, for scale.
    ctx.beginPath();
    ctx.arc(0, 0, rim * (Math.log1p(K * 0.5) / NORM), 0, Math.PI * 2);
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgba(42, 33, 48, .22)';
    ctx.stroke();
    const next = v.next;
    if (next && next.radius < safe.radius - 1e-6) {
      this.trace(next, v.up, rim);
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.lineWidth = 3.6 * dpr;
      ctx.strokeStyle = '#2a2130';
      ctx.stroke();
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, rim, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = '#2a2130';
    ctx.stroke();
  }

  /** The projected boundary of a cap as the current path (closed). */
  private trace(cap: Cap, up: Vec3, rim: number): void {
    const c = cap.center;
    const base = Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    // t1 = normalize(c × base), t2 = c × t1: the cap's own tangent frame.
    let t1x = c.y * base.z - c.z * base.y;
    let t1y = c.z * base.x - c.x * base.z;
    let t1z = c.x * base.y - c.y * base.x;
    const tl = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= tl;
    t1y /= tl;
    t1z /= tl;
    const t2x = c.y * t1z - c.z * t1y;
    const t2y = c.z * t1x - c.x * t1z;
    const t2z = c.x * t1y - c.y * t1x;
    const cr = Math.cos(cap.radius);
    const sr = Math.sin(cap.radius);
    const n = this.north;
    const e = this.east;
    const pts = this.pts;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      const ca = Math.cos(a) * sr;
      const sa = Math.sin(a) * sr;
      const px = c.x * cr + t1x * ca + t2x * sa;
      const py = c.y * cr + t1y * ca + t2y * sa;
      const pz = c.z * cr + t1z * ca + t2z * sa;
      const d = Math.max(-1, Math.min(1, px * up.x + py * up.y + pz * up.z));
      // Bearing from the tangent part, distance from the angle (log radius).
      const tx = px - up.x * d;
      const ty = py - up.y * d;
      const tz = pz - up.z * d;
      const bx = tx * e.x + ty * e.y + tz * e.z;
      const by = tx * n.x + ty * n.y + tz * n.z;
      const bl = Math.hypot(bx, by);
      const rho = (Math.log1p(K * Math.acos(d)) / NORM) * rim;
      pts[i * 2] = bl > 1e-9 ? (rho * bx) / bl : 0;
      pts[i * 2 + 1] = bl > 1e-9 ? (-rho * by) / bl : -rho;
    }
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 1; i < SAMPLES; i++) ctx.lineTo(pts[i * 2]!, pts[i * 2 + 1]!);
    ctx.closePath();
  }

  /** Diagonal pencil hatching for the Tormenta (a pattern, so it reads without colour). */
  private makeHatch(dpr: number): CanvasPattern | null {
    const s = Math.round(7 * dpr);
    const tile = document.createElement('canvas');
    tile.width = tile.height = s;
    const g = tile.getContext('2d')!;
    g.strokeStyle = 'rgba(74, 69, 77, .55)';
    g.lineWidth = 1.2 * dpr;
    g.beginPath();
    g.moveTo(-1, s + 1);
    g.lineTo(s + 1, -1);
    g.moveTo(-1, 1);
    g.lineTo(1, -1);
    g.moveTo(s - 1, s + 1);
    g.lineTo(s + 1, s - 1);
    g.stroke();
    return this.ctx.createPattern(tile, 'repeat');
  }
}

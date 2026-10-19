/**
 * WindDirector (client): what the map's wind volumes look and sound like (docs/gameplay/WIND_VOLUMES.md). The force
 * itself is the shared motor's (game-core wind.ts) — this only presents it:
 *
 * - Streaks: thin pale ribbons rising up an updraft's column or crossing a directional wind's, each a cylindrical
 *   billboard (long axis along the flow, face turned to the camera), and a few leaves spinning up the updrafts. One
 *   InstancedMesh for every streak and one for every leaf (2 draw calls); volumes far from the camera are skipped.
 *   Event winds (a rung bell's) fade in while they blow and out when they stop.
 * - Sound: a soft gusting bed (WorldAudio) whose level follows how close the listener is to a volume.
 * - A hint the first times the player is in an updraft without the glider: hold jump.
 */
import * as THREE from 'three';
import { sampleWind, newWindSample, windSide, type WindVolume } from '@graao/game-core';
import { TRAVERSAL, TraversalMode } from '@graao/game-data';
import type { GraaoApp } from '../app/GraaoApp';
import { keyLabel } from './KeyBindings';

const STREAKS_UPDRAFT = 26;
const STREAKS_DIRECTIONAL = 30;
const LEAVES = 7;
/** Volumes farther than this from the camera are not drawn (m). */
const DRAW_RANGE = 95;
const LEAF_COLORS = ['#c9a23a', '#8fb34a', '#d9792f', '#b5c46a'];

interface Streak {
  vol: number;
  /** Phase along the flow (0..1), angle and radius fraction across the column, height fraction (directional). */
  t: number;
  a: number;
  rf: number;
  hf: number;
  speed: number;
}

export class WindDirector {
  private readonly vols: readonly WindVolume[];
  private readonly streaks: Streak[] = [];
  private readonly leaves: Streak[] = [];
  private readonly streakMesh: THREE.InstancedMesh;
  private readonly leafMesh: THREE.InstancedMesh;
  /** 0..1 per volume: event winds fade in while blowing. */
  private readonly level: number[];
  private readonly sample = newWindSample();
  private hintAt = -Infinity;
  private hints = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly xAxis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();

  constructor(private readonly app: GraaoApp) {
    this.vols = app.world.physics.winds;
    this.level = this.vols.map((v) => (v.trigger ? 0 : 1));
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const v of this.vols) {
      const n = v.kind === 'updraft' ? STREAKS_UPDRAFT : STREAKS_DIRECTIONAL;
      for (let i = 0; i < n; i++) this.streaks.push({ vol: v.index, t: rnd(), a: rnd() * Math.PI * 2, rf: Math.sqrt(rnd()) * 0.92, hf: rnd(), speed: 0.75 + rnd() * 0.5 });
      if (v.kind === 'updraft') for (let i = 0; i < LEAVES; i++) this.leaves.push({ vol: v.index, t: rnd(), a: rnd() * Math.PI * 2, rf: 0.2 + rnd() * 0.6, hf: rnd(), speed: 0.5 + rnd() * 0.4 });
    }
    // A ribbon 1 m long along +Y, 14 cm wide along X, facing +Z, tapered at both ends.
    const ribbon = new THREE.PlaneGeometry(0.14, 1, 1, 4);
    const pos = ribbon.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * Math.cos(pos.getY(i) * Math.PI));
    const streakMat = new THREE.MeshBasicMaterial({ color: '#f4feff', transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.streakMesh = new THREE.InstancedMesh(ribbon, streakMat, Math.max(1, this.streaks.length));
    this.streakMesh.name = 'WindStreaks';
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 3;
    const leaf = new THREE.PlaneGeometry(0.13, 0.08);
    const leafMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, fog: true });
    this.leafMesh = new THREE.InstancedMesh(leaf, leafMat, Math.max(1, this.leaves.length));
    this.leafMesh.name = 'WindLeaves';
    this.leafMesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < this.leaves.length; i++) this.leafMesh.setColorAt(i, c.set(LEAF_COLORS[i % LEAF_COLORS.length]!));
    this.streakMesh.visible = this.leafMesh.visible = this.vols.length > 0;
    app.r.scene.add(this.streakMesh, this.leafMesh);
  }

  update(dt: number): void {
    if (!this.vols.length) return;
    const app = this.app;
    const cam = app.r.camera.position;
    const on = app.local.motor.windActive;
    for (const v of this.vols) {
      const goal = !v.trigger || on?.has(v.index) ? 1 : 0;
      this.level[v.index] = THREE.MathUtils.damp(this.level[v.index]!, goal, goal ? 1.6 : 0.9, dt);
    }
    // Which volumes are near enough to draw (and how loud they are for the ear).
    let loud = 0;
    const near = this.vols.map((v) => {
      const d = this.distanceToAxis(v, cam);
      if (this.level[v.index]! > 0.01) loud = Math.max(loud, this.level[v.index]! * (1 - THREE.MathUtils.smoothstep(d, v.radius, v.radius + 22)));
      return d < DRAW_RANGE && this.level[v.index]! > 0.01;
    });
    app.interactives.sound.wind(loud * (app.phase === 'MATCH' || app.phase === 'MENU' ? 1 : 0.5));
    this.drawStreaks(dt, near, cam);
    this.drawLeaves(dt, near);
    this.hint();
  }

  /** Distance (m) from a point to a volume's axis segment. */
  private distanceToAxis(v: WindVolume, p: THREE.Vector3): number {
    const dx = p.x - v.base.x, dy = p.y - v.base.y, dz = p.z - v.base.z;
    const along = Math.max(0, Math.min(v.height, dx * v.axis.x + dy * v.axis.y + dz * v.axis.z));
    return Math.hypot(dx - v.axis.x * along, dy - v.axis.y * along, dz - v.axis.z * along);
  }

  private drawStreaks(dt: number, near: boolean[], cam: THREE.Vector3): void {
    const mesh = this.streakMesh;
    for (let i = 0; i < this.streaks.length; i++) {
      const st = this.streaks[i]!;
      const v = this.vols[st.vol]!;
      if (!near[st.vol]) {
        this.m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, this.m);
        continue;
      }
      const flowSpeed = Math.max(2.5, v.strength) * st.speed;
      const span = v.kind === 'updraft' ? v.height : v.radius * 2;
      st.t = (st.t + (dt * flowSpeed) / span) % 1;
      const fade = Math.sin(st.t * Math.PI) * this.level[st.vol]!;
      const side = windSide(v);
      const ax = v.axis;
      if (v.kind === 'updraft') {
        // Spiralling up the column.
        const a = st.a + st.t * 2.2;
        const r = st.rf * v.radius;
        const fwd = { x: ax.y * side.z - ax.z * side.y, y: ax.z * side.x - ax.x * side.z, z: ax.x * side.y - ax.y * side.x };
        this.p.set(
          v.base.x + ax.x * st.t * v.height + (side.x * Math.cos(a) + fwd.x * Math.sin(a)) * r,
          v.base.y + ax.y * st.t * v.height + (side.y * Math.cos(a) + fwd.y * Math.sin(a)) * r,
          v.base.z + ax.z * st.t * v.height + (side.z * Math.cos(a) + fwd.z * Math.sin(a)) * r,
        );
        this.along.set(ax.x, ax.y, ax.z);
      } else {
        const d = v.dir!;
        const across = (st.rf * 2 - 1) * v.radius * 0.9;
        const s = (st.t * 2 - 1) * v.radius;
        const h = (0.1 + st.hf * 0.8) * v.height;
        this.p.set(
          v.base.x + d.x * s + side.x * across + ax.x * h,
          v.base.y + d.y * s + side.y * across + ax.y * h,
          v.base.z + d.z * s + side.z * across + ax.z * h,
        );
        this.along.set(d.x, d.y, d.z);
      }
      // Cylindrical billboard: Y along the flow, Z toward the camera around it.
      this.toCam.subVectors(cam, this.p);
      this.xAxis.crossVectors(this.along, this.toCam).normalize();
      this.zAxis.crossVectors(this.xAxis, this.along).normalize();
      this.m.makeBasis(this.xAxis, this.along, this.zAxis);
      this.q.setFromRotationMatrix(this.m);
      const len = v.kind === 'updraft' ? 1.6 : 2.0;
      this.s.set(fade, len * (0.4 + 0.6 * fade), 1);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private drawLeaves(dt: number, near: boolean[]): void {
    const mesh = this.leafMesh;
    for (let i = 0; i < this.leaves.length; i++) {
      const lf = this.leaves[i]!;
      const v = this.vols[lf.vol]!;
      if (!near[lf.vol]) {
        this.m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, this.m);
        continue;
      }
      lf.t = (lf.t + (dt * Math.max(2, v.strength) * lf.speed * 0.6) / v.height) % 1;
      const side = windSide(v);
      const ax = v.axis;
      const fwd = { x: ax.y * side.z - ax.z * side.y, y: ax.z * side.x - ax.x * side.z, z: ax.x * side.y - ax.y * side.x };
      const a = lf.a + lf.t * 9;
      const r = lf.rf * v.radius;
      this.p.set(
        v.base.x + ax.x * lf.t * v.height + (side.x * Math.cos(a) + fwd.x * Math.sin(a)) * r,
        v.base.y + ax.y * lf.t * v.height + (side.y * Math.cos(a) + fwd.y * Math.sin(a)) * r,
        v.base.z + ax.z * lf.t * v.height + (side.z * Math.cos(a) + fwd.z * Math.sin(a)) * r,
      );
      this.q.setFromEuler(new THREE.Euler(a * 1.7, a * 1.3, a));
      const k = Math.sin(lf.t * Math.PI) * this.level[lf.vol]!;
      this.s.set(k, k, k);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** The first few times in an updraft without the glider: say how to ride it. */
  private hint(): void {
    const app = this.app;
    const s = app.local.state;
    if (app.phase !== 'MATCH' || !app.combat.alive || this.hints >= 3 || s.traversal === TraversalMode.GLIDE || s.swimming || s.stamina < TRAVERSAL.stamina.minGlide) return;
    const up = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    const l = Math.hypot(up.x, up.y, up.z);
    sampleWind(this.vols, (i) => app.local.motor.windActive?.has(i) ?? false, s.pos, { x: up.x / l, y: up.y / l, z: up.z / l }, this.sample);
    if (this.sample.lift <= 0 && this.sample.push <= 0) return;
    const now = performance.now();
    if (now - this.hintAt < 7000) return;
    this.hintAt = now;
    this.hints++;
    const jump = keyLabel(app.input.bindings.jump);
    app.hud.notice(this.sample.lift > 0 ? `CORRENTE ASCENDENTE · PULE E SEGURE [${jump.toUpperCase()}] PARA PLANAR` : `CORRENTE DE VENTO · SEGURE [${jump.toUpperCase()}] PARA PLANAR COM ELA`, 2.6);
  }
}

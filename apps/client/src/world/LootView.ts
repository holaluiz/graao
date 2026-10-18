/**
 * LootView (GRAChestPresentation + world items): draws every chest and every item on the ground with a handful of
 * instanced meshes, whatever their number: chest bodies, lids and gems (3 draw calls), one mesh per kind of item
 * (weapon model, consumable, ammunition box) and two additive layers for the rarity glow on the ground and the light
 * column over uncommon-and-better items.
 *
 * It is pure presentation: positions and states come from the LootDirector (server truth). Animations (the lid, the
 * squash when a chest reacts, rewards jumping out, hovering and turning items) never move anything authoritative.
 * Chests use the world material (ink outline, Tormenta bleach like the rest of the world); items and their glow use
 * clean, unpigmented materials so rewards stay readable inside the Tormenta.
 */
import * as THREE from 'three';
import { AMMO_TYPES, ITEMS, RARITIES, type ItemId, type WeaponId } from '@graao/game-data';
import { ChestState } from '@graao/shared';
import { weaponDrawable } from '../character/WeaponModels';
import { createStylizedMaterial } from '../render/materials/GRAStylizedMaterial';
import {
  LID_PIVOT,
  ammoBoxGeometry,
  beamGeometry,
  chestBodyGeometry,
  chestGemGeometry,
  chestLidGeometry,
  falloffTexture,
  glowDiscGeometry,
  manaCrystalGeometry,
  nectarGeometry,
  shieldCellGeometry,
} from './lootGeometry';

const MAX_CHESTS = 40;
const MAX_PER_KIND = 64;
const MAX_ITEMS = 200;
/** Lid fully open (rad) and the opening time (s): about the server's openMs, so rewards land as the lid tops out. */
const LID_OPEN = 1.92;
const OPEN_TIME = 0.42;
/** Rewards fly out along an arc in this long (s), one after another. */
const POP_TIME = 0.45;

export interface ChestPose {
  id: number;
  pos: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  state: ChestState;
}

interface ChestView extends ChestPose {
  side: THREE.Vector3;
  slot: number;
  /** Lid angle (rad) and its animation clock. */
  lid: number;
  openT: number;
  opening: boolean;
}

interface ItemView {
  id: number;
  item: ItemId;
  kind: string;
  pos: THREE.Vector3;
  up: THREE.Vector3;
  north: THREE.Vector3;
  phase: number;
  age: number;
  from: THREE.Vector3 | null;
  delay: number;
  leaving: number;
}

const kindOf = (item: ItemId): string => {
  const d = ITEMS[item];
  return d.kind === 'weapon' ? `weapon:${d.weapon}` : d.kind === 'ammo' ? `ammo:${d.ammo}` : d.visual;
};

/** Hover height (m) and scale of each kind of item. */
const HOVER: Record<string, { y: number; s: number }> = { weapon: { y: 0.34, s: 1.25 }, ammo: { y: 0.08, s: 1.15 }, item: { y: 0.14, s: 1.3 } };
const hoverOf = (kind: string) => HOVER[kind.startsWith('weapon') ? 'weapon' : kind.startsWith('ammo') ? 'ammo' : 'item']!;

const easeOutBack = (t: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

export class LootView {
  readonly group = new THREE.Group();
  private readonly chestMaterial = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0.05 });
  private readonly itemMaterial = createStylizedMaterial({ variant: 'world', vertexColors: true, pigment: 0, edgePooling: 0, tormenta: false });
  private readonly bodies: THREE.InstancedMesh;
  private readonly lids: THREE.InstancedMesh;
  private readonly gems: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  private readonly itemMeshes = new Map<string, THREE.InstancedMesh>();
  private readonly chests = new Map<number, ChestView>();
  private readonly items = new Map<number, ItemView>();
  private chestsDirty = true;
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    this.group.name = 'loot';
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, color = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = name;
      mesh.count = 0;
      // Instances spread over the whole planet: a bounding sphere would be the planet anyway.
      mesh.frustumCulled = false;
      if (color) for (let i = 0; i < n; i++) mesh.setColorAt(i, this.c.set('#ffffff'));
      this.group.add(mesh);
      return mesh;
    };
    this.bodies = inst(chestBodyGeometry(), this.chestMaterial, MAX_CHESTS, 'loot.chestBodies');
    this.lids = inst(chestLidGeometry(), this.chestMaterial, MAX_CHESTS, 'loot.chestLids');
    this.bodies.castShadow = this.lids.castShadow = true;
    this.gems = inst(chestGemGeometry(), new THREE.MeshBasicMaterial({ toneMapped: false, fog: true }), MAX_CHESTS, 'loot.chestGems', true);
    const additive = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, fog: true });
    this.glow = inst(glowDiscGeometry(), additive(falloffTexture('radial')), MAX_ITEMS, 'loot.glow', true);
    this.beams = inst(beamGeometry(), additive(falloffTexture('vertical')), MAX_ITEMS, 'loot.beams', true);
    this.glow.renderOrder = this.beams.renderOrder = 2;
    // One mesh per kind of item.
    for (const id of ['sunbeam', 'petal', 'pistol', 'ak47', 'sniper', 'smg', 'launcher'] as WeaponId[]) {
      const d = weaponDrawable(id);
      this.itemMeshes.set(`weapon:${id}`, inst(d.geometry, d.material, MAX_PER_KIND, `loot.weapon.${id}`));
    }
    for (const t of AMMO_TYPES) this.itemMeshes.set(`ammo:${t}`, inst(ammoBoxGeometry(t), this.itemMaterial, MAX_PER_KIND, `loot.ammo.${t}`));
    this.itemMeshes.set('nectar', inst(nectarGeometry(), this.itemMaterial, MAX_PER_KIND, 'loot.nectar'));
    this.itemMeshes.set('shield_cell', inst(shieldCellGeometry(), this.itemMaterial, MAX_PER_KIND, 'loot.shieldCell'));
    this.itemMeshes.set('mana_crystal', inst(manaCrystalGeometry(), this.itemMaterial, MAX_PER_KIND, 'loot.manaCrystal'));
    for (const mesh of this.itemMeshes.values()) mesh.castShadow = true;
  }

  // ------------------------------------------------------------------------------------------------ chests

  /** Replaces every chest (a new loot generation, or the room's state on joining). */
  setChests(list: ChestPose[]): void {
    this.chests.clear();
    list.slice(0, MAX_CHESTS).forEach((p, slot) => {
      const side = new THREE.Vector3().crossVectors(p.up, p.forward).normalize();
      const open = p.state !== ChestState.CLOSED;
      this.chests.set(p.id, { ...p, side, slot, lid: open ? LID_OPEN : 0, openT: open ? OPEN_TIME : 0, opening: false });
    });
    this.chestsDirty = true;
  }

  /** A chest changed state; `animate` plays the opening (live), otherwise it just snaps (joined late). */
  setChestState(id: number, state: ChestState, animate: boolean): void {
    const c = this.chests.get(id);
    if (!c) return;
    const wasClosed = c.state === ChestState.CLOSED;
    c.state = state;
    if (state !== ChestState.CLOSED && wasClosed) {
      if (animate) {
        c.opening = true;
        c.openT = 0;
      } else {
        c.lid = LID_OPEN;
        c.openT = OPEN_TIME;
      }
    }
    this.chestsDirty = true;
  }

  chest(id: number): Readonly<ChestPose> | undefined {
    return this.chests.get(id);
  }

  // ------------------------------------------------------------------------------------------------ items

  /** A new item on the ground; `from` makes it jump out of there (a chest's mouth) after `delay` s. */
  addItem(id: number, item: ItemId, pos: THREE.Vector3, from: THREE.Vector3 | null = null, delay = 0): void {
    if (this.items.has(id) || this.items.size >= MAX_ITEMS) return;
    const up = pos.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-6) north.set(0, 0, 1).addScaledVector(up, -up.z);
    north.normalize();
    this.items.set(id, { id, item, kind: kindOf(item), pos: pos.clone(), up, north, phase: (id * 2.399) % (Math.PI * 2), age: 0, from: from?.clone() ?? null, delay, leaving: -1 });
  }

  /** Taken (or cleared): shrinks away quickly when `animate`. */
  removeItem(id: number, animate: boolean): void {
    const it = this.items.get(id);
    if (!it) return;
    if (animate) it.leaving = Math.max(0, it.leaving);
    else this.items.delete(id);
  }

  hasItem(id: number): boolean {
    const it = this.items.get(id);
    return !!it && it.leaving < 0;
  }

  /** Where an item is drawn right now (labels, pickup effects). */
  itemDrawPos(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const it = this.items.get(id);
    if (!it) return null;
    return out.copy(it.pos).addScaledVector(it.up, hoverOf(it.kind).y + 0.1);
  }

  clear(): void {
    this.chests.clear();
    this.items.clear();
    this.chestsDirty = true;
  }

  // ------------------------------------------------------------------------------------------------ frame

  update(dt: number, time: number): void {
    this.updateChests(dt, time);
    this.updateItems(dt, time);
  }

  private updateChests(dt: number, time: number): void {
    let animating = false;
    for (const c of this.chests.values()) {
      if (!c.opening) continue;
      c.openT += dt;
      const k = Math.min(1, Math.max(0, (c.openT - 0.06) / (OPEN_TIME - 0.06)));
      c.lid = LID_OPEN * easeOutBack(k);
      if (c.openT >= OPEN_TIME + 0.25) c.opening = false;
      animating = true;
    }
    if (animating || this.chestsDirty) {
      this.chestsDirty = false;
      let i = 0;
      for (const c of this.chests.values()) {
        // A little squash and stretch when the latch gives (the chest "reacts").
        const sq = c.opening ? Math.sin(Math.min(1, c.openT / 0.28) * Math.PI) : 0;
        const sy = 1 - 0.1 * sq;
        const sxz = 1 + 0.06 * sq;
        this.m.makeBasis(c.side, c.up, c.forward).setPosition(c.pos.x - c.up.x * 0.02, c.pos.y - c.up.y * 0.02, c.pos.z - c.up.z * 0.02);
        this.m.multiply(this.m2.makeScale(sxz, sy, sxz));
        this.bodies.setMatrixAt(i, this.m);
        this.m.multiply(this.m2.makeTranslation(LID_PIVOT.x, LID_PIVOT.y, LID_PIVOT.z)).multiply(this.m2.makeRotationX(-c.lid));
        this.lids.setMatrixAt(i, this.m);
        this.gems.setMatrixAt(i, this.m);
        i++;
      }
      this.bodies.count = this.lids.count = this.gems.count = i;
      this.bodies.instanceMatrix.needsUpdate = this.lids.instanceMatrix.needsUpdate = this.gems.instanceMatrix.needsUpdate = true;
    }
    // The gem breathes while the chest is closed, glows warm while it opens, then goes dark.
    let i = 0;
    for (const c of this.chests.values()) {
      if (c.state === ChestState.CLOSED) this.c.set('#7ff3ff').multiplyScalar(1.15 + 0.55 * Math.sin(time * 2.6 + c.id * 1.7));
      else if (c.state === ChestState.EMPTY) this.c.set('#5a5560');
      else this.c.set('#ffd36e').multiplyScalar(c.opening ? 2.2 : 0.9);
      this.gems.setColorAt(i++, this.c);
    }
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    this.bodies.visible = this.lids.visible = this.gems.visible = this.chests.size > 0;
  }

  private updateItems(dt: number, time: number): void {
    const counts = new Map<string, number>();
    let g = 0;
    let b = 0;
    for (const it of this.items.values()) {
      it.age += dt;
      if (it.leaving >= 0) {
        it.leaving += dt;
        if (it.leaving > 0.16) {
          this.items.delete(it.id);
          continue;
        }
      }
      const hv = hoverOf(it.kind);
      let scale = hv.s;
      const p = this.v.copy(it.pos);
      // Jumping out of the chest: an arc from its mouth to the resting point, growing on the way.
      const t = it.age - it.delay;
      let settled = 1;
      if (it.from) {
        if (t < 0) continue;
        const u = Math.min(1, t / POP_TIME);
        settled = u;
        p.lerpVectors(it.from, it.pos, u).addScaledVector(it.up, Math.sin(u * Math.PI) * 0.75);
        scale *= 0.35 + 0.65 * u;
      }
      if (it.leaving >= 0) scale *= 1 - it.leaving / 0.16;
      const bob = Math.sin(time * 2.2 + it.phase) * 0.045 * settled;
      p.addScaledVector(it.up, (hv.y + bob) * settled);
      const spin = time * 0.9 + it.phase;
      const fwd = this.v2.copy(it.north).applyAxisAngle(it.up, spin);
      const side = this.s.crossVectors(it.up, fwd).normalize();
      this.m.makeBasis(side, it.up, fwd).setPosition(p);
      this.m.multiply(this.m2.makeScale(scale, scale, scale));
      const mesh = this.itemMeshes.get(it.kind);
      const n = counts.get(it.kind) ?? 0;
      if (mesh && n < MAX_PER_KIND) {
        mesh.setMatrixAt(n, this.m);
        counts.set(it.kind, n + 1);
      }
      // Rarity: a glow on the ground (always) and a column of light (uncommon and better), pulsing gently.
      const r = RARITIES[ITEMS[it.item].rarity];
      const pulse = 0.85 + 0.15 * Math.sin(time * 3 + it.phase);
      const fade = settled * (it.leaving >= 0 ? 1 - it.leaving / 0.16 : 1);
      this.m.makeBasis(side, it.up, fwd).setPosition(it.pos.x + it.up.x * 0.03, it.pos.y + it.up.y * 0.03, it.pos.z + it.up.z * 0.03);
      const gs = (0.7 + 0.5 * r.glow) * fade;
      this.m.multiply(this.m2.makeScale(gs, 1, gs));
      this.glow.setMatrixAt(g, this.m);
      this.glow.setColorAt(g++, this.c.set(r.color).multiplyScalar(r.glow * pulse * fade));
      if (r.beam > 0) {
        this.m.makeBasis(side, it.up, fwd).setPosition(it.pos);
        this.m.multiply(this.m2.makeScale(fade, r.beam * fade, fade));
        this.beams.setMatrixAt(b, this.m);
        this.beams.setColorAt(b++, this.c.set(r.color).multiplyScalar(0.55 * pulse * fade));
      }
    }
    for (const [kind, mesh] of this.itemMeshes) {
      const n = counts.get(kind) ?? 0;
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) mesh.instanceMatrix.needsUpdate = true;
    }
    this.glow.count = g;
    this.beams.count = b;
    this.glow.visible = g > 0;
    this.beams.visible = b > 0;
    for (const mesh of [this.glow, this.beams]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Draw calls and triangles this view adds right now (F3 overlay, performance notes). */
  stats(): { drawCalls: number; triangles: number; chests: number; items: number } {
    let dc = 0;
    let tris = 0;
    this.group.traverseVisible((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.count === 0) return;
      dc++;
      const g = mesh.geometry;
      tris += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * mesh.count;
    });
    return { drawCalls: dc, triangles: Math.round(tris), chests: this.chests.size, items: this.items.size };
  }
}

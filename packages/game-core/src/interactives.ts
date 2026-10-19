/**
 * World interactivity (docs/world/WORLD_DESIGN.md, "Interatividade"): the doors of the houses and the breakable crates.
 *
 * - Doors come from the kit's door modules (layout.doors: one per opening, ids in map order). A door is closed or
 *   open; a closed door has one box collider filling the opening (it stops people, shots and sight), an open one has
 *   none (its leaves stand folded against the inside wall). About one door in three starts a match open.
 * - Crates are the kit placements whose cover is 'destrutivel' (layout.crates). They have no static collider: every
 *   room adds its own and takes them away when the crate breaks (hit points, shots and punches).
 * - The server's physics world is shared by every room: each room's colliders live in `physics.interactiveHandles`,
 *   and the room's motor (CharacterMotor.interactiveFilter) and queries (`predicate`) only meet its own.
 *
 * One InteractiveSystem per room on the server (authoritative) and one on the client (it mirrors WORLD_STATE and the
 * door/crate events, so the predicted character collides with exactly what the server's does; offline it decides
 * alone). Big landmarks, walls and houses never break.
 */
import { INTERACTIVES, KIT } from '@graao/game-data';
import { v3cross, v3dot, v3normalize, type GameEvent, type Vec3, type WorldStateMsg, type WorldUseMsg } from '@graao/shared';
import type { DoorDef, Placement, WorldLayout } from './layout';
import { GROUPS_WORLD_QUERY, Group, groups, placementColliderDescs, quatFromBasis, refreshQueries, type GamePhysics } from './physics';

/** A box in the world: centre, half extents along its own side / up / forward axes. */
export interface OrientedBox {
  center: Vec3;
  half: Vec3;
  side: Vec3;
  up: Vec3;
  forward: Vec3;
}

const at = (o: Vec3, side: Vec3, up: Vec3, fwd: Vec3, x: number, y: number, z: number): Vec3 => ({
  x: o.x + side.x * x + up.x * y + fwd.x * z,
  y: o.y + side.y * x + up.y * y + fwd.y * z,
  z: o.z + side.z * x + up.z * y + fwd.z * z,
});

/** Does door `id` start a match open? (Same answer on every machine.) */
export function doorStartsOpen(id: number): boolean {
  return (Math.imul(id + 11, 2654435761) >>> 0) % INTERACTIVES.door.openEvery === 0;
}

/**
 * The leaves of a door at `open` (0 closed … 1 swung 90° into the building): one leaf hinged on the left jamb, or two
 * hinged on both jambs. In the door's frame x runs along the wall, z points out; the hinges sit just inside the
 * opening at the wall's inner face, so a closed leaf fills the opening and an open one stands in the room against the
 * jamb, never in the masonry.
 */
export function doorLeafBoxes(d: DoorDef, open: number): OrientedBox[] {
  const t = INTERACTIVES.door.leafT;
  const a = Math.max(0, Math.min(1, open)) * (Math.PI / 2);
  const y = KIT.floorTop + d.h / 2;
  const hy = d.h / 2 - 0.01;
  // Hinge axis: half a leaf inside each jamb, half a leaf in front of the inner face.
  const hx = d.w / 2 - t / 2 - 0.012;
  const hz = -(KIT.wallT / 2) + t / 2 + 0.006;
  const leaves = d.style === 'dupla' ? [{ hinge: -hx, sgn: 1, len: hx }, { hinge: hx, sgn: -1, len: hx }] : [{ hinge: -hx, sgn: 1, len: 2 * hx }];
  return leaves.map((l) => {
    const dx = l.sgn * Math.cos(a);
    const dz = -Math.sin(a);
    const L = l.len - 0.01;
    const along = v3normalize({ x: d.side.x * dx + d.forward.x * dz, y: d.side.y * dx + d.forward.y * dz, z: d.side.z * dx + d.forward.z * dz });
    return {
      center: at(d.position, d.side, d.up, d.forward, l.hinge + (dx * L) / 2, y, hz + (dz * L) / 2),
      half: { x: L / 2, y: hy, z: t / 2 },
      side: along,
      up: d.up,
      forward: v3cross(along, d.up),
    };
  });
}

/** The collider of a closed door: the whole opening through the wall's thickness (the leaves stand at its inner face). */
export function doorClosedBox(d: DoorDef): OrientedBox {
  return { center: at(d.position, d.side, d.up, d.forward, 0, KIT.floorTop + d.h / 2, 0), half: { x: d.w / 2 - 0.02, y: d.h / 2 - 0.01, z: KIT.wallT / 2 - 0.01 }, side: d.side, up: d.up, forward: d.forward };
}

/** The middle of a door's opening at chest height (reach and prompts). */
export function doorCenter(d: DoorDef): Vec3 {
  return at(d.position, d.side, d.up, d.forward, 0, KIT.floorTop + 1.1, 0);
}

/** A crate's centre (its prefab's half height above the base). */
export function crateCenter(p: Placement): Vec3 {
  return at(p.position, p.side, p.up, p.forward, 0, p.centerHeight, 0);
}

/** Adds a box collider (PROP group: stops people, shots and sight); `register` lists it as a room's interactive. */
export function addBoxCollider(physics: GamePhysics, b: OrientedBox, register = true): number {
  const { R, world } = physics;
  const desc = R.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z)
    .setTranslation(b.center.x, b.center.y, b.center.z)
    .setRotation(quatFromBasis(b.side, b.up, b.forward))
    .setCollisionGroups(groups(Group.PROP, 0xffff));
  const col = world.createCollider(desc);
  if (register) physics.interactiveHandles.add(col.handle);
  return col.handle;
}

/** Adds a crate's colliders (its prefab's, posed like the static world's). */
export function addCrateColliders(physics: GamePhysics, p: Placement, register = true): number[] {
  return placementColliderDescs(physics.R, p).map((desc) => {
    const col = physics.world.createCollider(desc);
    if (register) physics.interactiveHandles.add(col.handle);
    return col.handle;
  });
}

export function removeColliders(physics: GamePhysics, handles: Iterable<number>): void {
  for (const h of handles) {
    const col = physics.world.getCollider(h);
    if (col) physics.world.removeCollider(col, false);
    physics.interactiveHandles.delete(h);
  }
}

/** Why a door request was refused. */
export const WorldReject = { OK: 0, UNKNOWN: 1, FAR: 2, BLOCKED: 3, RATE: 4 } as const;
export type WorldReject = (typeof WorldReject)[keyof typeof WorldReject];

export interface InteractiveActor {
  readonly index: number;
  state: { pos: Vec3 };
}

export interface InteractiveHost {
  physics: GamePhysics;
  layout: Pick<WorldLayout, 'doors' | 'crates'>;
  /** Every character of the room standing in the world (a door does not close on someone in its opening). */
  actors(): Iterable<InteractiveActor>;
  emit(e: GameEvent): void;
}

export class InteractiveSystem {
  /** This room's door and crate colliders (CharacterMotor.interactiveFilter). */
  readonly colliders = new Set<number>();
  readonly doorOpen: boolean[];
  readonly crateHp: number[];
  private readonly doorHandle: number[];
  private readonly crateHandles: number[][];
  private readonly crateOf = new Map<number, number>();
  private readonly lastUse = new Map<number, number>();
  /** True for a collider of this room or none of the rooms (a query predicate for the shared server world). */
  readonly predicate = (c: { handle: number }): boolean => !this.host.physics.interactiveHandles.has(c.handle) || this.colliders.has(c.handle);

  constructor(private readonly host: InteractiveHost) {
    const { doors, crates } = host.layout;
    this.doorOpen = doors.map(() => true);
    this.doorHandle = doors.map(() => -1);
    this.crateHp = crates.map(() => 0);
    this.crateHandles = crates.map(() => []);
    this.reset();
  }

  get doors(): readonly DoorDef[] {
    return this.host.layout.doors;
  }

  get crates(): readonly Placement[] {
    return this.host.layout.crates;
  }

  /** A new match: the doors back to their starting state, every crate whole. */
  reset(): void {
    for (let i = 0; i < this.doorOpen.length; i++) this.placeDoor(i, doorStartsOpen(i));
    for (let i = 0; i < this.crateHp.length; i++) this.placeCrate(i, INTERACTIVES.crate.hp);
    this.lastUse.clear();
    refreshQueries(this.host.physics);
  }

  /** The state a joining client needs. */
  view(): WorldStateMsg {
    const o: number[] = [];
    for (let i = 0; i < this.doorOpen.length; i++) if (this.doorOpen[i]) o.push(i);
    const c: [number, number][] = [];
    for (let i = 0; i < this.crateHp.length; i++) if (this.crateHp[i]! < INTERACTIVES.crate.hp) c.push([i, this.crateHp[i]!]);
    return { o, c };
  }

  /** Client: takes the server's state as a whole. */
  apply(m: WorldStateMsg): void {
    const open = new Set(m.o);
    for (let i = 0; i < this.doorOpen.length; i++) this.placeDoor(i, open.has(i));
    const hp = new Map(m.c);
    for (let i = 0; i < this.crateHp.length; i++) this.placeCrate(i, hp.get(i) ?? INTERACTIVES.crate.hp);
    refreshQueries(this.host.physics);
  }

  /** Client: a door or crate event from the server. Returns true when it was one. */
  onEvent(e: GameEvent): boolean {
    if (e.e === 'door') {
      if (this.placeDoor(e.id, e.open === 1)) refreshQueries(this.host.physics);
      return true;
    }
    if (e.e === 'crate') {
      if (this.placeCrate(e.id, e.hp)) refreshQueries(this.host.physics);
      return true;
    }
    return false;
  }

  /** The door closest to `pos` (feet) within reach, the one ahead first when `look` is given; −1 when none. */
  doorNear(pos: Vec3, look?: Vec3, range: number = INTERACTIVES.door.useRange): number {
    const up = v3normalize(pos);
    const chest = { x: pos.x + up.x * 1.0, y: pos.y + up.y * 1.0, z: pos.z + up.z * 1.0 };
    let best = -1;
    let bestScore = Infinity;
    for (const d of this.doors) {
      const c = doorCenter(d);
      const dx = c.x - chest.x;
      const dy = c.y - chest.y;
      const dz = c.z - chest.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > range) continue;
      let score = dist;
      if (look && dist > 0.05) score -= 0.6 * ((dx * look.x + dy * look.y + dz * look.z) / dist);
      if (score < bestScore) {
        bestScore = score;
        best = d.id;
      }
    }
    return best;
  }

  /** A player's WORLD_USE (validated: a known door within reach, not too often, nobody in the way when closing). */
  use(a: InteractiveActor, m: WorldUseMsg, now: number): WorldReject {
    const d = this.doors[m.id];
    if (!d) return WorldReject.UNKNOWN;
    const last = this.lastUse.get(a.index) ?? -Infinity;
    if (now - last < INTERACTIVES.door.intervalMs) return WorldReject.RATE;
    const up = v3normalize(a.state.pos);
    const c = doorCenter(d);
    const chest = { x: a.state.pos.x + up.x, y: a.state.pos.y + up.y, z: a.state.pos.z + up.z };
    if (Math.hypot(c.x - chest.x, c.y - chest.y, c.z - chest.z) > INTERACTIVES.door.useRange + 0.35) return WorldReject.FAR;
    this.lastUse.set(a.index, now);
    return this.toggle(m.id, a.index) ? WorldReject.OK : WorldReject.BLOCKED;
  }

  /** Opens a closed door or closes an open one (unless someone stands in its opening). */
  toggle(id: number, by: number): boolean {
    const open = !this.doorOpen[id];
    if (!open && this.doorBlocked(id)) return false;
    this.placeDoor(id, open);
    refreshQueries(this.host.physics);
    this.host.emit({ e: 'door', id, open: open ? 1 : 0, by });
    return true;
  }

  /** Someone in the doorway (a closing door would shut on them). */
  doorBlocked(id: number): boolean {
    const d = this.doors[id]!;
    const r = 0.36;
    for (const a of this.host.actors()) {
      const q = { x: a.state.pos.x - d.position.x, y: a.state.pos.y - d.position.y, z: a.state.pos.z - d.position.z };
      const lx = v3dot(q, d.side);
      const ly = v3dot(q, d.up);
      const lz = v3dot(q, d.forward);
      if (Math.abs(lx) < d.w / 2 + r && Math.abs(lz) < KIT.wallT / 2 + r && ly > -0.4 && ly < d.h + 0.2) return true;
    }
    return false;
  }

  /**
   * Bots open the doors they walk into: a closed door whose opening is within reach of `pos` and ahead of `wish`
   * (the bot's walking direction).
   */
  assist(a: InteractiveActor, wish: Vec3, now: number): void {
    if (wish.x * wish.x + wish.y * wish.y + wish.z * wish.z < 0.01) return;
    const last = this.lastUse.get(a.index) ?? -Infinity;
    if (now - last < INTERACTIVES.door.intervalMs * 2) return;
    const id = this.doorNear(a.state.pos, wish, INTERACTIVES.door.botRange + 1.1);
    if (id < 0 || this.doorOpen[id]) return;
    const c = doorCenter(this.doors[id]!);
    const up = v3normalize(a.state.pos);
    const to = { x: c.x - a.state.pos.x, y: c.y - a.state.pos.y, z: c.z - a.state.pos.z };
    const h = v3dot(to, up);
    const flat = { x: to.x - up.x * h, y: to.y - up.y * h, z: to.z - up.z * h };
    const dist = Math.hypot(flat.x, flat.y, flat.z);
    if (dist > INTERACTIVES.door.botRange || (dist > 0.2 && v3dot(flat, wish) / dist < 0.3)) return;
    this.lastUse.set(a.index, now);
    this.toggle(id, a.index);
  }

  /** A shot or a blow landed on collider `handle`: a crate of this room takes `amount`. */
  damageHandle(handle: number, amount: number, by: number): boolean {
    const id = this.crateOf.get(handle);
    if (id === undefined) return false;
    return this.damageCrate(id, amount, by);
  }

  damageCrate(id: number, amount: number, by: number): boolean {
    const hp = this.crateHp[id];
    if (hp === undefined || hp <= 0 || amount <= 0) return false;
    const left = Math.max(0, Math.round(hp - amount));
    if (this.placeCrate(id, left)) refreshQueries(this.host.physics);
    this.host.emit({ e: 'crate', id, hp: left, by });
    return true;
  }

  /** A punch from `from` along `dir`: the first thing it meets within `range`, if one of this room's crates, takes `amount`. */
  meleeHit(from: Vec3, dir: Vec3, range: number, amount: number, by: number): boolean {
    const hit = this.host.physics.castRay(from, dir, range, GROUPS_WORLD_QUERY, this.predicate);
    return !!hit && this.damageHandle(hit.handle, amount, by);
  }

  /** Takes every collider of this room out of the shared world. */
  dispose(): void {
    removeColliders(this.host.physics, this.colliders);
    this.colliders.clear();
    this.crateOf.clear();
    refreshQueries(this.host.physics);
  }

  // ------------------------------------------------------------------------------------------------ colliders

  /** Sets a door's state and collider; true when it changed. */
  private placeDoor(id: number, open: boolean): boolean {
    const d = this.doors[id];
    if (!d) return false;
    const had = this.doorHandle[id]!;
    if (this.doorOpen[id] === open && (open ? had < 0 : had >= 0)) return false;
    this.doorOpen[id] = open;
    if (open && had >= 0) {
      removeColliders(this.host.physics, [had]);
      this.colliders.delete(had);
      this.doorHandle[id] = -1;
    } else if (!open && had < 0) {
      const h = addBoxCollider(this.host.physics, doorClosedBox(d));
      this.colliders.add(h);
      this.doorHandle[id] = h;
    }
    return true;
  }

  /** Sets a crate's hit points and colliders (none once broken); true when its colliders changed. */
  private placeCrate(id: number, hp: number): boolean {
    const p = this.crates[id];
    if (!p) return false;
    this.crateHp[id] = hp;
    const handles = this.crateHandles[id]!;
    if (hp > 0 && !handles.length) {
      for (const h of addCrateColliders(this.host.physics, p)) {
        handles.push(h);
        this.colliders.add(h);
        this.crateOf.set(h, id);
      }
      return true;
    }
    if (hp <= 0 && handles.length) {
      removeColliders(this.host.physics, handles);
      for (const h of handles) {
        this.colliders.delete(h);
        this.crateOf.delete(h);
      }
      handles.length = 0;
      return true;
    }
    return false;
  }
}

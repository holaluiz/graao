/**
 * World interactivity (docs/world/WORLD_DESIGN.md, "Interatividade"): the doors of the houses and the breakable crates,
 * on the real spherical world with the real character motor, shots and bots — and through the real server with two
 * clients (WORLD_STATE, door and crate events, a new match resetting everything).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { CHEST_SPOTS, DEFAULT_APPEARANCE, INTERACTIVES, KIT_BUILDINGS, MATCH_SPAWNS, SPAWNS, WEAPONS, randomAppearance } from '@graao/game-data';
import {
  CharacterMotor,
  InteractiveSystem,
  WorldReject,
  buildNavGraph,
  crateCenter,
  createCharacterState,
  createGameWorld,
  decodeInput,
  dirToLatLon,
  doorCenter,
  doorClosedBox,
  doorLeafBoxes,
  latLonToDir,
  newInput,
  resolveChestSpots,
  resolvePellet,
  type CharacterBody,
  type CharacterState,
  type DoorDef,
  type InteractiveActor,
} from '@graao/game-core';
import { AIM_SCALE, C2S, CLIENT_VERSION, MatchPhase, PROTOCOL_VERSION, ROOM_NAME, S2C, WISH_SCALE, v3normalize, v3projectOnPlane, type EventsMsg, type GameEvent, type RoomStateMsg, type Vec3, type WelcomeMsg, type WorldStateMsg } from '@graao/shared';
import { BotNavigator } from '../apps/server/src/sim/BotNav';
import { botIntent } from '../apps/server/src/sim/BotBrain';
import { createGraaoServer } from '../apps/server/src/app';
import { setAuthVerifier } from '../apps/server/src/auth/SupabaseAuth';
import { setMatchStore } from '../apps/server/src/persistence/MatchStore';
import { getWorld } from '../apps/server/src/world';

const world = await createGameWorld({ includeVisual: false });
const { doors, crates } = world.layout;
const add = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const flat = (a: Vec3, b: Vec3) => {
  const d = v3projectOnPlane({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, v3normalize(a));
  return Math.hypot(d.x, d.y, d.z);
};
const sobradoDoor = doors.find((d) => d.mapId === 'vila-sobrado')!;
/** A point `out` m outside a door (negative: inside), `h` m above its threshold. */
const byDoor = (d: DoorDef, out: number, h = 0.25) => add(add(d.position, d.forward, out), d.up, h);

function system(actors: InteractiveActor[] = []) {
  const events: GameEvent[] = [];
  const s = new InteractiveSystem({ physics: world.physics, layout: world.layout, actors: () => actors, emit: (e) => events.push(e) });
  return { s, events };
}

/** A character standing at `feet` facing `facing`, its own motor (and room filter). */
function walker(feet: Vec3, facing: Vec3, filter: ReadonlySet<number> | null) {
  const motor = new CharacterMotor(world.physics);
  motor.interactiveFilter = filter;
  const up = v3normalize(feet);
  const s: CharacterState = createCharacterState(add(feet, up, 0.2), v3normalize(v3projectOnPlane(facing, up)));
  const body: CharacterBody = motor.createBody(s);
  const inp = newInput();
  for (let i = 0; i < 30; i++) motor.step(body, s, inp, 1 / 60);
  /** Walks toward `to` for `seconds`; returns the remaining flat distance. */
  const go = (to: Vec3, seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      const u = v3normalize(s.pos);
      const d = v3projectOnPlane({ x: to.x - s.pos.x, y: to.y - s.pos.y, z: to.z - s.pos.z }, u);
      if (Math.hypot(d.x, d.y, d.z) < 0.3) break;
      inp.wish = v3normalize(d);
      motor.step(body, s, inp, 1 / 60);
    }
    return flat(s.pos, to);
  };
  return { s, go, dispose: () => body.dispose() };
}

describe('doors and crates in the layout', () => {
  it('every door module of a building is a door: colonial houses, the sobrado, the sítio, BH houses, garages', () => {
    expect(doors.length).toBeGreaterThan(30);
    for (const id of ['vila-sobrado', 'vila-casa-esquina', 'vila-ladeira-o1', 'bosque-casa-sitio', 'bairro-casa-laje', 'bairro-casa-garagem-1']) expect(doors.some((d) => d.mapId === id), id).toBe(true);
    expect(doors.filter((d) => d.style === 'dupla').length).toBeGreaterThan(10);
    expect(KIT_BUILDINGS['casa-colonial-azul']!.leaves).toHaveLength(2);
    expect(crates.length).toBeGreaterThanOrEqual(4);
  });

  it('a closed door fills only its opening; open leaves stand inside the room, clear of the walls', () => {
    /** Points over the box (shrunk) inside any static collider. */
    const overlaps = (b: ReturnType<typeof doorClosedBox>, shrink: number) => {
      let hit = false;
      for (const fx of [-1, -0.5, 0, 0.5, 1]) for (const fy of [-1, -0.5, 0, 0.5, 1]) for (const fz of [-1, 0, 1]) {
        const p = add(add(add(b.center, b.side, fx * (b.half.x - shrink)), b.up, fy * (b.half.y - shrink)), b.forward, fz * Math.max(0, b.half.z - shrink));
        world.physics.world.intersectionsWithPoint(p, (c) => {
          if (world.physics.propByCollider.has(c.handle)) hit = true;
          return !hit;
        });
      }
      return hit;
    };
    const bad: string[] = [];
    for (const d of doors) {
      if (overlaps(doorClosedBox(d), 0.06)) bad.push(`${d.mapId}#${d.id} fechada`);
      for (const leaf of doorLeafBoxes(d, 1)) if (overlaps(leaf, 0.04)) bad.push(`${d.mapId}#${d.id} aberta`);
    }
    expect(bad).toEqual([]);
  });

  it('no chest spot, spawn or door swing lands on a crate', () => {
    const spots = resolveChestSpots(world, CHEST_SPOTS).filter((s) => s.ok);
    for (const c of crates) {
      const cc = crateCenter(c);
      for (const s of spots) expect(flat(s.pos, cc) > 1.1 || Math.abs(Math.hypot(s.pos.x, s.pos.y, s.pos.z) - Math.hypot(cc.x, cc.y, cc.z)) > 1.2, `${s.def.id} × ${c.mapId}`).toBe(true);
      for (const sp of [...SPAWNS, ...MATCH_SPAWNS]) expect(flat(world.terrain.surfaceAt(latLonToDir(sp.lat, sp.lon)), cc), `spawn ${sp.lat},${sp.lon} × ${c.mapId}`).toBeGreaterThan(1.2);
      for (const d of doors) for (const leaf of doorLeafBoxes(d, 1)) expect(flat(leaf.center, cc) > 0.9 || Math.abs(Math.hypot(leaf.center.x, leaf.center.y, leaf.center.z) - Math.hypot(cc.x, cc.y, cc.z)) > 1.5, `${d.mapId} × ${c.mapId}`).toBe(true);
    }
  });

  it('the bots’ graph goes round the crates and leaves no collider behind', () => {
    const before = world.physics.world.colliders.len();
    const nav = buildNavGraph(world);
    expect(world.physics.world.colliders.len()).toBe(before);
    for (const c of crates) {
      const cc = crateCenter(c);
      const n = nav.nearest(cc, 2);
      if (n < 0) continue;
      const p = nav.nodes[n]!.pos;
      // A node right on a crate would stand on its lid, not beside it on the ground.
      if (flat(p, cc) < 0.35) expect(Math.hypot(p.x, p.y, p.z)).toBeGreaterThan(Math.hypot(cc.x, cc.y, cc.z));
    }
  });
});

describe('doors on foot', () => {
  it('a closed door stops people and shots; open, both go through', () => {
    const { s } = system();
    const id = sobradoDoor.id;
    if (s.doorOpen[id]) s.toggle(id, -1);
    expect(s.doorOpen[id]).toBe(false);
    const w = walker(byDoor(sobradoDoor, 1.6), { x: -sobradoDoor.forward.x, y: -sobradoDoor.forward.y, z: -sobradoDoor.forward.z }, s.colliders);
    expect(w.go(byDoor(sobradoDoor, -1.6), 3)).toBeGreaterThan(1.0);
    // (The feira's tent stands a couple of metres in front of this door: shoot from the doorstep.)
    const from = byDoor(sobradoDoor, 1.0, 1.4);
    const into = { x: -sobradoDoor.forward.x, y: -sobradoDoor.forward.y, z: -sobradoDoor.forward.z };
    const shut = resolvePellet(world.physics, from, into, from, 10, [], 0, s.predicate);
    expect(s.colliders.has(shut.handle)).toBe(true);
    expect(shut.distance).toBeLessThan(1.2);
    // Open it from outside: the player walks in, the shot flies into the room.
    expect(s.use({ index: 0, state: w.s }, { s: 1, id }, 1000)).toBe(WorldReject.OK);
    expect(s.doorOpen[id]).toBe(true);
    expect(w.go(byDoor(sobradoDoor, -1.6), 4)).toBeLessThan(0.4);
    const through = resolvePellet(world.physics, from, into, from, 10, [], 0, s.predicate);
    expect(through.distance).toBeGreaterThan(2);
    w.dispose();
    s.dispose();
  });

  it('refuses a door out of reach or too often, and never closes it on someone in the doorway', () => {
    const inDoor: InteractiveActor = { index: 1, state: { pos: byDoor(sobradoDoor, 0, 0.15) } };
    const { s, events } = system([inDoor]);
    const id = sobradoDoor.id;
    if (!s.doorOpen[id]) s.toggle(id, -1);
    const far: InteractiveActor = { index: 2, state: { pos: byDoor(sobradoDoor, 4.5) } };
    expect(s.use(far, { s: 1, id }, 1000)).toBe(WorldReject.FAR);
    const near: InteractiveActor = { index: 3, state: { pos: byDoor(sobradoDoor, 1.2) } };
    expect(s.use(near, { s: 1, id }, 1000)).toBe(WorldReject.BLOCKED);
    expect(s.doorOpen[id]).toBe(true);
    expect(s.use(near, { s: 2, id }, 1100)).toBe(WorldReject.RATE);
    inDoor.state.pos = byDoor(sobradoDoor, -2.0, 0.15);
    expect(s.use(near, { s: 3, id }, 1000 + INTERACTIVES.door.intervalMs + 5)).toBe(WorldReject.OK);
    expect(s.doorOpen[id]).toBe(false);
    expect(events.at(-1)).toEqual({ e: 'door', id, open: 0, by: 3 });
    s.dispose();
  });

  it('rooms sharing one world keep their own doors', () => {
    const a = system().s;
    const b = system().s;
    const id = sobradoDoor.id;
    if (a.doorOpen[id]) a.toggle(id, -1);
    if (b.doorOpen[id]) b.toggle(id, -1);
    a.toggle(id, 0);
    const facing = { x: -sobradoDoor.forward.x, y: -sobradoDoor.forward.y, z: -sobradoDoor.forward.z };
    const inA = walker(byDoor(sobradoDoor, 1.6), facing, a.colliders);
    const inB = walker(byDoor(sobradoDoor, 1.6), facing, b.colliders);
    expect(inA.go(byDoor(sobradoDoor, -1.6), 4)).toBeLessThan(0.4);
    expect(inB.go(byDoor(sobradoDoor, -1.6), 3)).toBeGreaterThan(1.0);
    inA.dispose();
    inB.dispose();
    a.dispose();
    b.dispose();
    expect(world.physics.interactiveHandles.size).toBe(0);
  });

  it('a bot walking into a closed door opens it and goes in', () => {
    const { s } = system();
    // A house on the ladeira, from the middle of the street.
    const door = doors.find((d) => d.mapId === 'vila-ladeira-o1')!;
    const id = door.id;
    if (s.doorOpen[id]) s.toggle(id, -1);
    const nav = buildNavGraph(world);
    const motor = new CharacterMotor(world.physics);
    motor.interactiveFilter = s.colliders;
    const from = byDoor(door, 3.5, 0);
    const goal = byDoor(door, -2.2, 0.15);
    const up = v3normalize(from);
    const st = createCharacterState(add(from, up, 0.3), v3normalize(v3projectOnPlane({ x: goal.x - from.x, y: goal.y - from.y, z: goal.z - from.z }, up)));
    const body = motor.createBody(st);
    const navigator = new BotNavigator();
    const inp = newInput();
    let arrived = false;
    for (let i = 0; i < 25 * 60 && !arrived; i++) {
      const now = 1000 + (i * 1000) / 60;
      if (flat(st.pos, goal) < 0.8) arrived = true;
      const step = st.grounded ? navigator.next(nav, st.pos, goal, now) : { point: null, stuck: false, left: 0 };
      const intent = botIntent(st, undefined, 1, now, step.stuck, step.point ?? goal, false);
      if (st.grounded) s.assist({ index: 7, state: st }, intent.wish, now);
      decodeInput([i, Math.round(intent.wish.x * WISH_SCALE), Math.round(intent.wish.y * WISH_SCALE), Math.round(intent.wish.z * WISH_SCALE), Math.round(intent.aim.x * AIM_SCALE), Math.round(intent.aim.y * AIM_SCALE), Math.round(intent.aim.z * AIM_SCALE), intent.buttons], inp);
      motor.step(body, st, inp, 1 / 60);
    }
    body.dispose();
    expect(s.doorOpen[id]).toBe(true);
    expect(arrived).toBe(true);
    s.dispose();
  });
});

describe('crates', () => {
  it('break under fire: hit points go down, the last hit takes the crate (and its collider) away', () => {
    const { s, events } = system();
    const id = crates.findIndex((c) => c.mapId === 'vila-caixote-2');
    expect(id).toBeGreaterThanOrEqual(0);
    const cc = crateCenter(crates[id]!);
    const up = v3normalize(cc);
    // From 3 m north of the crate, at its height.
    const north = v3normalize(v3projectOnPlane({ x: 0, y: 1, z: 0 }, up));
    const from = add(cc, north, 3);
    const dir = v3normalize({ x: cc.x - from.x, y: cc.y - from.y, z: cc.z - from.z });
    const dmg = WEAPONS.sunbeam.damage;
    let shots = 0;
    while (s.crateHp[id]! > 0 && shots < 30) {
      const r = resolvePellet(world.physics, from, dir, from, 20, [], 0, s.predicate);
      expect(s.damageHandle(r.handle, dmg, 4)).toBe(true);
      shots++;
    }
    expect(shots).toBe(Math.ceil(INTERACTIVES.crate.hp / dmg));
    expect(events.filter((e) => e.e === 'crate').at(-1)).toEqual({ e: 'crate', id, hp: 0, by: 4 });
    const after = resolvePellet(world.physics, from, dir, from, 20, [], 0, s.predicate);
    expect(after.distance).toBeGreaterThan(3.4);
    // A new match: whole again.
    s.reset();
    expect(s.crateHp[id]).toBe(INTERACTIVES.crate.hp);
    expect(s.view().c).toEqual([]);
    s.dispose();
  });

  it('punches break them too', () => {
    const { s } = system();
    const id = crates.findIndex((c) => c.mapId === 'vila-caixote-1');
    const cc = crateCenter(crates[id]!);
    const up = v3normalize(cc);
    const east = v3normalize(v3projectOnPlane({ x: 1, y: 0, z: 0 }, up));
    const from = add(cc, east, 1.0);
    const dir = { x: -east.x, y: -east.y, z: -east.z };
    let punches = 0;
    while (s.crateHp[id]! > 0 && punches < 10) {
      expect(s.meleeHit(from, dir, 1.5, 22, 2)).toBe(true);
      punches++;
    }
    expect(punches).toBe(3);
    expect(s.meleeHit(from, dir, 1.5, 22, 2)).toBe(false);
    s.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ through the server

const PORT = 3050 + Math.floor(Math.random() * 40);
const server = createGraaoServer();
const url = `ws://127.0.0.1:${PORT}`;

beforeAll(async () => {
  setAuthVerifier(null);
  setMatchStore({ name: 'none', record: async () => null });
  await getWorld();
  await server.listen(PORT);
}, 30000);

afterAll(async () => {
  await server.gracefullyShutdown(false).catch(() => {});
});

function inbox<T>(room: Room, type: number) {
  const all: T[] = [];
  room.onMessage(type, (m: T) => all.push(m));
  return {
    all,
    async until(pred: (m: T) => boolean, ms = 6000): Promise<T> {
      const t0 = Date.now();
      for (;;) {
        const hit = all.find(pred);
        if (hit) return hit;
        if (Date.now() - t0 > ms) throw new Error(`timeout waiting for message ${type}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}
const opts = (name: string) => ({ legacyWarmup: true, protocol: PROTOCOL_VERSION, client: CLIENT_VERSION, name, appearance: name === 'A' ? DEFAULT_APPEARANCE : randomAppearance(() => 0.42) });
const evs = (box: ReturnType<typeof inbox<EventsMsg>>, pred: (e: GameEvent) => boolean) => box.all.flatMap((m) => m.ev.filter(pred));

describe('doors through the authoritative server (two clients)', () => {
  it('everyone gets the same doors on join; a door opened by A opens for B; a new match resets them', async () => {
    const d = sobradoDoor;
    const stand = (out: number, side: number) => dirToLatLon(add(add(d.position, d.forward, out), d.side, side));
    const a = await new Client(url).create(ROOM_NAME, { ...opts('A'), maxPlayers: 2, countdownMs: 100, resultsMs: 6000, skipDraft: true, skipUfo: true, tormentaOff: true, matchSpawns: [stand(1.3, 0), stand(2.4, 1.2)] });
    const A = { world: inbox<WorldStateMsg>(a, S2C.WORLD_STATE), events: inbox<EventsMsg>(a, S2C.EVENTS), rooms: inbox<RoomStateMsg>(a, S2C.ROOM_STATE), welcome: inbox<WelcomeMsg>(a, S2C.WELCOME) };
    const code = (await A.rooms.until((m) => m.players.length === 1)).code;
    const b = await new Client(url).joinById(code, opts('B'));
    const B = { world: inbox<WorldStateMsg>(b, S2C.WORLD_STATE), events: inbox<EventsMsg>(b, S2C.EVENTS) };
    try {
      const wa = await A.world.until(() => true);
      const wb = await B.world.until(() => true);
      expect(wb).toEqual(wa);
      await A.rooms.until((m) => m.players.length === 2);
      a.send(C2S.READY, { r: 1 });
      b.send(C2S.READY, { r: 1 });
      await A.rooms.until((m) => m.phase === MatchPhase.MATCH);
      // The match's own state (a new generation: doors as built, crates whole), the same for both.
      await new Promise((r) => setTimeout(r, 400));
      const fresh = A.world.all.at(-1)!;
      expect(B.world.all.at(-1)).toEqual(fresh);
      expect(fresh.c).toEqual([]);
      const wasOpen = fresh.o.includes(d.id);
      // A, at the door, uses it: both see it change.
      a.send(C2S.WORLD_USE, { s: 1, id: d.id });
      const seen = (box: typeof B.events) => box.until((m) => m.ev.some((e) => e.e === 'door' && e.id === d.id));
      await Promise.all([seen(A.events), seen(B.events)]);
      const ev = evs(B.events, (e) => e.e === 'door' && e.id === d.id)[0] as Extract<GameEvent, { e: 'door' }>;
      expect(ev.open).toBe(wasOpen ? 0 : 1);
      // A door far from B: refused (no event).
      const far = doors.find((x) => x.mapId.startsWith('bairro'))!;
      b.send(C2S.WORLD_USE, { s: 1, id: far.id });
      await new Promise((r) => setTimeout(r, 400));
      expect(evs(A.events, (e) => e.e === 'door' && e.id === far.id)).toHaveLength(0);
    } finally {
      await a.leave();
      await b.leave();
    }
  }, 30000);
});

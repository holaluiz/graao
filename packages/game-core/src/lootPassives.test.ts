import { describe, expect, it } from 'vitest';
import { AMMO, STARTING_KIT } from '@graao/game-data';
import { LootReject } from '@graao/shared';
import { newVitals } from './combat';
import { newInventory } from './loot';
import { GRALootSystem, type LootActor } from './lootSystem';
import type { GamePhysics } from './physics';

function setup() {
  const actors: LootActor[] = [];
  const system = new GRALootSystem({ physics: { castRay: () => null } as unknown as GamePhysics, actors: () => actors, gate: () => LootReject.OK, emit: () => {}, changed: () => {}, equip: () => {} }, []);
  const actor = (index: number, scavenger: boolean): LootActor => {
    const value: LootActor = { index, loadout: scavenger ? ['backyard_scavenger'] : [], vitals: newVitals(), inv: newInventory(STARTING_KIT), state: { pos: { x: 3.2, y: 0, z: 100 }, facing: { x: 1, y: 0, z: 0 } }, useUntil: 0, useItem: -1, useReadyAt: [0, 0, 0], lootSeq: -1, lootAt: 0 };
    actors.push(value);
    return value;
  };
  system.items.set(1, { id: 1, item: 'ammo_solar', qty: 10, ammo: 0, pos: { x: 0, y: 0, z: 100 }, src: -1 });
  return { system, actor };
}

describe('Catador in the real loot transaction', () => {
  it('increases only the owner pickup reach and grants ammunition bonus without changing another player inventory', () => {
    const { system, actor } = setup();
    const normal = actor(0, false), scavenger = actor(1, true);
    normal.inv.reserve.solar = scavenger.inv.reserve.solar = 0;
    const request = { s: 1, k: 1 as const, id: 1, g: system.gen };
    expect(system.interact(normal, request, 1000).r).toBe(LootReject.TOO_FAR);
    expect(system.items.get(1)!.qty).toBe(10);
    expect(system.interact(scavenger, request, 1000)).toMatchObject({ ok: true, n: 11 });
    expect(scavenger.inv.reserve.solar).toBe(11);
    expect(normal.inv.reserve.solar).toBe(0);
    expect(system.items.has(1)).toBe(false);
    expect(system.interact(normal, { ...request, s: 2 }, 1300).r).toBe(LootReject.GONE);
  });

  it('respects reserve capacity, leaves unconsumed source units and never gives the same units twice', () => {
    const { system, actor } = setup();
    const scavenger = actor(0, true), normal = actor(1, false);
    scavenger.inv.reserve.solar = AMMO.solar.max - 5;
    normal.state.pos = { x: 0, y: 0, z: 100 };
    normal.inv.reserve.solar = 0;
    const request = { s: 1, k: 1 as const, id: 1, g: system.gen };
    expect(system.interact(scavenger, request, 1000)).toMatchObject({ ok: true, n: 5 });
    expect(scavenger.inv.reserve.solar).toBe(AMMO.solar.max);
    expect(system.items.get(1)!.qty).toBe(5);
    expect(system.interact(scavenger, { ...request, s: 2 }, 1300).r).toBe(LootReject.FULL);
    expect(system.items.get(1)!.qty).toBe(5);
    expect(system.interact(normal, request, 1300)).toMatchObject({ ok: true, n: 5 });
    expect(normal.inv.reserve.solar).toBe(5);
    expect(system.items.has(1)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { AMMO, BOT_KIT, STARTING_KIT, WEAPONS } from '@graao/game-data';
import { WeaponController, type WeaponInput } from './WeaponController';

const idle: WeaponInput = { fireHeld: false, firePressed: false, reloadPressed: false, switchTo: -1 };
const hold: WeaponInput = { ...idle, fireHeld: true };
const click: WeaponInput = { ...idle, firePressed: true };

/** Runs the controller at 60 fps for `ms`, returning how many shots fired. */
function run(w: WeaponController, from: number, ms: number, input: WeaponInput, canFire = true): { shots: number; now: number } {
  let shots = 0;
  let now = from;
  for (let t = 0; t < ms; t += 1000 / 60) {
    now = from + t;
    if (w.update(1 / 60, now, input, canFire).fire) shots++;
  }
  return { shots, now };
}

describe('WeaponController (local prediction)', () => {
  it('fires the automatic Sunbeam at its nominal rate and never faster', () => {
    const w = new WeaponController();
    const { shots } = run(w, 1000, 1000, hold);
    expect(shots).toBeGreaterThanOrEqual(WEAPONS.sunbeam.fireRate - 1);
    expect(shots).toBeLessThanOrEqual(WEAPONS.sunbeam.fireRate + 1);
    expect(w.ammo[0]).toBe(WEAPONS.sunbeam.magazine - shots);
  });

  it('does not fire when firing is not allowed (countdown, eliminated, pointer free)', () => {
    const w = new WeaponController();
    expect(run(w, 1000, 500, hold, false).shots).toBe(0);
    expect(w.ammo[0]).toBe(WEAPONS.sunbeam.magazine);
  });

  it('auto-reloads an emptied magazine and refills it after reloadTime', () => {
    const w = new WeaponController();
    w.ammo[0] = 1;
    const r = w.update(1 / 60, 1000, hold, true);
    expect(r.fire).not.toBeNull();
    expect(r.reloadStarted).toBe(true);
    expect(w.reloading).toBe(true);
    expect(run(w, 1001, WEAPONS.sunbeam.reloadTime * 1000 - 50, hold).shots).toBe(0);
    run(w, 1000 + WEAPONS.sunbeam.reloadTime * 1000, 50, idle);
    expect(w.reloading).toBe(false);
    expect(w.ammo[0]).toBe(WEAPONS.sunbeam.magazine);
  });

  it('switching weapons cancels a reload and waits for the equip delay', () => {
    const w = new WeaponController(BOT_KIT);
    w.ammo[0] = 3;
    w.update(1 / 60, 1000, { ...idle, reloadPressed: true }, true);
    expect(w.reloading).toBe(true);
    const r = w.update(1 / 60, 1100, { ...click, switchTo: 1 }, true);
    expect(r.switched).toBe(true);
    expect(r.fire).toBeNull(); // equip delay
    expect(w.reloading).toBe(false);
    expect(w.slot).toBe(1);
    // A buffered click right after the delay fires the Petal Burst once (semi-automatic).
    expect(run(w, 1300, 300, click).shots).toBe(1);
  });

  it('server status keeps shots that are still in flight (by FIRE sequence)', () => {
    const w = new WeaponController();
    run(w, 1000, 450, hold); // ~3-4 shots, seq 1..n
    const local = w.ammo[0]!;
    const fired = WEAPONS.sunbeam.magazine - local;
    expect(fired).toBeGreaterThan(1);
    const status = (ammo: number, shotSeq: number) => ({ weapon: 0, ammo: [ammo, 0], reloading: false, reloadEndsAt: 0, alive: true, respawnAt: 0, shotSeq, mana: 100, cd: [0, 0, 0, 0], castUntil: 0, abilitySeq: -1, slowUntil: 0, slow: 100, wpn: ['sunbeam', ''], res: [48, 0, 0], inv: [0, 0, 0], useUntil: 0, useItem: -1 });
    // The server has handled only shot #1 so far: the others stay predicted.
    w.applyServer(status(WEAPONS.sunbeam.magazine - 1, 1), 1460, 60, (t) => t);
    expect(w.ammo[0]).toBe(local);
    // Everything handled, one shot refused (fire-rate jitter): the server's count wins.
    w.applyServer(status(WEAPONS.sunbeam.magazine - fired + 1, fired), 1500, 60, (t) => t);
    expect(w.ammo[0]).toBe(local + 1);
  });

  it('reloads from the reserve only, never switches to an empty slot, and follows the server’s slots', () => {
    const w = new WeaponController(STARTING_KIT);
    expect(w.ids).toEqual(['sunbeam', null]);
    // Q is empty: no switch.
    expect(w.update(1 / 60, 1000, { ...idle, switchTo: 1 }, true).switched).toBe(false);
    w.ammo[0] = 0;
    w.reserve.solar = 5;
    expect(w.startReload(1000)).toBe(true);
    run(w, 1000, WEAPONS.sunbeam.reloadTime * 1000 + 50, idle);
    expect(w.ammo[0]).toBe(5);
    expect(w.reserve.solar).toBe(0);
    // Nothing left in the reserve: R reports it dry instead of reloading.
    w.ammo[0] = 2;
    const r = w.update(1 / 60, 9000, { ...idle, reloadPressed: true }, true);
    expect(r.reloadStarted).toBe(false);
    expect(r.dry).toBe(true);
    // The server says a Fuzil Kalash went into Q and is now in hand.
    w.applyServer({ weapon: 1, ammo: [2, WEAPONS.ak47.magazine], reloading: false, reloadEndsAt: 0, alive: true, respawnAt: 0, shotSeq: -1, mana: 100, cd: [0, 0, 0, 0], castUntil: 0, abilitySeq: -1, slowUntil: 0, slow: 100, wpn: ['sunbeam', 'ak47'], res: [0, 0, 20], inv: [0, 0, 0], useUntil: 0, useItem: -1 }, 9100, 60, (t) => t);
    expect(w.ids).toEqual(['sunbeam', 'ak47']);
    expect(w.slot).toBe(1);
    expect(w.weapon.id).toBe('ak47');
    expect(w.reserveFor(1)).toBe(20);
    expect(w.reserve.heavy).toBeLessThanOrEqual(AMMO.heavy.max);
  });
});

import { describe, expect, it } from 'vitest';
import { ABILITIES, PASSIVE_ABILITIES } from '@graao/game-data';
import { newVitals } from './combat';
import { newPassiveRuntime, passiveModifiers, pickupAmmoWithPassive, recordPassiveCombat, resetPassives, updatePassives } from './passives';

const build = (id: string): string[] => ['wind_step', 'leaf_shell', id, 'sun_meteor'];

describe('automatic passive rules', () => {
  it('all eight passives activate without mana or manual cooldowns and stop on death', () => {
    for (const id of PASSIVE_ABILITIES) {
      const runtime = newPassiveRuntime(0);
      const vitals = newVitals();
      vitals.mana = 12;
      updatePassives(build(id), runtime, vitals, 0.1, 10000);
      expect(vitals.mana).toBe(12);
      expect(ABILITIES[id].cooldown).toBe(0);
      vitals.alive = false;
      const modifiers = updatePassives(build(id), runtime, vitals, 1, 11000);
      expect(modifiers).toEqual(passiveModifiers([], newPassiveRuntime(), 11000));
      expect(runtime.active).toBe(false);
    }
  });

  it('Pé de Vento waits four seconds and resets on real firing or receiving damage', () => {
    const runtime = newPassiveRuntime(0);
    expect(passiveModifiers(build('wind_foot'), runtime, 3999).speed).toBe(1);
    expect(passiveModifiers(build('wind_foot'), runtime, 4000).speed).toBe(1.07);
    recordPassiveCombat(runtime, 4500, 'fire');
    expect(passiveModifiers(build('wind_foot'), runtime, 8000).speed).toBe(1);
    expect(passiveModifiers(build('wind_foot'), runtime, 8500).speed).toBe(1.07);
    recordPassiveCombat(runtime, 9000, 'damage');
    expect(passiveModifiers(build('wind_foot'), runtime, 10000).speed).toBe(1);
  });

  it('weapon handling, swapping, scavenging, sound, air control and resistance each modify their own real subsystem', () => {
    const runtime = newPassiveRuntime(0);
    expect(passiveModifiers(build('steady_hand'), runtime, 0)).toMatchObject({ weaponRecoil: 0.88, weaponSpread: 0.88, weaponSwap: 1 });
    expect(passiveModifiers(build('quick_swap'), runtime, 0)).toMatchObject({ weaponSwap: 0.75, weaponRecoil: 1 });
    const scavenging = passiveModifiers(build('backyard_scavenger'), runtime, 0);
    expect(scavenging).toMatchObject({ pickupRange: 1.35, ammoBonus: 0.1 });
    expect(pickupAmmoWithPassive(30, scavenging)).toBe(33);
    expect(passiveModifiers(build('soft_step'), runtime, 0)).toMatchObject({ footstepVolume: 0.6, weaponRecoil: 1 });
    expect(passiveModifiers(build('kite_breath'), runtime, 0)).toMatchObject({ airControl: 1.2, fallDamage: 0.8 });
    expect(passiveModifiers(build('anti_glue'), runtime, 0).statusResistance).toBe(0.25);
  });

  it('Casca Nova regenerates 3 shield per second after eight quiet seconds, capped at half Shield', () => {
    const runtime = newPassiveRuntime(0);
    const vitals = newVitals();
    vitals.shield = 0;
    updatePassives(build('new_bark'), runtime, vitals, 1, 7999);
    expect(vitals.shield).toBe(0);
    for (let i = 0; i < 60; i++) updatePassives(build('new_bark'), runtime, vitals, 1 / 60, 8000 + i * 1000 / 60);
    expect(vitals.shield).toBe(3);
    recordPassiveCombat(runtime, 10000, 'damage');
    updatePassives(build('new_bark'), runtime, vitals, 1, 11000);
    expect(vitals.shield).toBe(3);
    for (let i = 0; i < 20; i++) updatePassives(build('new_bark'), runtime, vitals, 1, 18000 + i * 1000);
    expect(vitals.shield).toBe(50);
    vitals.shield = 80;
    updatePassives(build('new_bark'), runtime, vitals, 1, 40000);
    expect(vitals.shield).toBe(80);
  });

  it('resets fractional regeneration when a player dies, changes build or restarts', () => {
    const runtime = newPassiveRuntime(0);
    const vitals = newVitals();
    vitals.shield = 0;
    updatePassives(build('new_bark'), runtime, vitals, 0.25, 9000);
    expect(runtime.shieldCarry).toBe(0.75);
    updatePassives(build('steady_hand'), runtime, vitals, 0.1, 9100);
    expect(runtime.shieldCarry).toBe(0);
    vitals.alive = false;
    updatePassives(build('new_bark'), runtime, vitals, 1, 9200);
    expect(vitals.shield).toBe(0);
    resetPassives(runtime, 10000);
    expect(runtime).toEqual({ lastDamageAt: 10000, lastFireAt: 10000, shieldCarry: 0, active: false });
  });
});

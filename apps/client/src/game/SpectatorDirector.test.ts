import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_APPEARANCE } from '@graao/game-data';
import { DeployState, MatchPhase, type PlayerPublic } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import type { SpectatorActions, SpectatorTarget } from '../ui/Spectator';
import { SpectatorDirector } from './SpectatorDirector';

vi.mock('../ui/Spectator', () => ({
  Spectator: class {
    readonly el = {};
    readonly update = vi.fn();
    readonly show = vi.fn();
    constructor(readonly actions: SpectatorActions) {}
  },
}));

function player(index: number, patch: Partial<PlayerPublic> = {}): PlayerPublic {
  return {
    index, sessionId: `p${index}`, name: index === 2 ? 'Bot Caramelo' : `Jogador ${index}`,
    appearance: DEFAULT_APPEARANCE, ready: true, connected: true, inMatch: true, alive: true,
    kills: 0, deaths: 0, loadout: [], weapons: ['sunbeam', ''], deploy: DeployState.LANDED,
    wins: 0, back: false, bot: index === 2, ...patch,
  };
}

function fixture() {
  const players = [player(0, { alive: false }), player(3), player(1), player(2)];
  const remotes = [1, 2, 3].map((index) => ({
    index, pos: new THREE.Vector3(index * 3, 30 - index, index * -2),
    renderFacing: new THREE.Vector3(1, 0, 0), alive: true, hasSnapshot: true,
    health: 80 - index, shield: 20 + index,
  }));
  const pressed = new Set<string>();
  let spectatorEnabled = false;
  const input = {
    enabled: true,
    get spectatorEnabled() { return spectatorEnabled; },
    set spectatorEnabled(on: boolean) {
      spectatorEnabled = on;
      if (!on) pressed.clear();
    },
    consume: vi.fn((action: string) => pressed.delete(action)),
    releaseAll: vi.fn(() => pressed.clear()),
    exitLock: vi.fn(),
  };
  const localState = Object.freeze({
    pos: Object.freeze({ x: -7, y: 26, z: 9 }),
    facing: Object.freeze({ x: 0, y: 0, z: -1 }),
    health: 0,
  });
  const character = { setPose: vi.fn(), setAppearance: vi.fn() };
  const app = {
    phase: 'MATCH', local: { state: localState }, character, input,
    combat: {
      alive: false, inMatch: true, phase: MatchPhase.MATCH,
      scoreboardState: { players, me: 0, eliminated: new Set([0]) },
    },
    net: {
      remotePlayers: remotes,
      remote: vi.fn((index: number) => remotes.find((remote) => remote.index === index)),
      sendInput: vi.fn(),
    },
    camera: { reset: vi.fn(), look: vi.fn(), update: vi.fn(), aim: true, fovBoost: 15 },
    obstruction: { reset: vi.fn() }, hud: { setHint: vi.fn() }, world: { physics: {} },
  };
  const director = new SpectatorDirector(app as unknown as GraaoApp);
  const ui = director.ui as unknown as {
    actions: SpectatorActions;
    update: ReturnType<typeof vi.fn<(target: SpectatorTarget | null, alive: number, total: number) => void>>;
    show: ReturnType<typeof vi.fn<(on: boolean) => void>>;
  };
  const tick = (look = { yaw: 0, pitch: 0 }) => director.update(1 / 60, look);
  const selected = () => ui.update.mock.lastCall?.[0]?.index ?? null;
  return { app, director, ui, tick, selected, players, remotes, pressed, localState, input };
}

describe('spectator camera integration', () => {
  it('follows a survivor’s interpolated feet without moving or reviving the local character', () => {
    const f = fixture();
    f.tick({ yaw: .2, pitch: -.1 });

    expect(f.director.active).toBe(true);
    expect(f.director.following).toBe(true);
    expect(f.selected()).toBe(1);
    expect(f.app.camera.reset).toHaveBeenCalledExactlyOnceWith(f.remotes[0]!.pos, f.remotes[0]!.renderFacing, true);
    expect(f.director.focus.equals(f.remotes[0]!.pos)).toBe(true);
    expect(f.director.focus).not.toBe(f.remotes[0]!.pos);
    expect(f.app.camera.update).toHaveBeenCalledWith(1 / 60, f.director.focus, f.app.world.physics);
    expect(f.app.camera.look).toHaveBeenCalledWith(.2, -.1);
    expect(f.app.camera).toMatchObject({ aim: false, fovBoost: 0 });
    expect(f.input.releaseAll).toHaveBeenCalledOnce();
    expect(f.input.exitLock).toHaveBeenCalledOnce();
    expect(f.input.spectatorEnabled).toBe(true);
    expect(f.app.hud.setHint).toHaveBeenCalledWith('');
    expect(f.app.local.state).toBe(f.localState);
    expect(f.localState).toEqual({ pos: { x: -7, y: 26, z: 9 }, facing: { x: 0, y: 0, z: -1 }, health: 0 });
    expect(f.app.combat.alive).toBe(false);
    expect(f.app.character.setPose).not.toHaveBeenCalled();
    expect(f.app.character.setAppearance).not.toHaveBeenCalled();
    expect(f.app.net.sendInput).not.toHaveBeenCalled();

    f.remotes[0]!.pos.add(new THREE.Vector3(2, 1, -1));
    f.tick();
    expect(f.director.focus.equals(f.remotes[0]!.pos)).toBe(true);
    expect(f.app.camera.reset).toHaveBeenCalledOnce();
    expect(f.input.releaseAll).toHaveBeenCalledOnce();
  });

  it('shows authoritative snapshot vitals and room eliminations for humans and bots', () => {
    const f = fixture();
    f.tick();
    expect(f.ui.update).toHaveBeenLastCalledWith({ index: 1, name: 'Jogador 1', hp: 79, shield: 21, kills: 0 }, 3, 4);

    f.ui.actions.next();
    f.tick();
    expect(f.selected()).toBe(2);
    f.remotes[1]!.health = 34;
    f.remotes[1]!.shield = 0;
    f.players.find((p) => p.index === 2)!.kills = 4;
    f.tick();
    expect(f.ui.update).toHaveBeenLastCalledWith({ index: 2, name: 'Bot Caramelo', hp: 34, shield: 0, kills: 4 }, 3, 4);
    expect(f.ui.show).toHaveBeenLastCalledWith(true);
  });

  it('cycles with arrow actions or UI controls, wrapping in both directions without repeated snaps', () => {
    const f = fixture();
    f.tick();
    f.pressed.add('spectatePrevious');
    f.tick();
    expect(f.selected()).toBe(3);
    f.ui.actions.next();
    f.tick();
    expect(f.selected()).toBe(1);
    f.pressed.add('spectateNext');
    f.tick();
    expect(f.selected()).toBe(2);
    f.ui.actions.previous();
    f.tick();
    expect(f.selected()).toBe(1);
    const snaps = f.app.camera.reset.mock.calls.length;
    f.tick();
    expect(f.selected()).toBe(1);
    expect(f.app.camera.reset).toHaveBeenCalledTimes(snaps);
    expect(f.app.obstruction.reset).toHaveBeenCalledTimes(snaps);
  });

  it.each(['elimination', 'disconnect', 'snapshot death'] as const)('selects the next survivor after the observed player’s %s', (reason) => {
    const f = fixture();
    f.tick();
    if (reason === 'elimination') f.app.combat.scoreboardState.eliminated.add(1);
    if (reason === 'disconnect') f.players.find((p) => p.index === 1)!.connected = false;
    if (reason === 'snapshot death') f.remotes[0]!.alive = false;
    f.tick();
    expect(f.selected()).toBe(2);
    expect(f.app.camera.reset).toHaveBeenLastCalledWith(f.remotes[1]!.pos, f.remotes[1]!.renderFacing, true);
    expect(f.director.focus.equals(f.remotes[1]!.pos)).toBe(true);
  });

  it('waits for a result when no survivor remains instead of following the corpse', () => {
    const f = fixture();
    f.tick();
    for (const p of f.players) p.alive = false;
    for (const remote of f.remotes) remote.alive = false;
    f.app.camera.update.mockClear();
    f.app.camera.reset.mockClear();
    f.tick();
    expect(f.ui.update).toHaveBeenLastCalledWith(null, 0, 4);
    expect(f.ui.show).toHaveBeenLastCalledWith(true);
    expect(f.app.camera.update).not.toHaveBeenCalled();
    expect(f.app.camera.reset).not.toHaveBeenCalled();
    expect(f.director.active).toBe(true);
  });

  it('retains the survivor’s framing behind results while hiding controls', () => {
    const f = fixture();
    f.tick();
    f.app.combat.phase = MatchPhase.RESULTS;
    f.app.input.enabled = false;
    f.remotes[0]!.pos.set(6, 27, -2);
    f.tick();
    expect(f.director.active).toBe(false);
    expect(f.director.following).toBe(true);
    expect(f.director.focus.equals(f.remotes[0]!.pos)).toBe(true);
    expect(f.app.camera.reset).toHaveBeenCalledOnce();
    expect(f.ui.show).toHaveBeenLastCalledWith(false);
    expect(f.input.spectatorEnabled).toBe(false);
  });

  it('does not start spectating for a late joiner, a live player, or a results screen', () => {
    for (const state of ['late join', 'alive', 'results'] as const) {
      const f = fixture();
      if (state === 'late join') f.app.combat.inMatch = false;
      if (state === 'alive') f.app.combat.alive = true;
      if (state === 'results') f.app.combat.phase = MatchPhase.RESULTS;
      f.tick();
      expect(f.director.following).toBe(false);
      expect(f.app.camera.update).not.toHaveBeenCalled();
      expect(f.app.camera.reset).not.toHaveBeenCalled();
      expect(f.input.exitLock).not.toHaveBeenCalled();
      expect(f.ui.show).toHaveBeenLastCalledWith(false);
    }
  });

  it('ignores UI target changes while a menu disables game input', () => {
    const f = fixture();
    f.tick();
    f.input.enabled = false;
    f.ui.actions.next();
    f.tick();
    expect(f.selected()).toBe(1);
    expect(f.ui.show).toHaveBeenLastCalledWith(false);
    expect(f.input.spectatorEnabled).toBe(false);
    f.input.enabled = true;
    f.tick();
    expect(f.selected()).toBe(1);
    expect(f.ui.show).toHaveBeenLastCalledWith(true);
  });

  it.each(['exit', 'reset'] as const)('clears pending target changes on %s before a new match', (reason) => {
    const f = fixture();
    f.tick();
    f.ui.actions.next();
    f.pressed.add('spectatePrevious');
    f.app.phase = 'MENU';
    if (reason === 'exit') {
      f.tick();
    } else f.director.reset();
    expect(f.director.following).toBe(false);
    expect(f.ui.show).toHaveBeenLastCalledWith(false);
    expect(f.input.spectatorEnabled).toBe(false);
    expect(f.pressed.size).toBe(0);
    f.app.phase = 'MATCH';
    f.tick();
    expect(f.selected()).toBe(1);
    expect(f.input.releaseAll).toHaveBeenCalledTimes(2);
  });

  it('snaps the camera back to the local feet and facing on revival', () => {
    const f = fixture();
    f.tick();
    f.ui.actions.next();
    f.pressed.add('spectateNext');
    f.app.combat.alive = true;
    f.tick();
    expect(f.app.camera.reset).toHaveBeenLastCalledWith(new THREE.Vector3(-7, 26, 9), new THREE.Vector3(0, 0, -1), true);
    expect(f.director.following).toBe(false);
    expect(f.input.spectatorEnabled).toBe(false);
    expect(f.pressed.size).toBe(0);
    expect(f.ui.show).toHaveBeenLastCalledWith(false);
    f.app.camera.reset.mockClear();
    f.tick();
    expect(f.app.camera.reset).not.toHaveBeenCalled();
  });
});

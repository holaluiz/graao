/** Follows surviving players for an eliminated participant; never changes the local body or sends combat intents. */
import * as THREE from 'three';
import { MatchPhase } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { Spectator } from '../ui/Spectator';
import { getSpectatorCandidates, selectSpectatorTarget } from './SpectatorSelection';

export class SpectatorDirector {
  readonly ui = new Spectator({ previous: () => this.cycle(-1), next: () => this.cycle(1) });
  readonly focus = new THREE.Vector3();
  private target: number | null = null;
  private direction: -1 | 0 | 1 = 0;
  private engaged = false;

  constructor(private readonly app: GraaoApp) {}

  get active(): boolean {
    const app = this.app;
    return app.phase === 'MATCH' && !!app.net && !app.combat.alive && app.combat.inMatch && app.combat.phase === MatchPhase.MATCH;
  }

  /** Keep the final survivor in view while the authoritative results card opens. */
  get following(): boolean {
    return this.active || (this.engaged && this.app.phase === 'MATCH' && !!this.app.net && !this.app.combat.alive && this.app.combat.phase === MatchPhase.RESULTS);
  }

  private cycle(direction: -1 | 1): void {
    if (this.active && this.app.input.enabled) this.direction = direction;
  }

  reset(): void {
    this.engaged = false;
    this.target = null;
    this.direction = 0;
    this.ui.show(false);
    this.app.input.spectatorEnabled = false;
  }

  /** Called after remote interpolation and combat UI; feet remain separate from the local corpse's pose. */
  update(dt: number, look: { yaw: number; pitch: number }): void {
    const app = this.app;
    if (!this.following) {
      if (this.engaged && app.phase === 'MATCH' && app.combat.alive) {
        const state = app.local.state;
        app.camera.reset(new THREE.Vector3(state.pos.x, state.pos.y, state.pos.z), new THREE.Vector3(state.facing.x, state.facing.y, state.facing.z), true);
      }
      this.reset();
      return;
    }
    if (!this.engaged) {
      this.engaged = true;
      const pos = app.local.state.pos;
      this.focus.set(pos.x, pos.y, pos.z);
      app.input.releaseAll();
      app.input.exitLock();
      app.hud.setHint('');
    }
    app.input.spectatorEnabled = this.active && app.input.enabled;
    if (app.input.consume('spectatePrevious')) this.direction = -1;
    if (app.input.consume('spectateNext')) this.direction = 1;
    const state = app.combat.scoreboardState;
    const candidates = getSpectatorCandidates({ players: state.players, me: state.me, eliminated: state.eliminated, remotes: [...app.net!.remotePlayers] });
    const next = selectSpectatorTarget(candidates.map((p) => p.index), this.target, this.direction);
    this.direction = 0;
    const remote = next === null ? undefined : app.net!.remote(next);
    if (remote) {
      if (next !== this.target) {
        app.camera.reset(remote.pos, remote.renderFacing, true);
        app.obstruction.reset();
      }
      this.focus.copy(remote.pos);
      app.camera.aim = false;
      app.camera.fovBoost = 0;
      app.camera.look(look.yaw, look.pitch);
      app.camera.update(dt, this.focus, app.world.physics);
    }
    this.target = next;
    const player = candidates.find((p) => p.index === next);
    const participants = state.players.filter((p) => p.inMatch);
    const living = participants.filter((p) => p.index !== state.me && p.connected && !p.dropped && p.alive !== false && !state.eliminated.has(p.index));
    this.ui.update(player && remote ? { index: player.index, name: player.name, hp: remote.health, shield: remote.shield, kills: player.kills } : null, living.length, participants.length);
    this.ui.show(this.active && app.input.enabled);
  }
}

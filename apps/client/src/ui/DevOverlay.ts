/** F3 developer overlay (labels in Portuguese): measured numbers only (frame, GPU work, character cost, network, server). */
import type * as THREE from 'three';
import { ASSET_VERSION, CLIENT_VERSION, PROTOCOL_VERSION } from '@graao/shared';

export interface DevStats {
  renderer: THREE.WebGLRenderer;
  extra: () => Record<string, string | number>;
}

export class DevOverlay {
  readonly el = document.createElement('pre');
  visible = false;
  private frames: number[] = [];
  private last = performance.now();
  private acc = 0;

  constructor(private readonly src: DevStats) {
    this.el.className = 'dev-overlay';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Call once per frame after rendering. */
  frame(): void {
    const now = performance.now();
    const ms = now - this.last;
    this.last = now;
    this.frames.push(ms);
    if (this.frames.length > 120) this.frames.shift();
    this.acc += ms;
    if (!this.visible || this.acc < 250) return;
    this.acc = 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const worst = Math.max(...this.frames);
    const info = this.src.renderer.info;
    const lines: [string, string | number][] = [
      ['graao', `${CLIENT_VERSION} · protocolo ${PROTOCOL_VERSION} · assets ${ASSET_VERSION}`],
      ['FPS', (1000 / avg).toFixed(0)],
      ['quadro ms', `${avg.toFixed(2)} média · ${worst.toFixed(1)} pior`],
      ['draw calls', info.render.calls],
      ['triângulos', info.render.triangles.toLocaleString('pt-BR')],
      ['geometrias', info.memory.geometries],
      ['texturas', info.memory.textures],
      ['programas', info.programs?.length ?? 0],
      ...Object.entries(this.src.extra()),
    ];
    this.el.textContent = lines.map(([k, v]) => `${k.padEnd(16)} ${v}`).join('\n');
  }
}
